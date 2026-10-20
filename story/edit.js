import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags, EmbedBuilder, StringSelectMenuBuilder, LabelBuilder } from 'discord.js';
import { getConfigValue, log, sanitizeModalInput, resolveStoryId, chunkEntryContent, restoreChunkEdges, splitAtParagraphs, checkIsAdmin, checkIsCreator, replaceTemplateVariables, EDIT_PAGE_LIMIT } from '../utilities.js';
import { postThreadEntry } from './_entryRenderer.js';
import { resolveMentionsToPlainText } from './_entryMarkup.js';
import { pendingReadData, pendingEditData } from './_state.js';
import { buildReadEmbed } from './read.js';
import { getActiveThreadId } from '../storybot.js';
import { buildEntryPickerMessage } from './_manageEntriesList.js';
import { handleEditHistoryButton } from './_editHistory.js';
import { ENTRY_STATUS } from '../constants.js';

export { pendingEditData };

// Every config key buildEditMessage() and buildEntryModal() read. Exported because story/read.js
// opens the same panel and the same modal from its own Edit button and so needs the identical
// set — it previously kept a hand-maintained copy of this list, which silently went stale the
// moment a key was added here (the modal would then render key names instead of text).
export const EDIT_PANEL_CONFIG_KEYS = [
  'lblEditPageSplitNotice', 'txtEditPageSplitInstructions',
  'btnEditPrev', 'btnEditNext', 'btnEditOpen', 'btnEditHistory', 'lblEditEntryContent',
  'btnEditAddPage', 'txtEditModalPageHint',
  'lblEditEmbedTitle', 'txtEditEmbedFooter', 'lblEditModalTitle',
  'txtEditRestoreWarningMulti', 'txtEditRestoreWarningSingle',
  'btnEditHistNewer', 'btnEditHistPrevPage', 'btnEditRestore',
  'btnEditHistNextPage', 'btnEditHistOlder', 'btnEditBackToEntry',
  'lblPageJumpPlaceholder', 'lblPageJumpOption',
  'txtEditRestoreConfirmMulti',
  'txtEditRestoreConfirmTitle', 'btnEditRestoreConfirm', 'btnEditRestoreCancel',
];

async function handleEdit(connection, interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const guildId = interaction.guild.id;
  const storyId = await resolveStoryId(connection, guildId, interaction.options.getString('story_id'));
  if (!storyId) {
    return await interaction.editReply({ content: await getConfigValue(connection, 'txtStoryNotFound', guildId) });
  }

  const turnNumber = interaction.options.getInteger('turn');
  if (turnNumber == null) {
    // No turn given — show the caller's own editable entries as a picker instead of requiring
    // them to already know a turn number.
    log(`handleEdit: no turn given, opening entry picker for story ${storyId}`, { show: false, guildName: interaction?.guild?.name });
    const msg = await buildEntryPickerMessage(connection, guildId, storyId, 0, 'author', interaction.user.id);
    await interaction.editReply(msg);
    return;
  }
  await openEditSession(connection, interaction, guildId, storyId, turnNumber, null);
}

