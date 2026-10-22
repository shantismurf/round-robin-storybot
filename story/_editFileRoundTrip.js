/**
 * _editFileRoundTrip.js — the single-turn file round trip on the edit panel.
 *
 * Download one entry as plain text, edit it anywhere with no page boundaries, upload it back.
 * This is the real fix for the page problem: the edit modal splits an entry into 3800-character
 * pages because Discord's text input cannot hold more, so a change spanning a page seam has to
 * be made twice and a global find-and-replace cannot be made at all.
 *
 * Two buttons, not one. The gap between downloading and uploading is "several minutes, if not
 * hours or days" (LeeAnn, 2026-10-21), and a button on the export message would be dead long
 * before then — a Discord interaction token lives about fifteen minutes. So the upload entry
 * point has to be a button on the panel itself, which the editor reopens when the file is ready.
 *
 * The file format is the whole-story export's, narrowed to one entry: the
 * `[[turn N | #id | writer]]` delimiter as the first line, the prose, then the
 * `[[exported-at ...]]` trailer. It needs the delimiter even though there is only one entry in
 * it, because the id is what makes "this is the wrong file" and "this entry changed in Discord
 * since you downloaded it" answerable at all.
 *
 * See docs/plans/PLAN-copyedit-round-trip.md, build order step 5.
 */

import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags,
  ModalBuilder, LabelBuilder, FileUploadBuilder, TextDisplayBuilder,
} from 'discord.js';
import { getConfigValue, log, replaceTemplateVariables, chunkEntryContent } from '../utilities.js';
import { buildEntryDelimiter, parseEntryDelimiter, buildExportStamp, parseExportStamp } from './_exportText.js';
import { buildExportFilename } from './_exportData.js';
import { resolveMentionsToPlainText } from './_entryMarkup.js';
import { turnNumberSubquery } from './_entryOrder.js';
import { buildEditMessageForState } from './edit.js';
import { ENTRY_STATUS } from '../constants.js';

// Every config key this module reads. Exported for the same reason EDIT_PANEL_CONFIG_KEYS is:
// openEditSession fetches the panel's keys in one query and must not keep a second list.
export const EDIT_FILE_CONFIG_KEYS = [
  'btnEditExportFile', 'txtEditExportFileInstructions',
  'btnEditImportFile', 'txtEditImportModalTitle', 'lblEditImportFile', 'txtEditImportModalHint',
  'txtEditImportConfirmTitle', 'txtEditImportConfirm', 'txtEditImportConflict',
  'txtEditImportSuccess', 'txtEditImportNoChange',
  // One message covers both ways a file can fail to be this entry's: it is another entry's, or
  // it has no turn line at all. Either way the first line is wrong and the fix is the same.
  'txtEditImportError', 'txtEditImportTooLarge',
  // The confirm's own button reuses the existing Save value rather than adding a thirteenth key
  // that says the same word (LeeAnn, 2026-10-22).
  'btnAdminConfigSave',
];

// `story_entry.content` is TEXT: 65,535 *bytes*, not characters. Measured in bytes for that
// reason -- a story in a non-Latin script would otherwise pass this check and be truncated by
// the database. A few bytes of headroom, since the column stores a 2-byte length prefix.
export const ENTRY_CONTENT_BYTE_LIMIT = 65000;

// What the uploader is allowed to hand back. An entry that fits the column cannot produce a
// larger file than this with its delimiter and trailer attached, so anything bigger is not an
// edited entry -- it is the wrong file, and reading it into memory first to find that out is
// what this guard avoids.
const MAX_UPLOAD_BYTES = 256 * 1024;

const wordCount = text => text.trim().split(/\s+/).filter(Boolean).length;

/**
 * The story and writer facts a one-entry export needs, read fresh rather than from the panel
 * session: the session's `storyTitle` is truncated for the embed header and would carry its
 * ellipsis into the filename.
 */
