// Edit-history browse/restore flow — dispatched from story/edit.js's handleEditButton for every
// story_edit_history_*/story_edit_hist_chunk_*/story_edit_restore_*/story_edit_back customId.
// Split out of edit.js (2026-08-26) purely to bring that file back under the project's 500-line
// guideline — no behavior change, and no new state: still reads/writes the same pendingEditData
// sessions (story/_state.js) and story_entry_edit rows edit.js always has.
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags } from 'discord.js';
import { getConfigValue, log, chunkEntryContent } from '../utilities.js';
import { pendingEditData } from './_state.js';
import { ENTRY_STATUS } from '../constants.js';
import { buildEditMessageForState } from './edit.js';

async function renderHistoryPage(connection, interaction, state, histPage, histChunkPage = 0) {
  const [rows] = await connection.execute(
    `SELECT edit_id, content, edited_by_name, edited_at
     FROM story_entry_edit
     WHERE entry_id = ? ORDER BY edited_at DESC LIMIT 1 OFFSET ?`,
    [state.entryId, histPage]
  );
  const [countRow] = await connection.execute(
    `SELECT COUNT(*) AS cnt FROM story_entry_edit WHERE entry_id = ?`,
    [state.entryId]
  );
  const total = countRow[0].cnt;

  const editCfg = state.editCfg ?? {};

  if (rows.length === 0) {
    return buildEditMessageForState(state);
  }

  const histRow = rows[0];
  state.historyPage = histPage;
  state.histChunkPage = histChunkPage;

  const histChunks = chunkEntryContent(histRow.content);
  const chunk = histChunks[histChunkPage];
  const pageLabel = histChunks.length > 1 ? ` · Page ${histChunkPage + 1} of ${histChunks.length}` : '';

  const embed = new EmbedBuilder()
    .setTitle(`Edit History — Version ${total - histPage} of ${total}${pageLabel}`)
    .setDescription(chunk.text)
    .setFooter({ text: `Edited by ${histRow.edited_by_name} · ${histRow.edited_at}` })
    .setColor(0x99aab5);

  if (histChunkPage === 0 && histChunks.length > 1) {
    embed.addFields({ name: '​', value: '*This version spans multiple pages. Restoring will replace your entire current entry and will alter the story\'s turn count.*' });
  } else if (histChunkPage === 0) {
    embed.addFields({ name: '​', value: '*Restoring will replace your entire current entry and will alter the story\'s turn count.*' });
  }

  const buttons = [];

  if (histPage > 0) {
    buttons.push(new ButtonBuilder().setCustomId('story_edit_history_prev').setLabel(editCfg.btnEditHistNewer ?? '← Newer').setStyle(ButtonStyle.Secondary));
  }
  if (histChunkPage > 0) {
    buttons.push(new ButtonBuilder().setCustomId('story_edit_hist_chunk_prev').setLabel(editCfg.btnEditHistPrevPage ?? '← Prev Page').setStyle(ButtonStyle.Secondary));
  }
  if (histChunkPage === 0) {
    buttons.push(new ButtonBuilder()
      .setCustomId(`story_edit_restore_${histRow.edit_id}`)
      .setLabel(editCfg.btnEditRestore ?? 'Restore This Version')
      .setStyle(ButtonStyle.Primary));
  }
  if (histChunkPage < histChunks.length - 1) {
    buttons.push(new ButtonBuilder().setCustomId('story_edit_hist_chunk_next').setLabel(editCfg.btnEditHistNextPage ?? 'Next Page →').setStyle(ButtonStyle.Secondary));
  }
  if (histPage < total - 1) {
    buttons.push(new ButtonBuilder().setCustomId('story_edit_history_next').setLabel(editCfg.btnEditHistOlder ?? 'Older →').setStyle(ButtonStyle.Secondary));
  }
  buttons.push(new ButtonBuilder().setCustomId('story_edit_back').setLabel(editCfg.btnEditBackToEntry ?? '← Back to Entry').setStyle(ButtonStyle.Secondary));

  const components = [];
  for (let i = 0; i < buttons.length; i += 5) {
    components.push(new ActionRowBuilder().addComponents(...buttons.slice(i, i + 5)));
  }

  return { embeds: [embed], components };
}

async function handleRestoreConfirm(connection, interaction, editId) {
  await interaction.deferUpdate();
  const state = pendingEditData.get(interaction.user.id);
  if (!state) return;

  const editCfg = state.editCfg ?? {};

  const embed = new EmbedBuilder()
    .setTitle(editCfg.txtEditRestoreConfirmTitle ?? 'Confirm Restore')
    .setDescription(editCfg.txtEditRestoreConfirmMulti ?? 'Restore this version? This will replace your entire current entry, including content not shown on this page, and will alter the story\'s turn count.')
    .setColor(0xff6b6b);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`story_edit_restore_confirm_${editId}`)
      .setLabel(editCfg.btnEditRestoreConfirm ?? 'Confirm Restore')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('story_edit_restore_cancel')
      .setLabel(editCfg.btnEditRestoreCancel ?? 'Cancel')
      .setStyle(ButtonStyle.Secondary)
  );

  await state.historyMessage.edit({ embeds: [embed], components: [row] });
}