// Shared session-setup used by /story edit (handleEdit), the contextual Edit button in
// /story read (handleReadEditButton), and the entry pickers (handleMyPickSelect below,
// story/_manageEntries.js for admins).
// Pass turnNumber to resolve by turn, or entryId to resolve directly.
//
// options.manageMode — admin-only capabilities (Delete/Restore buttons) on the resulting view.
//   Requires the caller to be admin or the story's creator (checked below) — matches the same
//   gate already used to reach the Manage Entries panel (story/manage.js).
// options.allowDeleted — when true (only ever passed alongside manageMode), a DELETED entry can
//   be loaded (normally excluded — deleted entries aren't reachable through /story edit at all).
// options.pickerContext — { role: 'admin'|'author', listOffset, storyId } set when this session
//   was opened from either entry picker rather than a direct turn number; enables the generic
//   "Back to entries list" button.
async function openEditSession(connection, interaction, guildId, storyId, turnNumber, entryId, options = {}) {
  const { manageMode = false, allowDeleted = false, pickerContext = null } = options;
  log(`openEditSession entry storyId=${storyId} turnNumber=${turnNumber} entryId=${entryId} manageMode=${manageMode} user=${interaction.user.username}`, { show: false, guildName: interaction?.guild?.name });
  let entryRows;

  if (entryId != null) {
    // Path B: resolve directly from a known entry ID (from the read view Edit button, or either picker)
    const statuses = allowDeleted ? [ENTRY_STATUS.CONFIRMED, ENTRY_STATUS.DELETED] : [ENTRY_STATUS.CONFIRMED];
    [entryRows] = await connection.execute(
      `SELECT se.story_entry_id, se.content, se.created_at, se.entry_status,
              sw.discord_user_id AS original_author_id, sw.discord_display_name AS author_name,
              s.guild_story_id, s.title,
              (SELECT COUNT(DISTINCT t2.turn_id)
               FROM turn t2
               JOIN story_writer sw2 ON t2.story_writer_id = sw2.story_writer_id
               JOIN story_entry se2 ON se2.turn_id = t2.turn_id
                 AND se2.entry_status = ?
               WHERE sw2.story_id = sw.story_id AND t2.started_at <= t.started_at
              ) AS turn_number
       FROM story_entry se
       JOIN turn t ON se.turn_id = t.turn_id
       JOIN story_writer sw ON t.story_writer_id = sw.story_writer_id
       JOIN story s ON sw.story_id = s.story_id
       WHERE se.story_entry_id = ?
         AND se.entry_status IN (${statuses.map(() => '?').join(', ')})`,
      [ENTRY_STATUS.CONFIRMED, entryId, ...statuses]
    );
  } else {
    // Path A: resolve by turn number — uses confirmed-only count to match /story read numbering
    [entryRows] = await connection.execute(
      `SELECT se.story_entry_id, se.content, se.created_at, se.entry_status,
              sw.discord_user_id AS original_author_id, sw.discord_display_name AS author_name,
              s.guild_story_id, s.title
       FROM story_entry se
       JOIN turn t ON se.turn_id = t.turn_id
       JOIN story_writer sw ON t.story_writer_id = sw.story_writer_id
       JOIN story s ON sw.story_id = s.story_id
       WHERE sw.story_id = ?
         AND se.entry_status = ?
         AND (
           SELECT COUNT(DISTINCT t2.turn_id)
           FROM turn t2
           JOIN story_writer sw2 ON t2.story_writer_id = sw2.story_writer_id
           JOIN story_entry se2 ON se2.turn_id = t2.turn_id
             AND se2.entry_status = ?
           WHERE sw2.story_id = sw.story_id AND t2.started_at <= t.started_at
         ) = ?`,
      [storyId, ENTRY_STATUS.CONFIRMED, ENTRY_STATUS.CONFIRMED, turnNumber]
    );
  }

  if (entryRows.length === 0) {
    return await interaction.editReply({ content: await getConfigValue(connection, 'txtEditEntryNotFound', guildId) });
  }
  const entry = entryRows[0];
  const resolvedTurnNumber = turnNumber ?? entry.turn_number;

  const isAdmin = await checkIsAdmin(connection, interaction, guildId);
  const isAuthor = String(entry.original_author_id) === interaction.user.id;

  if (manageMode) {
    // Manage Entries' admin gate is isAdmin || isCreator (story/manage.js) — match it here so a
    // non-admin story creator who legitimately reached the panel isn't walled out of using it.
    const isCreator = await checkIsCreator(connection, storyId, interaction.user.id);
    if (!isAdmin && !isCreator) {
      log(`openEditSession: manageMode denied for user ${interaction.user.username} on story ${storyId} (not admin or creator)`, { show: true, guildName: interaction?.guild?.name });
      return await interaction.editReply({ content: await getConfigValue(connection, 'txtEditNotAuthorized', guildId) });
    }
  } else if (!isAdmin && !isAuthor) {
    return await interaction.editReply({ content: await getConfigValue(connection, 'txtEditNotAuthorized', guildId) });
  }

  const [histRows] = await connection.execute(
    `SELECT COUNT(*) AS cnt FROM story_entry_edit WHERE entry_id = ?`,
    [entry.story_entry_id]
  );
  const hasHistory = histRows[0].cnt > 0;
  const chunks = chunkEntryContent(entry.content);
  const storyTitle = entry.title.length > 50 ? entry.title.slice(0, 50) + '…' : entry.title;

  pendingEditData.set(interaction.user.id, {
    entryId: entry.story_entry_id,
    entryStatus: entry.entry_status,
    storyId,
    guildId,
    originalAuthorId: String(entry.original_author_id),
    authorName: entry.author_name,
    createdAt: entry.created_at,
    currentContent: entry.content,
    chunks,
    chunkPage: 0,
    hasHistory,
    historyPage: 0,
    turnNumber: resolvedTurnNumber,
    storyTitle,
    guildStoryId: entry.guild_story_id,
    originalInteraction: interaction,
    manageMode,
    pickerContext: pickerContext ? { ...pickerContext, storyId: pickerContext.storyId ?? storyId } : null,
  });

  const editCfg = await getConfigValue(connection, [
    ...EDIT_PANEL_CONFIG_KEYS,
    'btnEditBackToList',
    'btnManageEntriesDelete', 'btnManageEntriesRestore',
    'txtManageEntryDeleteSuccess', 'txtManageEntryRestoreSuccess',
    'txtManageEntryAlreadyDeleted', 'txtManageEntryAlreadyConfirmed',
  ], guildId);

  const state = pendingEditData.get(interaction.user.id);
  if (state) state.editCfg = editCfg;

  log(`openEditSession: opened entry ${entry.story_entry_id} for user ${interaction.user.username} on story ${storyId} (manageMode=${manageMode})`, { show: false, guildName: interaction?.guild?.name });

  await interaction.editReply(buildEditMessageForState(state));
}