async function readEntryForExport(connection, entryId) {
  const [rows] = await connection.execute(
    `SELECT se.story_entry_id, se.content, se.entry_status,
            s.guild_story_id, s.title, s.show_authors,
            sw.discord_display_name, sw.pen_name,
            ${turnNumberSubquery()} AS turn_number
     FROM story_entry se
     JOIN turn t ON se.turn_id = t.turn_id
     JOIN story_writer sw ON t.story_writer_id = sw.story_writer_id
     JOIN story s ON sw.story_id = s.story_id
     WHERE se.story_entry_id = ?`,
    [ENTRY_STATUS.CONFIRMED, entryId]
  );
  return rows[0] ?? null;
}

/**
 * Builds the one-entry file. Mirrors generateEntriesTextExport's return shape, minus the
 * story-level counts that mean nothing for a single turn.
 *
 * No header and no legend: the editor is looking at this one entry in the panel they pressed the
 * button on, and the legend's "do not reorder or renumber" paragraph is about a file holding a
 * whole story. The delimiter still leads, because import matches on the id.
 */
/**
 * The entry's own turn line, exactly as the export file carries it. Shown in the import modal
 * and quoted back in the mismatch message, so the editor can compare it against the file in
 * front of them without counting characters.
 */
export function entryExportHeader(entry) {
  const writerName = entry.show_authors ? (entry.pen_name || entry.discord_display_name) : null;
  return buildEntryDelimiter(entry.turn_number, entry.story_entry_id, writerName);
}

export function buildSingleEntryExport(entry, exportedAt = new Date()) {
  // show_authors is honoured as it is in the whole-story export: a writer who chose not to be
  // credited must not be named in a file that leaves Discord.
  const delimiter = entryExportHeader(entry);
  const text = `${delimiter}\n\n${entry.content.replace(/\s+$/, '')}\n\n${buildExportStamp(exportedAt)}\n`;

  return {
    buffer: Buffer.from(text, 'utf8'),
    filename: buildExportFilename({
      guildStoryId: entry.guild_story_id,
      title: entry.title,
      part: `turn${entry.turn_number}`,
      exportedAt,
      ext: 'txt',
    }),
    turnNumber: entry.turn_number,
    wordCount: wordCount(entry.content),
  };
}

/**
 * Parses an uploaded one-entry file.
 *
 * Returns `{ error: 'unreadable' }` when the first non-empty line is not a delimiter — which is
 * every wrong-file case that matters, since a file with no id cannot be matched to anything.
 * Otherwise `{ entryId, turnNumber, content, exportedAt }`, where `exportedAt` is null for a
 * file exported before the trailer existed. The caller compares the id against the entry it has
 * open; this function deliberately does not know which entry that is, so it can be tested on
 * its own and reused by the whole-story import.
 */
export function parseSingleEntryFile(text) {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');

  let first = 0;
  while (first < lines.length && lines[first].trim() === '') first += 1;
  const delimiter = first < lines.length ? parseEntryDelimiter(lines[first]) : null;
  if (!delimiter) return { error: 'unreadable' };

  let last = lines.length - 1;
  while (last > first && lines[last].trim() === '') last -= 1;

  // The trailer is read from the end rather than by scanning, so prose containing a similar
  // line cannot be mistaken for it.
  const exportedAt = parseExportStamp(lines[last]);
  const bodyEnd = exportedAt ? last - 1 : last;

  const content = lines.slice(first + 1, bodyEnd + 1).join('\n').trim();

  return { entryId: delimiter.entryId, turnNumber: delimiter.turnNumber, content, exportedAt };
}

/**
 * Whether this entry was edited in Discord after the file was exported -- the one thing in the
 * confirm the editor cannot know about, since it happened somewhere they were not looking.
 * Returns the instant of that edit, or null.
 */
