/**
 * _importStory.js — the whole-story round trip: upload an edited export, confirm, apply.
 *
 * The single-turn round trip (story/_editFileRoundTrip.js) fixes editing one entry across page
 * boundaries. This one takes the file the story export already produces and reads structure out
 * of it: the file's block order becomes the story's reading order, a changed writer name
 * re-credits a turn, and a block the editor deleted removes that turn.
 *
 * Everything decidable from the file alone is decided in story/_importPlan.js, which has no
 * database or Discord in it. This module reads the snapshot that planner needs, renders the
 * confirmation, and applies an approved plan in one transaction.
 *
 * Why a confirmation at all, when the single-turn import also has one: removal by omission. A
 * word processor that drops the tail of a long file, or an editor who deletes a block to move it
 * and never pastes it back, both arrive here as "remove these turns". The confirm lists removals
 * one by one for that reason -- a list of turns the editor recognises is alarming in the way a
 * bare count is not. Every removal is a soft delete and restorable from Manage Entries, but the
 * confirm is what means most accidents never need restoring.
 *
 * See docs/plans/PLAN-copyedit-round-trip.md, build order step 6.
 */

import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags,
  ModalBuilder, LabelBuilder, FileUploadBuilder, TextDisplayBuilder,
} from 'discord.js';
import { getConfigValue, log, replaceTemplateVariables } from '../utilities.js';
import { parseEntryDelimiter, parseExportStamp } from './_exportText.js';
import { buildExportFilename } from './_exportData.js';
import { splitStoryFile, planStoryImport } from './_importPlan.js';
import { listStoryWritersForCredit, logEntryReorder, logEntryWriterChange } from './_entryChangeLog.js';
import { entryOrderSort, ORDERED_STATUSES } from './_entryOrder.js';
import { ENTRY_CONTENT_BYTE_LIMIT } from './_editFileRoundTrip.js';
import { resolveMentionsToPlainText } from './_entryMarkup.js';
import { ENTRY_STATUS } from '../constants.js';
import { pendingImportData } from './_state.js';

export const IMPORT_STORY_CONFIG_KEYS = [
  'btnManageEntriesImport', 'txtImportStoryModalTitle', 'lblImportStoryFile',
  'txtImportStoryModalHint', 'txtImportStoryConfirmTitle', 'txtImportStoryConfirm',
  'txtImportStoryRow', 'txtImportStoryNoteMoved', 'txtImportStoryNoteWriter',
  'txtImportStoryNoteRemoved', 'txtImportStoryNoteRestored', 'txtImportStoryNoteConflict',
  'txtImportStoryOverflow', 'btnImportStoryConfirm', 'txtImportStorySuccess',
  'txtImportStoryNoChange', 'txtImportStoryUnreadable', 'txtImportStoryUnknownEntry',
  'txtImportStoryDuplicateEntry', 'txtImportStoryUnknownWriter', 'txtImportStoryEmptyEntry',
  'txtImportStoryEntryTooLarge', 'txtImportStoryUnchangedCount',
];

// A whole story, not one entry, so the ceiling is higher -- but still a ceiling, because this is
// read into memory before anything is known about it.
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

// Discord's embed description limit. The summary is one line per changed turn, and a story long
// enough to overflow it gets the first stretch inline and the whole list as an attachment.
const DESCRIPTION_BUDGET = 3600;

/**
 * The snapshot the planner works from: every ordered entry of the story (confirmed and deleted,
 * in reading order) with its content, its writer, and when it was last edited.
 */
export async function readStoryForImport(connection, storyId) {
  const statusPlaceholders = ORDERED_STATUSES.map(() => '?').join(', ');
  const [rows] = await connection.execute(
    `SELECT se.story_entry_id, se.content, se.entry_status, se.entry_order,
            sw.story_writer_id, sw.discord_display_name, sw.pen_name,
            (SELECT MAX(see.edited_at) FROM story_entry_edit see WHERE see.entry_id = se.story_entry_id) AS last_edited_at
     FROM story_entry se
     JOIN turn t ON se.turn_id = t.turn_id
     JOIN story_writer sw ON t.story_writer_id = sw.story_writer_id
     WHERE sw.story_id = ? AND se.entry_status IN (${statusPlaceholders})
     ORDER BY ${entryOrderSort()}`,
    [storyId, ...ORDERED_STATUSES]
  );

  return rows.map(r => ({
    entryId: String(r.story_entry_id),
    content: r.content,
    entryStatus: r.entry_status,
    entryOrder: r.entry_order,
    writerId: String(r.story_writer_id),
    writerName: r.pen_name || r.discord_display_name,
    lastEditedAt: r.last_edited_at,
  }));
}