// Convenience wrapper for the (much more common) case of rendering from a live pendingEditData
// session — keeps the ~8-param buildEditMessage() call in exactly one place internally, so the
// several call sites in this file (and story/_editHistory.js, which imports this) can't drift
// out of sync with each other.
export function buildEditMessageForState(state) {
  return buildEditMessage(
    state.chunks, state.chunkPage, state.hasHistory, state.turnNumber,
    state.storyTitle, state.guildStoryId, state.editCfg ?? {},
    { manageMode: state.manageMode, entryStatus: state.entryStatus, hasPicker: !!state.pickerContext }
  );
}

function buildEditMessage(chunks, chunkPage, hasHistory, turnNumber, storyTitle, guildStoryId, editCfg, pickerOpts = {}) {
  const { manageMode = false, entryStatus = null, hasPicker = false } = pickerOpts;
  const chunk = chunks[chunkPage];
  const isMultiPage = chunks.length > 1;

  // Page tokens are omitted on a single-page entry so the {?...?} block in lblEditEmbedTitle
  // strips itself, rather than this building the " · Page x of y" suffix inline.
  const pageTokens = isMultiPage
    ? { page: String(chunkPage + 1), total: String(chunks.length) }
    : {};

  const embed = new EmbedBuilder()
    .setTitle(replaceTemplateVariables(editCfg.lblEditEmbedTitle, {
      story_num: String(guildStoryId), title: storyTitle, turn: String(turnNumber), ...pageTokens
    }))
    // A page added by btnEditAddPage is empty until it's saved, and setDescription() rejects an
    // empty string (the validator requires length >= 1), so an em space stands in. CLAUDE.md
    // permits the unicode space character as the one hard-coded exception.
    .setDescription(chunk.text || ' ')
    .setFooter({ text: replaceTemplateVariables(editCfg.txtEditEmbedFooter, {
      chars: String(chunk.text.length),
      limit: String(EDIT_PAGE_LIMIT),
      total_chars: String(chunks[chunks.length - 1].end)
    }) })
    .setColor(0xffd700);

  if (isMultiPage) {
    embed.addFields({
      name: editCfg.lblEditPageSplitNotice,
      value: editCfg.txtEditPageSplitInstructions
    });
  }

  // Jump-to-page select menu — mirrors the read embed's page-jump menu (read.js buildReadEmbed)
  const components = [];
  if (isMultiPage) {
    const maxOptions = 25;
    let rangeStart = Math.max(0, chunkPage - Math.floor(maxOptions / 2));
    const rangeEnd = Math.min(chunks.length, rangeStart + maxOptions);
    rangeStart = Math.max(0, rangeEnd - maxOptions);
    const optionTemplate = editCfg.lblPageJumpOption;
    const placeholderTemplate = editCfg.lblPageJumpPlaceholder;
    const options = [];
    for (let i = rangeStart; i < rangeEnd; i++) {
      const label = replaceTemplateVariables(optionTemplate, { page: String(i + 1) }).slice(0, 100);
      options.push({ label, value: String(i), default: i === chunkPage });
    }
    const placeholder = replaceTemplateVariables(placeholderTemplate, { page: String(chunkPage + 1), total: String(chunks.length) });
    components.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('story_edit_jump')
          .setPlaceholder(placeholder)
          .addOptions(options)
      )
    );
  }

  // Only show navigation buttons when there are multiple pages.
  // Only show History button when edit history exists.
  const buttons = [];

  if (isMultiPage) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId('story_edit_prev')
        .setLabel(editCfg.btnEditPrev)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(chunkPage === 0),
      new ButtonBuilder()
        .setCustomId('story_edit_next')
        .setLabel(editCfg.btnEditNext)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(chunkPage === chunks.length - 1)
    );
  }

  buttons.push(
    new ButtonBuilder()
      .setCustomId('story_edit_open_modal')
      .setLabel(editCfg.btnEditOpen)
      .setStyle(ButtonStyle.Primary)
      .setDisabled(false)
  );

  // Appends an empty page at the end of the entry and opens it. Shown unconditionally rather
  // than only when the last page is near full: the whole point is discoverability, and a
  // conditional button is one more rule for a writer to work out. Note this row now carries up
  // to 5 buttons (Prev/Next/Edit/Add Page/History), which is Discord's per-row maximum — adding
  // another means splitting the row.
  buttons.push(
    new ButtonBuilder()
      .setCustomId('story_edit_add_page')
      .setLabel(editCfg.btnEditAddPage)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(false)
  );

  if (hasHistory) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId('story_edit_browse_history')
        .setLabel(editCfg.btnEditHistory)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(false)
    );
  }

  components.push(new ActionRowBuilder().addComponents(...buttons));

  // Admin-only actions (Manage Entries) — Delete/Restore toggle entry_status directly and are
  // independent of edit history (Restore works even on an entry that's never been edited).
  if (manageMode) {
    components.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('story_edit_manage_delete')
        .setLabel(editCfg.btnManageEntriesDelete)
        .setStyle(ButtonStyle.Danger)
        .setDisabled(entryStatus === ENTRY_STATUS.DELETED),
      new ButtonBuilder()
        .setCustomId('story_edit_manage_restore')
        .setLabel(editCfg.btnManageEntriesRestore)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(entryStatus !== ENTRY_STATUS.DELETED)
    ));
  }

  // Shown whenever this session was reached via either entry picker (admin or author), so there's
  // a way back to it — not shown when reached directly by turn number or Read's Edit button.
  if (hasPicker) {
    components.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('story_edit_backlist')
        .setLabel(editCfg.btnEditBackToList)
        .setStyle(ButtonStyle.Secondary)
    ));
  }

  return { embeds: [embed], components };
}