export async function readConflictingEdit(connection, entryId, exportedAt) {
  if (!exportedAt) return null;
  const [rows] = await connection.execute(
    `SELECT edited_at FROM story_entry_edit
     WHERE entry_id = ? AND edited_at > ?
     ORDER BY edited_at DESC LIMIT 1`,
    [entryId, exportedAt]
  );
  return rows[0]?.edited_at ?? null;
}

// ---------------------------------------------------------------------------
// Panel actions
// ---------------------------------------------------------------------------

/** The two file buttons. Offered to authors as well as admins: cross-page editing is exactly
 *  the problem a writer with a long entry has. */
export function buildFileRoundTripButtons(cfg) {
  return [
    new ButtonBuilder()
      .setCustomId('story_edit_export_file')
      .setLabel(cfg.btnEditExportFile)
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('story_edit_import_file')
      .setLabel(cfg.btnEditImportFile)
      .setStyle(ButtonStyle.Secondary),
  ];
}

/** The turn line for the entry a panel session has open, for the modal hint and the mismatch
 *  message. Read fresh, because a reorder moves the turn number in it. */
export async function readExportHeader(connection, entryId) {
  const entry = await readEntryForExport(connection, entryId);
  return entry ? entryExportHeader(entry) : null;
}

export async function handleExportFile(connection, interaction, state) {
  const guildName = interaction?.guild?.name;
  log(`handleExportFile entry: entry ${state.entryId} for ${interaction.user.username}`, { show: false, guildName });
  const entry = await readEntryForExport(connection, state.entryId);
  if (!entry) {
    return await interaction.followUp({
      content: await getConfigValue(connection, 'txtEditEntryNotFound', state.guildId),
      flags: MessageFlags.Ephemeral,
    });
  }

  const file = buildSingleEntryExport(entry);
  await interaction.followUp({
    content: replaceTemplateVariables(state.editCfg.txtEditExportFileInstructions, {
      turn_number: String(file.turnNumber),
      word_count: file.wordCount.toLocaleString(),
    }),
    files: [{ attachment: file.buffer, name: file.filename }],
    flags: MessageFlags.Ephemeral,
  });
  log(`handleExportFile: entry ${state.entryId} (turn ${file.turnNumber}) delivered as ${file.filename} to ${interaction.user.username}`, { show: true, guildName });
}

// The upload modal. A FileUploadBuilder has to be wrapped in a LabelBuilder and added with
// addLabelComponents -- verified against node_modules/@discordjs/builders (LabelBuilderData
// accepts a FileUploadBuilder, and setFileUploadComponent is its setter). The hint rides as a
// TextDisplayBuilder, the same way the setup panel's channel modals carry theirs.
export function buildImportModal(cfg, exportHeader) {
  const upload = new FileUploadBuilder()
    .setCustomId('entry_file')
    .setMinValues(1)
    .setMaxValues(1)
    .setRequired(true);

  return new ModalBuilder()
    .setCustomId('story_edit_import_submit')
    .setTitle(cfg.txtEditImportModalTitle)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
      replaceTemplateVariables(cfg.txtEditImportModalHint, { export_header: exportHeader })
    ))
    .addLabelComponents(
      new LabelBuilder().setLabel(cfg.lblEditImportFile).setFileUploadComponent(upload)
    );
}

/**
 * Reads the uploaded file, checks it belongs to this entry, and shows the confirm. Nothing is
 * written here -- the editor approves the change first, because removal and replacement by
 * upload are the two things a mangled file does silently.
 */