// ---------------------------------------------------------------------------
// Rendering the confirmation
// ---------------------------------------------------------------------------

/**
 * One line per changed turn: `12. Maria - 1,420 to 1,380 words (moved to 9)`. Unchanged turns are
 * not listed at all -- the signal is what moved -- and the count of them closes the summary.
 */
export function buildImportSummaryLines(plan, cfg) {
  return plan.rows.filter(r => r.changed).map(row => {
    const notes = [];
    if (row.removed) notes.push(cfg.txtImportStoryNoteRemoved);
    if (row.restored) notes.push(cfg.txtImportStoryNoteRestored);
    if (row.moved) notes.push(replaceTemplateVariables(cfg.txtImportStoryNoteMoved, {
      to_position: String(row.toPosition),
    }));
    if (row.writerTo) notes.push(replaceTemplateVariables(cfg.txtImportStoryNoteWriter, {
      to_writer: row.writerTo,
    }));
    if (row.conflict) notes.push(cfg.txtImportStoryNoteConflict);

    return replaceTemplateVariables(cfg.txtImportStoryRow, {
      turn_number: String(row.toPosition ?? row.fromPosition ?? ''),
      writer_name: row.writerName ?? '',
      from_words: row.fromWords.toLocaleString(),
      to_words: row.toWords.toLocaleString(),
      ...(notes.length > 0 ? { notes: notes.join(', ') } : {}),
    });
  });
}

/**
 * Fits the summary into an embed description, with whatever does not fit going to an attachment.
 * Returns `{ description, overflow }` where overflow is the full text or null.
 */
export function fitSummary(lines, cfg, budget = DESCRIPTION_BUDGET) {
  const whole = lines.join('\n');
  if (whole.length <= budget) return { description: whole, overflow: null };

  const kept = [];
  let used = 0;
  const notice = `\n${cfg.txtImportStoryOverflow}`;
  for (const line of lines) {
    if (used + line.length + 1 + notice.length > budget) break;
    kept.push(line);
    used += line.length + 1;
  }
  return { description: `${kept.join('\n')}${notice}`, overflow: whole };
}

// ---------------------------------------------------------------------------
// Panel entry points
// ---------------------------------------------------------------------------

export function buildImportStoryButton(cfg, storyId) {
  return new ButtonBuilder()
    .setCustomId(`story_import_story_${storyId}`)
    .setLabel(cfg.btnManageEntriesImport)
    .setStyle(ButtonStyle.Secondary);
}

// The upload modal, the same shape as the single-turn one: a FileUploadBuilder wrapped in a
// LabelBuilder, which is the only way a modal takes a file.
export function buildImportStoryModal(cfg, storyId) {
  const upload = new FileUploadBuilder()
    .setCustomId('story_file')
    .setMinValues(1)
    .setMaxValues(1)
    .setRequired(true);

  return new ModalBuilder()
    .setCustomId(`story_import_story_submit_${storyId}`)
    .setTitle(cfg.txtImportStoryModalTitle)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(cfg.txtImportStoryModalHint))
    .addLabelComponents(
      new LabelBuilder().setLabel(cfg.lblImportStoryFile).setFileUploadComponent(upload)
    );
}

// Each refusal names the thing in the file that caused it, because the editor has the file open
// and can only fix what they can find.
const ERROR_KEYS = {
  no_blocks: 'txtImportStoryUnreadable',
  unknown_entry: 'txtImportStoryUnknownEntry',
  duplicate_entry: 'txtImportStoryDuplicateEntry',
  unknown_writer: 'txtImportStoryUnknownWriter',
  empty_entry: 'txtImportStoryEmptyEntry',
  entry_too_large: 'txtImportStoryEntryTooLarge',
};

/**
 * Reads the uploaded file, plans the import, and shows the confirmation. Writes nothing.
 */