// The entry picker's select menu (author role, /story edit with no turn given) has no
// pendingEditData session yet the first time it's used, so it's handled before the generic
// "no state" bail below — the storyId travels in the customId itself (stateless, same pattern
// already used elsewhere in this file for entry/edit IDs).
async function handleMyPickSelect(connection, interaction) {
  const storyId = parseInt(interaction.customId.replace('story_edit_mypick_select_', ''), 10);
  const guildId = interaction.guild.id;
  const selected = interaction.values[0];
  log(`handleMyPickSelect entry storyId=${storyId} selected=${selected} user=${interaction.user.username}`, { show: false, guildName: interaction?.guild?.name });

  if (selected.startsWith('__entrypage__')) {
    const newOffset = parseInt(selected.replace('__entrypage__', ''), 10);
    const msg = await buildEntryPickerMessage(connection, guildId, storyId, newOffset, 'author', interaction.user.id);
    await interaction.update(msg);
    return;
  }

  const entryId = parseInt(selected, 10);
  log(`handleMyPickSelect: entry ${entryId} selected by ${interaction.user.username}`, { show: false, guildName: interaction?.guild?.name });
  await interaction.deferUpdate();
  await openEditSession(connection, interaction, guildId, storyId, null, entryId, {
    pickerContext: { role: 'author', listOffset: 0, storyId }
  });
}