async function handleRestoreExecute(connection, interaction, editId) {
  await interaction.deferUpdate();
  const state = pendingEditData.get(interaction.user.id);
  if (!state) return;

  const [histRows] = await connection.execute(
    `SELECT content FROM story_entry_edit WHERE edit_id = ?`, [editId]
  );
  if (histRows.length === 0) {
    return await state.historyMessage.edit({ content: await getConfigValue(connection, 'txtEditHistoryNotFound', interaction.guild.id), embeds: [], components: [] });
  }

  const editorName = interaction.member?.displayName ?? interaction.user.username;

  // Reverting to a historical version always leaves the entry CONFIRMED (harmless no-op if it
  // already was), even if it happened to be DELETED going in — restoring a deleted entry is a
  // separate, dedicated action (the Restore button, story_edit_manage_restore) that doesn't
  // depend on any history existing; this flow's job is purely "make the content this version's
  // content", and a version restore that silently stayed invisible would be a confusing dead end.
  const txn = await connection.getConnection();
  await txn.beginTransaction();
  try {
    const [current] = await txn.execute(
      `SELECT content FROM story_entry WHERE story_entry_id = ?`, [state.entryId]
    );
    await txn.execute(
      `INSERT INTO story_entry_edit (entry_id, content, edited_by, edited_by_name) VALUES (?, ?, ?, ?)`,
      [state.entryId, current[0].content, interaction.user.id, editorName]
    );
    await txn.execute(
      `UPDATE story_entry SET content = ?, entry_status = ? WHERE story_entry_id = ?`,
      [histRows[0].content, ENTRY_STATUS.CONFIRMED, state.entryId]
    );
    await txn.commit();
  } catch (err) {
    await txn.rollback();
    log(`handleRestoreExecute failed: ${err}`, { show: true, guildName: interaction?.guild?.name });
    throw err;
  } finally {
    txn.release();
  }

  // Close the history followUp and update the edit embed with restored content.
  await state.historyMessage?.delete().catch(() => {});
  state.historyMessage = null;
  state.currentContent = histRows[0].content;
  state.chunks = chunkEntryContent(state.currentContent);
  state.chunkPage = 0;
  state.hasHistory = true;
  state.entryStatus = ENTRY_STATUS.CONFIRMED;
  log(`handleRestoreExecute: entry ${state.entryId} reverted to edit ${editId} by ${interaction.user.username}`, { show: true, guildName: interaction?.guild?.name });

  const [btnRepostEntry, txtEditRestoreSuccess] = await Promise.all([
    getConfigValue(connection, 'btnRepostEntry', state.guildId),
    getConfigValue(connection, 'txtEditRestoreSuccess', state.guildId),
  ]);

  const repostRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`story_repost_entry_${state.entryId}`)
      .setLabel(btnRepostEntry)
      .setStyle(ButtonStyle.Secondary)
  );

  const editMsg = buildEditMessageForState(state);
  await state.originalInteraction.editReply({
    ...editMsg,
    content: txtEditRestoreSuccess,
    components: [...editMsg.components, repostRow]
  });
}

// Single dispatch entry point — mirrors story/_manageClose.js's pattern (one export, called
// inline from the parent's own customId if/else chain). Returns false for any customId it
// doesn't own, so edit.js's handleEditButton can tell "handled" from "not mine" and fall through
// to its own branches unchanged.
async function handleEditHistoryButton(connection, interaction, state) {
  const customId = interaction.customId;

  if (customId === 'story_edit_browse_history') {
    await interaction.deferUpdate();
    state.historyMessage = await state.originalInteraction.followUp({
      ...(await renderHistoryPage(connection, interaction, state, 0, 0)),
      flags: MessageFlags.Ephemeral
    });

  } else if (customId === 'story_edit_history_prev') {
    await interaction.deferUpdate();
    await state.historyMessage.edit(
      await renderHistoryPage(connection, interaction, state, Math.max(0, state.historyPage - 1), 0)
    );

  } else if (customId === 'story_edit_history_next') {
    await interaction.deferUpdate();
    await state.historyMessage.edit(
      await renderHistoryPage(connection, interaction, state, state.historyPage + 1, 0)
    );

  } else if (customId === 'story_edit_hist_chunk_prev') {
    await interaction.deferUpdate();
    await state.historyMessage.edit(
      await renderHistoryPage(connection, interaction, state, state.historyPage, (state.histChunkPage ?? 0) - 1)
    );

  } else if (customId === 'story_edit_hist_chunk_next') {
    await interaction.deferUpdate();
    await state.historyMessage.edit(
      await renderHistoryPage(connection, interaction, state, state.historyPage, (state.histChunkPage ?? 0) + 1)
    );

  } else if (customId === 'story_edit_restore_cancel') {
    await interaction.deferUpdate();
    await state.historyMessage.edit(
      await renderHistoryPage(connection, interaction, state, state.historyPage, state.histChunkPage ?? 0)
    );

  } else if (customId.startsWith('story_edit_restore_confirm_')) {
    const editId = parseInt(customId.split('_').at(-1));
    await handleRestoreExecute(connection, interaction, editId);

  } else if (customId.startsWith('story_edit_restore_')) {
    const editId = parseInt(customId.split('_').at(-1));
    await handleRestoreConfirm(connection, interaction, editId);

  } else if (customId === 'story_edit_back') {
    // Close the history followUp and return focus to the edit embed.
    // Ephemeral followUps can't be deleted via message.delete() — must use the interaction webhook.
    await interaction.deferUpdate();
    await state.originalInteraction.deleteReply(state.historyMessage).catch(() => {});
    state.historyMessage = null;

  } else {
    return false;
  }
  return true;
}

export { handleEditHistoryButton, renderHistoryPage, handleRestoreConfirm, handleRestoreExecute };