export async function handleImportModalSubmit(connection, interaction, state) {
  const guildName = interaction?.guild?.name;
  const cfg = state.editCfg;

  log(`handleImportModalSubmit entry: entry ${state.entryId} (turn ${state.turnNumber}) for ${interaction.user.username}`, { show: false, guildName });

  // The entry's own turn line, read fresh: it is what the mismatch message quotes back, and a
  // reorder since the panel opened would have moved the turn number in it.
  const exportHeader = await readExportHeader(connection, state.entryId);
  const mismatch = () => replaceTemplateVariables(cfg.txtEditImportError, { export_header: exportHeader ?? '' });

  const files = interaction.fields.getUploadedFiles('entry_file');
  const attachment = files?.first?.() ?? null;
  if (!attachment) {
    log(`handleImportModalSubmit: no attachment on entry ${state.entryId}`, { show: true, guildName });
    return await interaction.followUp({ content: mismatch(), flags: MessageFlags.Ephemeral });
  }

  if (attachment.size > MAX_UPLOAD_BYTES) {
    log(`handleImportModalSubmit: rejected ${attachment.name} (${attachment.size} bytes) on entry ${state.entryId}`, { show: true, guildName });
    return await interaction.followUp({
      content: replaceTemplateVariables(cfg.txtEditImportTooLarge, {
        limit: ENTRY_CONTENT_BYTE_LIMIT.toLocaleString(),
      }),
      flags: MessageFlags.Ephemeral,
    });
  }

  let text;
  try {
    const response = await fetch(attachment.url);
    if (!response.ok) throw new Error(`attachment fetch returned ${response.status}`);
    text = await response.text();
  } catch (err) {
    log(`handleImportModalSubmit: could not read ${attachment.name} for entry ${state.entryId}: ${err?.stack ?? err}`, { show: true, guildName });
    return await interaction.followUp({ content: mismatch(), flags: MessageFlags.Ephemeral });
  }

  const parsed = parseSingleEntryFile(text);
  if (parsed.error) {
    log(`handleImportModalSubmit: ${attachment.name} has no turn line (entry ${state.entryId})`, { show: true, guildName });
    return await interaction.followUp({ content: mismatch(), flags: MessageFlags.Ephemeral });
  }

  // The id is the identity. A file for another entry pasted over this one would replace prose
  // wholesale with someone else's, which is the one mistake here that is genuinely hard to spot
  // afterwards.
  if (String(parsed.entryId) !== String(state.entryId)) {
    log(`handleImportModalSubmit: ${attachment.name} is entry ${parsed.entryId}, panel has ${state.entryId}`, { show: true, guildName });
    return await interaction.followUp({ content: mismatch(), flags: MessageFlags.Ephemeral });
  }

  if (parsed.content === '') {
    return await interaction.followUp({
      content: await getConfigValue(connection, 'txtEditEntryEmpty', state.guildId),
      flags: MessageFlags.Ephemeral,
    });
  }

  // An import is a new submission of the whole entry, so it goes through the same mention
  // resolution any other write does -- see docs/plans/PLAN-mention-display-text.md.
  const resolved = await resolveMentionsToPlainText(
    parsed.content, interaction.guild,
    await getConfigValue(connection, [
      'txtExportPlaceholderUser', 'txtExportPlaceholderChannel', 'txtExportPlaceholderRole',
    ], state.guildId)
  );

  if (Buffer.byteLength(resolved, 'utf8') > ENTRY_CONTENT_BYTE_LIMIT) {
    return await interaction.followUp({
      content: replaceTemplateVariables(cfg.txtEditImportTooLarge, {
        limit: ENTRY_CONTENT_BYTE_LIMIT.toLocaleString(),
      }),
      flags: MessageFlags.Ephemeral,
    });
  }

  if (resolved === state.currentContent) {
    log(`handleImportModalSubmit: ${attachment.name} matches entry ${state.entryId} as it stands`, { show: true, guildName });
    return await interaction.followUp({ content: cfg.txtEditImportNoChange, flags: MessageFlags.Ephemeral });
  }

  const conflictAt = await readConflictingEdit(connection, state.entryId, parsed.exportedAt);
  state.pendingImport = { content: resolved, filename: attachment.name };

  // turn_id carries the turn number a reader sees, not story_entry_id: the sentence reads "will
  // change turn 12", and 12 is what the panel header, the file and the History panel all show.
  const body = replaceTemplateVariables(cfg.txtEditImportConfirm, {
    turn_id: String(state.turnNumber),
    from_words: wordCount(state.currentContent).toLocaleString(),
    to_words: wordCount(resolved).toLocaleString(),
  });
  // The conflict line rides on the same confirmation rather than opening a second one: the
  // question it asks ("do you want to continue?") is what the Save button already answers.
  const conflictNote = conflictAt ? `\n\n${cfg.txtEditImportConflict}` : '';

  const embed = new EmbedBuilder()
    .setTitle(cfg.txtEditImportConfirmTitle)
    .setDescription(`${body}${conflictNote}`)
    .setColor(conflictAt ? 0xff6b6b : 0x99aab5);

  // No Cancel: the whole confirmation is ephemeral, so dismissing the message is the way out,
  // and this panel carries no panel-level Cancel anywhere else either (LeeAnn, 2026-10-22).
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('story_edit_import_confirm')
      .setLabel(cfg.btnAdminConfigSave)
      .setStyle(ButtonStyle.Success)
  );

  log(`handleImportModalSubmit: entry ${state.entryId} staged from ${attachment.name} (${wordCount(state.currentContent)} -> ${wordCount(resolved)} words, conflict=${conflictAt ?? 'none'})`, { show: true, guildName });
  state.importMessage = await interaction.followUp({ embeds: [embed], components: [row], flags: MessageFlags.Ephemeral });
}