async function handleEditButton(connection, interaction) {
  const userId = interaction.user.id;
  const customId = interaction.customId;

  if (customId.startsWith('story_edit_mypick_select_')) {
    await handleMyPickSelect(connection, interaction);
    return;
  }

  const state = pendingEditData.get(userId);
  log(`handleEditButton entry customId=${customId} userId=${userId} hasState=${!!state}`, { show: false, guildName: interaction?.guild?.name });

  if (!state) {
    await interaction.deferUpdate();
    return;
  }

  if (customId === 'story_edit_prev') {
    await interaction.deferUpdate();
    state.chunkPage = Math.max(0, state.chunkPage - 1);
    await state.originalInteraction.editReply(buildEditMessageForState(state));

  } else if (customId === 'story_edit_next') {
    await interaction.deferUpdate();
    state.chunkPage = Math.min(state.chunks.length - 1, state.chunkPage + 1);
    await state.originalInteraction.editReply(buildEditMessageForState(state));

  } else if (customId === 'story_edit_jump') {
    await interaction.deferUpdate();
    const selected = parseInt(interaction.values[0]);
    if (!isNaN(selected)) {
      state.chunkPage = Math.min(state.chunks.length - 1, Math.max(0, selected));
    }
    await state.originalInteraction.editReply(buildEditMessageForState(state));

  } else if (customId === 'story_edit_manage_delete') {
    await interaction.deferUpdate();
    if (state.entryStatus === ENTRY_STATUS.DELETED) {
      log(`story_edit_manage_delete: entry ${state.entryId} already deleted`, { show: false, guildName: interaction?.guild?.name });
      await interaction.followUp({ content: state.editCfg?.txtManageEntryAlreadyDeleted, flags: MessageFlags.Ephemeral });
      return;
    }
    await connection.execute(`UPDATE story_entry SET entry_status = ? WHERE story_entry_id = ?`, [ENTRY_STATUS.DELETED, state.entryId]);
    state.entryStatus = ENTRY_STATUS.DELETED;
    log(`Entry deleted via Manage Entries: ${state.entryId} by ${interaction.user.username}`, { show: true, guildName: interaction?.guild?.name });
    // Confirmation goes in its own message below the panel — as panel content it rendered
    // above the embed, out of sight.
    await state.originalInteraction.editReply({ ...buildEditMessageForState(state), content: '' });
    await interaction.followUp({
      content: replaceTemplateVariables(state.editCfg?.txtManageEntryDeleteSuccess ?? '', { entry_id: String(state.entryId) }),
      flags: MessageFlags.Ephemeral
    });

  } else if (customId === 'story_edit_manage_restore') {
    await interaction.deferUpdate();
    if (state.entryStatus !== ENTRY_STATUS.DELETED) {
      log(`story_edit_manage_restore: entry ${state.entryId} not deleted`, { show: false, guildName: interaction?.guild?.name });
      await interaction.followUp({ content: state.editCfg?.txtManageEntryAlreadyConfirmed, flags: MessageFlags.Ephemeral });
      return;
    }
    await connection.execute(`UPDATE story_entry SET entry_status = ? WHERE story_entry_id = ?`, [ENTRY_STATUS.CONFIRMED, state.entryId]);
    state.entryStatus = ENTRY_STATUS.CONFIRMED;
    log(`Entry restored via Manage Entries: ${state.entryId} by ${interaction.user.username}`, { show: true, guildName: interaction?.guild?.name });
    // Confirmation goes in its own message below the panel — as panel content it rendered
    // above the embed, out of sight.
    await state.originalInteraction.editReply({ ...buildEditMessageForState(state), content: '' });
    await interaction.followUp({
      content: replaceTemplateVariables(state.editCfg?.txtManageEntryRestoreSuccess ?? '', { writer_name: state.authorName ?? '' }),
      flags: MessageFlags.Ephemeral
    });

  } else if (customId === 'story_edit_backlist') {
    await interaction.deferUpdate();
    const picker = state.pickerContext;
    const guildId = state.guildId;
    pendingEditData.delete(userId);
    if (!picker) return; // button is only ever shown when pickerContext is set
    log(`story_edit_backlist: returning to ${picker.role} entry list for story ${picker.storyId} (user ${interaction.user.username})`, { show: false, guildName: interaction?.guild?.name });
    const msg = await buildEntryPickerMessage(connection, guildId, picker.storyId, picker.listOffset ?? 0, picker.role, picker.role === 'author' ? userId : null);
    await state.originalInteraction.editReply(msg);

  } else if (customId === 'story_edit_open_modal') {
    // No defer — showModal must be the first response
    await interaction.showModal(buildEntryModal(state));

  } else if (customId === 'story_edit_add_page') {
    // Appends an empty page at the end of the entry and opens it, so growing an entry no longer
    // means saving and reopening to force a re-chunk. start === end === content length makes the
    // splice in handleEditModalSubmit a pure append. isNew marks it so an empty submit can drop
    // the page instead of erroring, and so the save knows to add the paragraph break.
    //
    // No defer — showModal must be the first response, which also means the embed behind the
    // modal still shows the previous page. If the writer cancels, the empty page stays in state
    // but contributes nothing to any later save (it spans no characters), and the next
    // openEditSession re-chunks from content and drops it.
    const contentLength = state.currentContent.length;
    state.chunks.push({ text: '', start: contentLength, end: contentLength, isNew: true });
    state.chunkPage = state.chunks.length - 1;
    log(`story_edit_add_page: entry ${state.entryId} now has ${state.chunks.length} page(s) in session (user ${interaction.user.username})`, { show: false, guildName: interaction?.guild?.name });
    await interaction.showModal(buildEntryModal(state));

  } else if (customId.startsWith('story_edit_next_entry_')) {
    const nextEntryId = parseInt(customId.split('_').at(-1));
    await interaction.deferUpdate();
    await openEditSession(connection, interaction, state.guildId, state.storyId, null, nextEntryId);

  } else if (customId.startsWith('story_repost_entry_')) {
    await handleRepostEntry(connection, interaction);

  } else {
    // History browse/restore (story_edit_history_*/story_edit_hist_chunk_*/story_edit_restore_*/
    // story_edit_back) — split out to story/_editHistory.js (2026-08-26) to bring this file back
    // under the project's 500-line guideline. Kept as the final fallthrough branch here rather
    // than moved earlier in the chain, so every customId this file owns directly still short-
    // circuits before reaching this delegated call.
    await handleEditHistoryButton(connection, interaction, state);
  }
}

// The paragraph break needed in front of text appended to the end of an entry, so the appended
// page starts a new paragraph without stacking blank lines on whatever the entry already ends with.
function leadingBreakFor(content) {
  if (!content) return '';
  if (content.endsWith('\n\n')) return '';
  if (content.endsWith('\n')) return '\n';
  return '\n\n';
}

// The edit modal, shared by the Edit button and Add Page. The entryId and page are in the
// customId so Discord can't cache modal content across entries or pages.
//
// The per-page guidance is a LabelBuilder description, not a TextInputBuilder placeholder: a
// placeholder only renders over an empty field, and setValue() below always pre-fills one, so
// the previous placeholder-based hint was never visible to anyone.
export function buildEntryModal(state) {
  const cfg = state.editCfg ?? {};
  const isMultiPage = state.chunks.length > 1;
  const pageTokens = isMultiPage
    ? { page: String(state.chunkPage + 1), total: String(state.chunks.length) }
    : {};
  const chunk = state.chunks[state.chunkPage];

  const input = new TextInputBuilder()
    .setCustomId('entry_content')
    .setStyle(TextInputStyle.Paragraph)
    .setMaxLength(4000)
    .setValue(chunk.text.slice(0, 4000));

  return new ModalBuilder()
    .setCustomId(`story_edit_modal_${state.entryId}_p${state.chunkPage}`)
    .setTitle(replaceTemplateVariables(cfg.lblEditModalTitle, pageTokens))
    .addLabelComponents(
      new LabelBuilder()
        .setLabel(cfg.lblEditEntryContent)
        .setDescription(replaceTemplateVariables(cfg.txtEditModalPageHint, {
          page: String(state.chunkPage + 1),
          total: String(state.chunks.length),
          chars: String(chunk.text.length),
          limit: String(EDIT_PAGE_LIMIT)
        }))
        .setTextInputComponent(input)
    );
}