export async function handleImportStoryModalSubmit(connection, interaction, storyId) {
  const guildId = interaction.guild.id;
  const guildName = interaction?.guild?.name;
  const cfg = await getConfigValue(connection, IMPORT_STORY_CONFIG_KEYS, guildId);

  log(`handleImportStoryModalSubmit entry: story ${storyId} for ${interaction.user.username}`, { show: false, guildName });

  const files = interaction.fields.getUploadedFiles('story_file');
  const attachment = files?.first?.() ?? null;
  if (!attachment || attachment.size > MAX_UPLOAD_BYTES) {
    log(`handleImportStoryModalSubmit: rejected upload on story ${storyId} (${attachment ? `${attachment.size} bytes` : 'no attachment'})`, { show: true, guildName });
    return await interaction.followUp({ content: cfg.txtImportStoryUnreadable, flags: MessageFlags.Ephemeral });
  }

  let text;
  try {
    const response = await fetch(attachment.url);
    if (!response.ok) throw new Error(`attachment fetch returned ${response.status}`);
    text = await response.text();
  } catch (err) {
    log(`handleImportStoryModalSubmit: could not read ${attachment.name} for story ${storyId}: ${err?.stack ?? err}`, { show: true, guildName });
    return await interaction.followUp({ content: cfg.txtImportStoryUnreadable, flags: MessageFlags.Ephemeral });
  }

  const { blocks, exportedAt } = splitStoryFile(text, parseEntryDelimiter, parseExportStamp);
  const [current, writers, storyRows] = await Promise.all([
    readStoryForImport(connection, storyId),
    listStoryWritersForCredit(connection, storyId),
    connection.execute(
      `SELECT guild_story_id, title FROM story WHERE story_id = ?`, [storyId]
    ).then(([rows]) => rows),
  ]);
  const story = storyRows[0] ?? { guild_story_id: storyId, title: '' };

  // An import is a new submission of each entry it changes, so every block goes through the same
  // mention resolution a modal save does -- before planning, so the comparison that decides
  // "changed" is made against what would actually be stored.
  const placeholders = await getConfigValue(connection, [
    'txtExportPlaceholderUser', 'txtExportPlaceholderChannel', 'txtExportPlaceholderRole',
  ], guildId);
  for (const block of blocks) {
    block.content = await resolveMentionsToPlainText(block.content, interaction.guild, placeholders);
  }

  const plan = planStoryImport({
    current, blocks, exportedAt, writers, contentByteLimit: ENTRY_CONTENT_BYTE_LIMIT,
  });

  if (plan.error) {
    log(`handleImportStoryModalSubmit: ${attachment.name} rejected for story ${storyId}: ${plan.error} (entry ${plan.entryId ?? '-'}, turn ${plan.turnNumber ?? '-'})`, { show: true, guildName });
    return await interaction.followUp({
      content: replaceTemplateVariables(cfg[ERROR_KEYS[plan.error]], {
        file_id: String(plan.entryId ?? ''),
        file_turn: String(plan.turnNumber ?? ''),
        writer_name: plan.writerName ?? '',
        limit: ENTRY_CONTENT_BYTE_LIMIT.toLocaleString(),
      }),
      flags: MessageFlags.Ephemeral,
    });
  }

  if (plan.changedCount === 0) {
    log(`handleImportStoryModalSubmit: ${attachment.name} matches story ${storyId} as it stands`, { show: true, guildName });
    return await interaction.followUp({ content: cfg.txtImportStoryNoChange, flags: MessageFlags.Ephemeral });
  }

  const lines = buildImportSummaryLines(plan, cfg);
  const { description, overflow } = fitSummary(lines, cfg);
  const lead = replaceTemplateVariables(cfg.txtImportStoryConfirm, {
    changed_count: String(plan.changedCount),
    unchanged_count: String(plan.unchangedCount),
    filename: attachment.name,
  });
  const tail = replaceTemplateVariables(cfg.txtImportStoryUnchangedCount, {
    unchanged_count: String(plan.unchangedCount),
  });

  const embed = new EmbedBuilder()
    .setTitle(cfg.txtImportStoryConfirmTitle)
    .setDescription(`${lead}\n\n${description}\n\n${tail}`)
    // Red when something is being taken away or overwritten unknowingly, which is when the
    // editor should read the list rather than the button.
    .setColor(plan.removals > 0 || plan.conflicts > 0 ? 0xff6b6b : 0x99aab5);

  // No Cancel: the confirmation is ephemeral, so dismissing it is the way out (LeeAnn,
  // 2026-10-22). Danger-styled, because applying removes turns and overwrites prose.
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('story_import_story_confirm')
      .setLabel(cfg.btnImportStoryConfirm)
      .setStyle(ButtonStyle.Danger)
  );

  pendingImportData.set(interaction.user.id, { storyId, guildId, plan, cfg, filename: attachment.name });

  const payload = { embeds: [embed], components: [row], flags: MessageFlags.Ephemeral };
  if (overflow) {
    payload.files = [{
      attachment: Buffer.from(`${lead}\n\n${overflow}\n\n${tail}\n`, 'utf8'),
      // Named like every other file this feature hands over: the story number the editor sees,
      // the title, what it is, and when.
      name: buildExportFilename({
        guildStoryId: story.guild_story_id, title: story.title,
        part: 'import_summary', exportedAt: new Date(), ext: 'txt',
      }),
    }];
  }

  log(`handleImportStoryModalSubmit: story ${storyId} staged from ${attachment.name} -- ${plan.changedCount} changed, ${plan.unchangedCount} unchanged, ${plan.removals} removed, ${plan.restorations} restored, ${plan.conflicts} conflicted`, { show: true, guildName });
  await interaction.followUp(payload);
}