/**
 * Commits a staged import: the current text goes into the entry's history, then the file's text
 * replaces it. One transaction, the same order the modal save uses, so the version the editor
 * can restore always exists before the thing it would restore over.
 */
export async function handleImportConfirm(connection, interaction, state) {
  const guildName = interaction?.guild?.name;
  const staged = state.pendingImport;
  if (!staged) {
    log(`handleImportConfirm: nothing staged for entry ${state.entryId} (session expired or already applied)`, { show: true, guildName });
    return;
  }
  log(`handleImportConfirm entry: entry ${state.entryId} from ${staged.filename} by ${interaction.user.username}`, { show: false, guildName });

  const editorName = interaction.member?.displayName ?? interaction.user.username;
  const previousContent = state.currentContent;

  const txn = await connection.getConnection();
  await txn.beginTransaction();
  try {
    await txn.execute(
      `INSERT INTO story_entry_edit (entry_id, content, edited_by, edited_by_name) VALUES (?, ?, ?, ?)`,
      [state.entryId, previousContent, interaction.user.id, editorName]
    );
    await txn.execute(
      `UPDATE story_entry SET content = ? WHERE story_entry_id = ?`,
      [staged.content, state.entryId]
    );
    await txn.commit();
  } catch (err) {
    await txn.rollback();
    log(`handleImportConfirm failed for entry ${state.entryId}: ${err?.stack ?? err}`, { show: true, guildName });
    throw err;
  } finally {
    txn.release();
  }

  state.currentContent = staged.content;
  state.chunks = chunkEntryContent(staged.content);
  state.chunkPage = 0;
  state.hasHistory = true;
  state.pendingImport = null;

  log(`handleImportConfirm: entry ${state.entryId} replaced from ${staged.filename} by ${interaction.user.username} (${previousContent.length} -> ${staged.content.length} chars)`, { show: true, guildName });

  // The staged confirm is finished with; the panel below it carries the result.
  await state.originalInteraction.deleteReply(state.importMessage).catch(() => {});
  state.importMessage = null;

  // Same follow-up as a saved edit: the entry's thread post is now stale, so offer the repost.
  const editMsg = buildEditMessageForState(state);
  const repostRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`story_repost_entry_${state.entryId}`)
      .setLabel(await getConfigValue(connection, 'btnRepostEntry', state.guildId))
      .setStyle(ButtonStyle.Secondary)
  );
  await state.originalInteraction.editReply({
    ...editMsg,
    content: replaceTemplateVariables(state.editCfg.txtEditImportSuccess, {
      turn_number: String(state.turnNumber),
    }),
    components: [...editMsg.components, repostRow],
  });
}