async function handleEditModalSubmit(connection, interaction) {
  const userId = interaction.user.id;
  const state = pendingEditData.get(userId);
  if (!state) {
    return await interaction.reply({
      content: await getConfigValue(connection, 'txtEditSessionExpired', interaction.guild?.id ?? state?.guildId),
      flags: MessageFlags.Ephemeral
    });
  }

  const editedChunk = sanitizeModalInput(
    interaction.fields.getTextInputValue('entry_content'),
    4000, true
  );
  if (!editedChunk) {
    // A page added by Add Page that comes back empty means "never mind", not an error — drop the
    // page and refresh the panel. Emptying a page that holds real text is still rejected, since
    // that would silently delete part of the entry.
    const pendingPage = state.chunks[state.chunkPage];
    if (pendingPage?.isNew) {
      state.chunks.splice(state.chunkPage, 1);
      state.chunkPage = Math.max(0, state.chunks.length - 1);
      log(`handleEditModalSubmit: discarded unsaved added page on entry ${state.entryId} (user ${interaction.user.username})`, { show: false, guildName: interaction?.guild?.name });
      await interaction.deferUpdate();
      return await interaction.editReply(buildEditMessageForState(state));
    }
    return await interaction.reply({ content: await getConfigValue(connection, 'txtEditEntryEmpty', state.guildId), flags: MessageFlags.Ephemeral });
  }

  // This modal's interaction carries the message it was opened from (isFromMessage()) —
  // the read embed for read-path edits, the edit embed otherwise — so deferUpdate + editReply
  // on `interaction` refreshes it in place. (state.originalInteraction is the button click that
  // opened the modal via showModal(); showModal responses have no message of their own, so
  // editReply on that interaction has nothing to target.)
  await interaction.deferUpdate();

  const [entryRows] = await connection.execute(
    `SELECT content FROM story_entry WHERE story_entry_id = ?`, [state.entryId]
  );
  if (entryRows.length === 0) {
    await interaction.followUp({ content: await getConfigValue(connection, 'txtEditEntryNotFound', state.guildId), flags: MessageFlags.Ephemeral });
    return;
  }

  const currentContent = entryRows[0].content;
  const chunk = state.chunks[state.chunkPage];

  // Resolve mentions to plain display text in the new text only — see
  // docs/plans/PLAN-mention-display-text.md. An edit is a new submission of this chunk, so it
  // goes through the same resolution as any other write. The untouched surrounding
  // currentContent is left alone rather than re-resolved: it's either already plain text from a
  // prior write, or (for entries written before this feature existed) still holds raw tokens
  // that resolveMentionsToPlainText would happily flatten too, but touching text outside what
  // the writer actually edited isn't this action's job.
  const resolvedChunk = await resolveMentionsToPlainText(
    editedChunk, interaction.guild,
    await getConfigValue(connection, [
      'txtExportPlaceholderUser', 'txtExportPlaceholderChannel', 'txtExportPlaceholderRole'
    ], state.guildId)
  );
  // A page added by Add Page has no existing text and no seam of its own, so it carries the
  // paragraph break that would normally separate it from the page before. It also appends at the
  // freshly-read content length rather than the offset captured when the button was pressed, so
  // an edit landing in between can't make it splice at a stale position.
  const savedChunk = chunk.isNew
    ? leadingBreakFor(currentContent) + resolvedChunk.trim()
    // Put back the seam whitespace the modal trimmed, or the page's closing paragraph break is lost.
    : restoreChunkEdges(chunk.text, resolvedChunk);
  log(`handleEditModalSubmit: entry ${state.entryId} page ${state.chunkPage}${chunk.isNew ? ' (added)' : ''} saved ${savedChunk.length} chars (modal returned ${editedChunk.length}, after mentions ${resolvedChunk.length})`, { show: false, guildName: interaction?.guild?.name });
  const newContent = chunk.isNew
    ? currentContent + savedChunk
    : currentContent.slice(0, chunk.start) + savedChunk + currentContent.slice(chunk.end);

  const editorName = interaction.member?.displayName ?? interaction.user.username;

  const txn = await connection.getConnection();
  await txn.beginTransaction();
  try {
    await txn.execute(
      `INSERT INTO story_entry_edit (entry_id, content, edited_by, edited_by_name) VALUES (?, ?, ?, ?)`,
      [state.entryId, currentContent, userId, editorName]
    );
    await txn.execute(
      `UPDATE story_entry SET content = ? WHERE story_entry_id = ?`,
      [newContent, state.entryId]
    );
    await txn.commit();
  } catch (err) {
    await txn.rollback();
    log(`handleEditModalSubmit failed: ${err}`, { show: true, guildName: interaction?.guild?.name });
    throw err;
  } finally {
    txn.release();
  }

  if (state.fromReadPath) {
    // Refresh the read embed in place with updated content; no edit embed shown.
    const session = pendingReadData.get(userId);
    if (session) {
      session.contentMap.set(state.entryId, newContent);
      session.wordCount = Array.from(session.contentMap.values())
        .reduce((total, c) => total + c.trim().split(/\s+/).filter(w => w.length > 0).length, 0);
      const readPage = session.pages[session.currentPage];
      if (readPage) {
        const freshChunks = chunkEntryContent(newContent);
        readPage.content = (freshChunks[state.chunkPage] ?? freshChunks[0]).text;
      }
      session.pendingRepostEntryId = state.entryId;
      session.btnRepostEntry = await getConfigValue(connection, 'btnRepostEntry', session.guildId);
      await interaction.editReply(buildReadEmbed(session, session.currentPage));
    }
    pendingEditData.delete(userId);
    return;
  }

  // Command path: update state with stable chunk boundaries (do NOT re-chunk from scratch,
  // as that shifts boundaries and causes orphaned content on subsequent edits).
  // Measure what was actually stored (seam whitespace restored, mentions resolved), not the raw
  // modal value, or the later pages' boundaries drift.
  //
  // A page added by Add Page is rewritten from where the append actually landed, and loses its
  // isNew flag: without that, editing the same page again before reopening would append a second
  // copy instead of replacing it. It is always the last page, so nothing after it needs shifting.
  if (chunk.isNew) {
    state.chunks[state.chunkPage] = {
      text: savedChunk,
      start: currentContent.length,
      end: currentContent.length + savedChunk.length
    };
  } else {
    const delta = savedChunk.length - (chunk.end - chunk.start);
    state.chunks[state.chunkPage] = {
      text: savedChunk,
      start: chunk.start,
      end: chunk.start + savedChunk.length
    };
    for (let i = state.chunkPage + 1; i < state.chunks.length; i++) {
      state.chunks[i] = {
        ...state.chunks[i],
        start: state.chunks[i].start + delta,
        end: state.chunks[i].end + delta
      };
    }
  }
  state.currentContent = newContent;
  state.hasHistory = true;

  // Keep the read session current so navigation shows fresh content (multi-chunk read-path edits)
  const readSession = pendingReadData.get(userId);
  if (readSession) {
    readSession.contentMap.set(state.entryId, newContent);
    readSession.wordCount = Array.from(readSession.contentMap.values())
      .reduce((total, c) => total + c.trim().split(/\s+/).filter(w => w.length > 0).length, 0);
    const freshReadChunks = splitAtParagraphs(newContent);
    const entryPages = readSession.pages.filter(p => p.storyEntryId == state.entryId);
    entryPages.forEach((p, i) => { if (freshReadChunks[i] !== undefined) p.content = freshReadChunks[i]; });
  }

  const editMsg = buildEditMessageForState(state);

  const extraButtons = [];

  const btnRepostEntry = await getConfigValue(connection, 'btnRepostEntry', state.guildId);
  extraButtons.push(
    new ButtonBuilder()
      .setCustomId(`story_repost_entry_${state.entryId}`)
      .setLabel(btnRepostEntry)
      .setStyle(ButtonStyle.Secondary)
  );

  // For admins: check if a next confirmed entry exists and offer to jump straight to editing it.
  const isAdmin = await checkIsAdmin(connection, interaction, state.guildId);
  if (isAdmin) {
    const [nextRows] = await connection.execute(
      `SELECT se.story_entry_id FROM story_entry se
       JOIN turn t ON se.turn_id = t.turn_id
       JOIN story_writer sw ON t.story_writer_id = sw.story_writer_id
       WHERE sw.story_id = ? AND se.entry_status = ?
         AND (
           SELECT COUNT(DISTINCT t2.turn_id)
           FROM turn t2
           JOIN story_writer sw2 ON t2.story_writer_id = sw2.story_writer_id
           JOIN story_entry se2 ON se2.turn_id = t2.turn_id AND se2.entry_status = ?
           WHERE sw2.story_id = sw.story_id AND t2.started_at <= t.started_at
         ) = ?`,
      [state.storyId, ENTRY_STATUS.CONFIRMED, ENTRY_STATUS.CONFIRMED, state.turnNumber + 1]
    );
    if (nextRows.length > 0) {
      extraButtons.push(
        new ButtonBuilder()
          .setCustomId(`story_edit_next_entry_${nextRows[0].story_entry_id}`)
          .setLabel('Edit Next Entry →')
          .setStyle(ButtonStyle.Primary)
      );
    }
  }

  const extraRow = new ActionRowBuilder().addComponents(...extraButtons);
  await interaction.editReply({ ...editMsg, components: [...editMsg.components, extraRow] });
}