/**
 * Applies an approved plan. One transaction: every content change writes its history row before
 * the content it replaces, the whole reading order is rewritten from the plan's sequence, and
 * each structural change is logged the same way the panel's own buttons log theirs.
 */
export async function applyStoryImport(connection, interaction, staged) {
  const guildName = interaction?.guild?.name;
  const { plan, storyId } = staged;
  const editorId = interaction.user.id;
  const editorName = interaction.member?.displayName ?? interaction.user.username;

  const txn = await connection.getConnection();
  await txn.beginTransaction();
  try {
    for (const row of plan.rows) {
      if (row.contentChanged) {
        await txn.execute(
          `INSERT INTO story_entry_edit (entry_id, content, edited_by, edited_by_name) VALUES (?, ?, ?, ?)`,
          [row.entryId, row.previousContent, editorId, editorName]
        );
        await txn.execute(
          `UPDATE story_entry SET content = ? WHERE story_entry_id = ?`,
          [row.content, row.entryId]
        );
      }

      if (row.removed) {
        await txn.execute(
          `UPDATE story_entry SET entry_status = ? WHERE story_entry_id = ?`,
          [ENTRY_STATUS.DELETED, row.entryId]
        );
      } else if (row.restored) {
        await txn.execute(
          `UPDATE story_entry SET entry_status = ? WHERE story_entry_id = ?`,
          [ENTRY_STATUS.CONFIRMED, row.entryId]
        );
      }

      if (row.writerId) {
        await txn.execute(
          `UPDATE turn SET story_writer_id = ?
           WHERE turn_id = (SELECT turn_id FROM story_entry WHERE story_entry_id = ?)`,
          [row.writerId, row.entryId]
        );
        await logEntryWriterChange(txn, {
          entryId: row.entryId, editorId, editorName,
          previousWriter: { id: row.writerFromId, name: row.writerFrom },
          newWriter: { id: row.writerId, name: row.writerTo },
          guildName,
        });
      }

      if (row.moved) {
        await logEntryReorder(txn, {
          entryId: row.entryId, editorId, editorName,
          from: row.fromPosition, to: row.toPosition, guildName,
        });
      }
    }

    // The order is rewritten wholesale rather than by permuting pairs: the file is the order, so
    // there is nothing to work out incrementally. Deleted rows are in the sequence too, which is
    // what keeps them beside the prose they belong between.
    for (const [index, entryId] of plan.order.entries()) {
      await txn.execute(
        `UPDATE story_entry SET entry_order = ? WHERE story_entry_id = ?`,
        [index + 1, entryId]
      );
    }

    await txn.commit();
  } catch (err) {
    await txn.rollback();
    log(`applyStoryImport failed for story ${storyId}: ${err?.stack ?? err}`, { show: true, guildName });
    throw err;
  } finally {
    txn.release();
  }

  log(`applyStoryImport: story ${storyId} updated from ${staged.filename} by ${interaction.user.username} -- ${plan.changedCount} turn(s) changed, ${plan.removals} removed, ${plan.restorations} restored`, { show: true, guildName });
}

export async function handleImportStoryButton(connection, interaction) {
  const customId = interaction.customId;

  if (customId.startsWith('story_import_story_confirm')) {
    await interaction.deferUpdate();
    const staged = pendingImportData.get(interaction.user.id);
    if (!staged) {
      log(`handleImportStoryButton: nothing staged for ${interaction.user.username} (session expired or already applied)`, { show: true, guildName: interaction?.guild?.name });
      return;
    }
    await applyStoryImport(connection, interaction, staged);
    pendingImportData.delete(interaction.user.id);
    return await interaction.editReply({
      content: replaceTemplateVariables(staged.cfg.txtImportStorySuccess, {
        changed_count: String(staged.plan.changedCount),
      }),
      embeds: [], components: [],
    });
  }

  // story_import_story_<storyId> -- the button on the Manage Entries picker. No defer, because
  // showModal has to be the first response.
  const storyId = parseInt(customId.replace('story_import_story_', ''), 10);
  log(`handleImportStoryButton: story ${storyId} opening import modal for ${interaction.user.username}`, { show: false, guildName: interaction?.guild?.name });
  const cfg = await getConfigValue(connection, IMPORT_STORY_CONFIG_KEYS, interaction.guild.id);
  await interaction.showModal(buildImportStoryModal(cfg, storyId));
}