/**
 * Handle repost entry button — posts the current confirmed content of an entry to the story thread
 */
async function handleRepostEntry(connection, interaction) {
  const deferred = await interaction.deferUpdate().then(() => true).catch(() => false);

  const entryId = parseInt(interaction.customId.split('_').at(-1));
  log(`handleRepostEntry: start entryId=${entryId} deferred=${deferred}`, { show: true, guildName: interaction?.guild?.name });

  try {
    const [rows] = await connection.execute(
      `SELECT se.content, se.created_at, sw.discord_display_name, sw.discord_user_id AS original_author_id,
              s.story_thread_id, s.restricted_thread_id, s.rating, s.show_authors, s.scene_break_divider,
              (SELECT COUNT(DISTINCT t2.turn_id)
               FROM turn t2
               JOIN story_writer sw2 ON t2.story_writer_id = sw2.story_writer_id
               JOIN story_entry se2 ON se2.turn_id = t2.turn_id AND se2.entry_status = ?
               WHERE sw2.story_id = sw.story_id AND t2.started_at <= t.started_at) AS turn_number,
              (SELECT see.edited_at FROM story_entry_edit see WHERE see.entry_id = se.story_entry_id ORDER BY see.edited_at DESC LIMIT 1) AS last_edited_at,
              (SELECT see.edited_by FROM story_entry_edit see WHERE see.entry_id = se.story_entry_id ORDER BY see.edited_at DESC LIMIT 1) AS last_editor_id
       FROM story_entry se
       JOIN turn t ON se.turn_id = t.turn_id
       JOIN story_writer sw ON t.story_writer_id = sw.story_writer_id
       JOIN story s ON sw.story_id = s.story_id
       WHERE se.story_entry_id = ? AND se.entry_status = ?`,
      [ENTRY_STATUS.CONFIRMED, entryId, ENTRY_STATUS.CONFIRMED]
    );

    if (rows.length === 0) {
      return await interaction.editReply({
        content: await getConfigValue(connection, 'txtEditEntryNotFound', interaction.guild.id),
        components: []
      });
    }

    const { content, created_at, discord_display_name, original_author_id, show_authors, scene_break_divider, turn_number, last_edited_at, last_editor_id } = rows[0];
    const activeThreadId = getActiveThreadId(rows[0]);

    if (!activeThreadId) {
      return await interaction.editReply({
        content: await getConfigValue(connection, 'txtRepostThreadNotFound', interaction.guild.id),
        components: []
      });
    }

    const storyThread = await interaction.guild.channels.fetch(activeThreadId).catch(() => null);
    if (!storyThread) {
      return await interaction.editReply({
        content: await getConfigValue(connection, 'txtRepostThreadNotFound', interaction.guild.id),
        components: []
      });
    }

    let showEdited = false;
    if (last_edited_at) {
      const isGrace = String(last_editor_id) === String(original_author_id) &&
                      (new Date(last_edited_at) - new Date(created_at)) <= 60 * 60 * 1000;
      showEdited = !isGrace;
    }

    const authorLine = show_authors
      ? `Turn ${turn_number} — ${discord_display_name}${showEdited ? ' (edited)' : ''}`
      : null;

    if (storyThread.locked) await storyThread.setLocked(false);
    if (storyThread.archived) await storyThread.setArchived(false);
    log(`handleRepostEntry: posting entry to thread ${activeThreadId}, content length=${content.length}`, { show: true, guildName: interaction?.guild?.name });
    await postThreadEntry(storyThread, content, authorLine, scene_break_divider);

    const userId = interaction.user.id;
    const readSession = pendingReadData.get(userId);
    const successMsg = await getConfigValue(connection, 'txtRepostSuccess', interaction.guild.id);
    if (readSession?.pendingRepostEntryId === String(entryId)) {
      readSession.pendingRepostEntryId = null;
      readSession.btnRepostEntry = null;
      if (deferred) await interaction.editReply(buildReadEmbed(readSession, readSession.currentPage));
      await interaction.followUp({ content: successMsg, flags: MessageFlags.Ephemeral });
    } else {
      if (deferred) {
        await interaction.editReply({ content: successMsg, components: [] });
      } else {
        await interaction.followUp({ content: successMsg, flags: MessageFlags.Ephemeral });
      }
    }

  } catch (error) {
    log(`Error in handleRepostEntry: ${error}`, { show: true, guildName: interaction?.guild?.name });
    const errMsg = await getConfigValue(connection, 'errProcessingRequest', interaction.guild.id);
    if (deferred) {
      await interaction.editReply({ content: errMsg, components: [] }).catch(() => {});
    } else {
      await interaction.followUp({ content: errMsg, flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  }
}

export {
  handleEdit,
  openEditSession,
  buildEditMessage,
  handleEditButton,
  handleEditModalSubmit,
  handleRepostEntry,
};
