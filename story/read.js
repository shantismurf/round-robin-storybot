import { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, MessageFlags } from 'discord.js';
import { getConfigValue, log, resolveStoryId, chunkEntryContent, checkIsAdmin, checkIsCreator, discordTimestamp, replaceTemplateVariables } from '../utilities.js';
import { generateStoryExport } from './export.js';
import { isRestricted, ratingBadgeKey } from './_metadata.js';
import { pendingReadData, lastReadPage, pendingEditData } from './_state.js';
import { buildEditMessage, buildEntryModal, EDIT_PANEL_CONFIG_KEYS } from './edit.js';
import { handleEntriesTextExportButton } from './_exportText.js';
import { buildEntryEmbed, buildEntryPages, stepImagePage } from './_entryRenderer.js';
import { withFreshAttachmentUrls } from './_exportImages.js';
import { WRITER_STATUS, ENTRY_STATUS } from '../constants.js';
import { turnNumberSubquery, entryOrderSort } from './_entryOrder.js';

export { pendingReadData, lastReadPage };

// Build the pages array for a read session from raw story entries.
// editInfoMap: Map<story_entry_id, { editedByName, editedAt }> — populated by handleRead for footnotes
// hasAnyEditSet: Set<story_entry_id> — entries with any edit history (before grace-period filter)
export function buildPages(entries, showAuthors, editInfoMap = new Map(), hasAnyEditSet = new Set(), sceneBreakDivider = null) {
  const pages = [];
  const turnMap = new Map();
  for (const row of entries) {
    if (!turnMap.has(row.turn_number)) {
      turnMap.set(row.turn_number, {
        turnNumber: row.turn_number,
        writerName: row.discord_display_name,
        parts: [],
        storyEntryId: row.story_entry_id,
        originalAuthorId: String(row.original_author_id),
        createdAt: row.created_at
      });
    }
    turnMap.get(row.turn_number).parts.push(row.content.trim());
  }
  for (const turn of turnMap.values()) {
    const fullContent = turn.parts.join('\n\n');
    const entryPages = buildEntryPages(fullContent, {
      turnNumber: turn.turnNumber,
      writerName: turn.writerName,
      showAuthors,
      storyEntryId: turn.storyEntryId,
      editInfo: editInfoMap.get(turn.storyEntryId) ?? null,
      sceneBreakDivider,
    });
    for (const p of entryPages) {
      pages.push({
        ...p,
        originalAuthorId: turn.originalAuthorId,
        createdAt: turn.createdAt,
        hasHistory: hasAnyEditSet.has(turn.storyEntryId),
      });
    }
  }
  return pages;
}

// Build the embed + nav buttons for a given page in a read session.
// Delegates layout to entryRenderer; adds read-specific extras (Jump menu, Edit, Export).
export function buildReadEmbed(session, pageIndex) {
  const page = session.pages[pageIndex];
  const totalPages = session.pages.length;

  const canEdit = page.isFirstChunk && (
    session.isAdmin || page.originalAuthorId === session.userId
  );

  // Extra rows injected after the standard nav row
  const extraButtons = [];

  // Jump-to-page select menu
  if (totalPages > 1) {
    const maxOptions = 25;
    let rangeStart = Math.max(0, pageIndex - Math.floor(maxOptions / 2));
    const rangeEnd = Math.min(totalPages, rangeStart + maxOptions);
    rangeStart = Math.max(0, rangeEnd - maxOptions);
    const optionTemplate = session.lblPageJumpOptionTurn;
    const placeholderTemplate = session.lblPageJumpPlaceholder;
    const options = [];
    for (let i = rangeStart; i < rangeEnd; i++) {
      const p = session.pages[i];
      const tokens = { page: String(i + 1), turn: String(p.turnNumber) };
      if (p.writerName) tokens.writer = p.writerName;
      const label = replaceTemplateVariables(optionTemplate, tokens).slice(0, 100);
      options.push({ label, value: String(i), default: i === pageIndex });
    }
    const placeholder = replaceTemplateVariables(placeholderTemplate, { page: String(pageIndex + 1), total: String(totalPages) });
    extraButtons.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('story_read_jump')
          .setPlaceholder(placeholder)
          .addOptions(options)
      )
    );
  }

  // Utility row: Edit (contextual) + Export + optional Repost
  const utilityButtons = [];
  if (canEdit) {
    utilityButtons.push(
      new ButtonBuilder()
        .setCustomId(`story_read_edit_${page.storyEntryId}`)
        .setLabel(session.btnEditOpen)
        .setStyle(ButtonStyle.Secondary)
    );
  }
  // Two HTML exports (for posting) plus the plain-text one (for editing). With Edit and Repost
  // both contextual, this row reaches exactly Discord's 5-component maximum — a sixth button
  // here has to go in a row of its own.
  utilityButtons.push(
    new ButtonBuilder()
      .setCustomId('story_read_download_noturns')
      .setLabel(session.btnExportNoBreaks)
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('story_read_download_withturns')
      .setLabel(session.btnExportWithBreaks)
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('story_read_download_entries')
      .setLabel(session.btnExportForEditing)
      .setStyle(ButtonStyle.Secondary)
  );
  if (session.pendingRepostEntryId && session.pendingRepostEntryId === page.storyEntryId && page.isFirstChunk) {
    utilityButtons.push(
      new ButtonBuilder()
        .setCustomId(`story_repost_entry_${session.pendingRepostEntryId}`)
        .setLabel(session.btnRepostEntry)
        .setStyle(ButtonStyle.Secondary)
    );
  }
  extraButtons.push(new ActionRowBuilder().addComponents(...utilityButtons));

  // Tag row: Submit Tag for active writers; View Proposed Tags for all; Manage Tags for creator/admin
  const tagButtons = [];
  if (session.isActiveWriter) {
    tagButtons.push(
      new ButtonBuilder()
        .setCustomId(`story_submit_tag_${session.storyId}`)
        .setLabel(session.btnSubmitTagRead)
        .setStyle(ButtonStyle.Secondary)
    );
  }
  tagButtons.push(
    new ButtonBuilder()
      .setCustomId(`story_tag_view_proposed_${session.storyId}`)
      .setLabel(session.btnViewProposedTags)
      .setStyle(ButtonStyle.Secondary)
  );
  if (session.isAdminOrCreator) {
    tagButtons.push(
      new ButtonBuilder()
        .setCustomId(`story_manage_review_tags_read_${session.storyId}`)
        .setLabel(session.btnManageTags)
        .setStyle(ButtonStyle.Secondary)
    );
  }
  extraButtons.push(new ActionRowBuilder().addComponents(...tagButtons));

  const result = buildEntryEmbed(page, {
    title: `📖 ${session.title}`,
    pageIndex,
    totalPages,
    context: 'read',
    extraButtons,
    storyThreadId: session.storyThreadId,
    guildId: session.guildId,
    imagePageIndex: session.imagePageIndex ?? 0,
    footerTemplate: session.lblEntryFooter,
    storyWordCount: session.wordCount,
  });

  return result;
}

export async function handleRead(connection, interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const guildId = interaction.guild.id;
  const storyId = await resolveStoryId(connection, guildId, interaction.options.getString('story_id'));
  if (storyId === null) {
    return await interaction.editReply({ content: await getConfigValue(connection, 'txtStoryNotFound', guildId) });
  }

  try {
    const [storyRows] = await connection.execute(
      `SELECT title, show_authors, guild_story_id, story_thread_id, rating, scene_break_divider FROM story WHERE story_id = ? AND guild_id = ?`,
      [storyId, guildId]
    );
    if (storyRows.length === 0) {
      return await interaction.editReply({ content: await getConfigValue(connection, 'txtStoryNotFound', guildId) });
    }
    const story = storyRows[0];

    // Restricted story check — M/E rated stories can only be read in channels that are age-restricted, if the restricted feed if has been configured for this guild

    if (isRestricted(story.rating)) {
      log(`handleRead: story isRestricted, Rating: ${story.rating}`, { show: false, guildName: interaction?.guild?.name });
      const restrictedChannelId = await getConfigValue(connection, 'cfgRestrictedFeedChannelId', guildId);
      log(`handleRead: restrictedChannelId: ${restrictedChannelId}`, { show: false, guildName: interaction?.guild?.name });
      const isConfigured = restrictedChannelId && restrictedChannelId !== 'cfgRestrictedFeedChannelId' && restrictedChannelId !== '';

if (isConfigured) {
    // 1. Fetch the channel
    const fullChannel = await interaction.client.channels.fetch(interaction.channelId);

    // 2. Logic: If it's a thread, look at the parent's NSFW status.
    // If it's a regular channel, look at its own NSFW status.
    const isNsfw = fullChannel.nsfw || (fullChannel.parent && fullChannel.parent.nsfw);

    log(`handleRead: Configured: ${isConfigured}, Channel: ${fullChannel.name}, NSFW: ${isNsfw}`, { show: false, guildName: interaction?.guild?.name });

    // 3. Perform the check against the resolved status
    if (!isNsfw) {
        const txtValue = await getConfigValue(connection, 'txtRestrictedStoryNotHere', guildId);
        const txt = txtValue.replace('[rating]', story.rating ?? 'M');
        return await interaction.editReply({ content: txt });
    }
}
}


    const [entries] = await connection.execute(
      `SELECT se.content, se.story_entry_id, se.created_at, sw.discord_user_id AS original_author_id,
              ${turnNumberSubquery()} AS turn_number,
              sw.discord_display_name
       FROM story_entry se
       JOIN turn t ON se.turn_id = t.turn_id
       JOIN story_writer sw ON t.story_writer_id = sw.story_writer_id
       WHERE sw.story_id = ? AND se.entry_status = ?
       ORDER BY ${entryOrderSort()}`,
      [ENTRY_STATUS.CONFIRMED, storyId, ENTRY_STATUS.CONFIRMED]
    );

    if (entries.length === 0) {
      return await interaction.editReply({ content: await getConfigValue(connection, 'txtNoConfirmedEntries', guildId) });
    }

    // Batched query for edit footnotes — one query for all entries, avoids per-entry lookups
    const editInfoMap = new Map();
    let hasAnyEditSet = new Set();
    const entryIds = entries.map(e => e.story_entry_id);
    if (entryIds.length > 0) {
      const placeholders = entryIds.map(() => '?').join(',');
      const [editRows] = await connection.execute(
        `SELECT see.entry_id, see.edited_by, see.edited_by_name, see.edited_at
         FROM story_entry_edit see
         INNER JOIN (
           SELECT entry_id, MAX(edited_at) AS max_edited_at
           FROM story_entry_edit
           WHERE entry_id IN (${placeholders})
           GROUP BY entry_id
         ) latest ON see.entry_id = latest.entry_id AND see.edited_at = latest.max_edited_at`,
        entryIds
      );
      // Build hasAnyEditSet from raw rows before grace-period filter so History button is accurate
      hasAnyEditSet = new Set(editRows.map(r => r.entry_id));
      for (const row of editRows) {
        hasAnyEditSet.add(row.entry_id); // track before grace-period filter
        const entry = entries.find(e => e.story_entry_id === row.entry_id);
        if (!entry) continue;
        const createdMs = new Date(entry.created_at).getTime();
        const editedMs  = new Date(row.edited_at).getTime();
        const isGrace = String(row.edited_by) === String(entry.original_author_id) &&
                        (editedMs - createdMs) <= 60 * 60 * 1000;
        const dsEditedAt = discordTimestamp(editedMs,'F');
        if (!isGrace) {
          editInfoMap.set(row.entry_id, { editedByName: row.edited_by_name, editedAt: dsEditedAt });
        }
      }
    }

    // Build content map for read-path edit session (entryId → full content string)
    const contentMap = new Map();
    for (const entry of entries) {
      contentMap.set(entry.story_entry_id, entry.content);
    }

    // Check admin/creator status and active writer for tag buttons
    const [isAdmin, isCreator] = await Promise.all([
      checkIsAdmin(connection, interaction, guildId),
      checkIsCreator(connection, storyId, interaction.user.id)
    ]);
    const [writerRows] = await connection.execute(
      `SELECT story_writer_id FROM story_writer WHERE story_id = ? AND discord_user_id = ? AND sw_status = ?`,
      [storyId, interaction.user.id, WRITER_STATUS.ACTIVE]
    );
    const isActiveWriter = writerRows.length > 0;

    const [[{ pendingTagCount }]] = await connection.execute(
      `SELECT COUNT(*) AS pendingTagCount FROM story_tag_submission WHERE story_id = ? AND submission_status = 'pending'`,
      [storyId]
    );

    const [btnSubmitTagRead, btnViewProposedTags, btnManageTags, ratingBadgeDisplay, btnExportNoBreaks, btnExportWithBreaks, btnExportForEditing, btnEditOpen, lblPageJumpPlaceholder, lblPageJumpOptionTurn, lblEntryFooter] = await Promise.all([
      getConfigValue(connection, 'btnSubmitTagRead', guildId),
      getConfigValue(connection, 'btnViewProposedTags', guildId),
      getConfigValue(connection, 'btnManageTags', guildId),
      getConfigValue(connection, ratingBadgeKey(story.rating ?? 'NR'), guildId),
      getConfigValue(connection, 'btnExportNoBreaks', guildId),
      getConfigValue(connection, 'btnExportWithBreaks', guildId),
      getConfigValue(connection, 'btnExportForEditing', guildId),
      getConfigValue(connection, 'btnEditOpen', guildId),
      getConfigValue(connection, 'lblPageJumpPlaceholder', guildId),
      getConfigValue(connection, 'lblPageJumpOptionTurn', guildId),
      getConfigValue(connection, 'lblEntryFooter', guildId),
    ]);

    const wordCount = entries.reduce((total, e) => total + e.content.trim().split(/\s+/).length, 0);
    // Stored image links are signed and expire ~24h after issue — show fresh ones. Display copy
    // only: contentMap above keeps the stored content for the edit session.
    const freshContent = await withFreshAttachmentUrls(interaction.client?.rest, entries.map(e => e.content), { guildName: interaction.guild?.name });
    const displayEntries = entries.map((e, i) => ({ ...e, content: freshContent[i] }));
    const pages = buildPages(displayEntries, story.show_authors, editInfoMap, hasAnyEditSet, story.scene_break_divider);

    const savedPage = lastReadPage.get(`${interaction.user.id}_${storyId}`) ?? 0;
    const startPage = Math.min(savedPage, pages.length - 1);

    const titleWithRating = `${story.title} ${ratingBadgeDisplay}`;
    const session = {
      pages, contentMap, currentPage: startPage, storyId, guildStoryId: story.guild_story_id,
      title: titleWithRating, wordCount, guildId, userId: interaction.user.id,
      isAdmin, isAdminOrCreator: isAdmin || isCreator, isActiveWriter,
      pendingTagCount: Number(pendingTagCount),
      btnSubmitTagRead, btnViewProposedTags, btnManageTags,
      btnExportNoBreaks, btnExportWithBreaks, btnExportForEditing, btnEditOpen,
      lblPageJumpPlaceholder, lblPageJumpOptionTurn, lblEntryFooter,
      storyThreadId: story.story_thread_id, imagePageIndex: 0
    };
    pendingReadData.set(interaction.user.id, session);

    await interaction.editReply(buildReadEmbed(session, startPage));
  } catch (error) {
    log(`Error in handleRead: ${error}`, { show: true, guildName: interaction?.guild?.name });
    await interaction.editReply({ content: await getConfigValue(connection, 'errProcessingRequest', guildId) });
  }
}

export async function handleReadEditButton(connection, interaction, session, entryId) {
  // Load state entirely from the read session — no DB query needed, so showModal can be
  // the first (and only) response to this interaction within the 3-second window.
  const page = session.pages.find(p => p.storyEntryId === entryId && p.isFirstChunk);
  const fullContent = session.contentMap?.get(entryId) ?? null;
  log(`handleReadEditButton: entryId=${entryId} hasPage=${!!page} hasContent=${fullContent !== null}`, { show: false, guildName: interaction?.guild?.name });

  if (!page || fullContent === null) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await interaction.editReply({ content: await getConfigValue(connection, 'txtReadEntryNotFound', session?.guildId ?? interaction.guild.id) });
    return;
  }

  const chunks = chunkEntryContent(fullContent);
  const storyTitle = session.title.length > 50 ? session.title.slice(0, 50) + '…' : session.title;

  const isMultiChunk = chunks.length > 1;

  pendingEditData.set(interaction.user.id, {
    entryId,
    entryStatus: 'confirmed',
    storyId: session.storyId,
    guildId: session.guildId,
    originalAuthorId: page.originalAuthorId,
    createdAt: null,
    currentContent: fullContent,
    chunks,
    chunkPage: 0,
    hasHistory: page.hasHistory,
    historyPage: 0,
    turnNumber: page.turnNumber,
    storyTitle,
    guildStoryId: session.guildStoryId,
    originalInteraction: interaction,
    fromReadPath: !isMultiChunk,
  });

  // Both branches render edit.js's own panel/modal, so they read the same key set it does —
  // EDIT_PANEL_CONFIG_KEYS rather than a copy of the list that goes stale when a key is added there.
  const editCfg = await getConfigValue(connection, EDIT_PANEL_CONFIG_KEYS, session.guildId);
  const editState = pendingEditData.get(interaction.user.id);
  if (editState) editState.editCfg = editCfg;

  if (isMultiChunk) {
    // Multi-chunk: show the paginated edit embed so all pages are reachable
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await interaction.editReply(
      buildEditMessage(chunks, 0, page.hasHistory, page.turnNumber, storyTitle, session.guildStoryId, editCfg)
    );
  } else {
    // Single chunk: open modal directly — no embed needed.
    // No defer — showModal must be the first response.
    // Shares edit.js's buildEntryModal rather than assembling a second copy here: this one had
    // its own hard-coded title, label and hint, and its hint described the save-and-reopen
    // workaround that Add Page replaces.
    if (!editState) {
      return await interaction.reply({
        content: await getConfigValue(connection, 'txtEditSessionExpired', session.guildId),
        flags: MessageFlags.Ephemeral
      });
    }
    await interaction.showModal(buildEntryModal(editState));
  }
}

export async function handleReadNav(connection, interaction) {
  const userId = interaction.user.id;
  const session = pendingReadData.get(userId);

  if (!session) {
    await interaction.deferUpdate();
    await interaction.editReply({ content: await getConfigValue(connection, 'txtReadSessionExpired', interaction.guild.id), embeds: [], components: [] });
    return;
  }

  // story_read_edit_<entryId> — opens edit session; full handler wired in Step 4
  if (interaction.customId.startsWith('story_read_edit_')) {
    const entryId = interaction.customId.split('_').at(-1); // keep as string — DB returns BIGINT as string (bigNumberStrings: true)
    await handleReadEditButton(connection, interaction, session, entryId);
    return;
  }

  // The plain-text editing export — unrendered entry content, handled separately from the two
  // HTML exports below because it carries no AO3 instructions and offers no public post.
  if (interaction.customId === 'story_read_download_entries') {
    await interaction.deferUpdate();
    await handleEntriesTextExportButton(connection, interaction, session.storyId, session.guildId);
    return;
  }

  if (interaction.customId === 'story_read_download_noturns' || interaction.customId === 'story_read_download_withturns') {
    await interaction.deferUpdate();
    const suppressBreaks = interaction.customId === 'story_read_download_noturns';
    try {
      const result = await generateStoryExport(connection, session.storyId, session.guildId, interaction.guild, { suppressBreaks });
      if (result?.hasEntries) {
        const [ao3Instructions, btnPostLabel] = await Promise.all([
          getConfigValue(connection, 'txtExportAO3Instructions', session.guildId),
          getConfigValue(connection, 'btnExportPostPublicly', session.guildId),
        ]);
        const flagSegment = suppressBreaks ? 'noturns' : 'withturns';
        const postBtn = new ButtonBuilder()
          .setCustomId(`story_read_post_public_${flagSegment}_${session.storyId}`)
          .setLabel(btnPostLabel)
          .setStyle(ButtonStyle.Secondary);
        const btnRow = new ActionRowBuilder().addComponents(postBtn);
        await interaction.followUp({
          content: ao3Instructions,
          files: [{ attachment: result.buffer, name: result.filename }],
          components: [btnRow],
          flags: MessageFlags.Ephemeral,
        });
      }
    } catch (err) {
      log(`Error generating HTML export from read session: ${err}`, { show: true, guildName: interaction?.guild?.name });
    }
    return;
  }

  if (interaction.customId === 'story_read_img_prev' || interaction.customId === 'story_read_img_next') {
    const direction = interaction.customId === 'story_read_img_next' ? 1 : -1;
    session.imagePageIndex = stepImagePage(session.imagePageIndex, session.pages[session.currentPage].imageUrls, direction);
  } else {
    // Story page navigation — reset image page to 0 whenever the turn changes
    if (interaction.customId === 'story_read_prev') {
      session.currentPage = Math.max(0, session.currentPage - 1);
    } else if (interaction.customId === 'story_read_next') {
      session.currentPage = Math.min(session.pages.length - 1, session.currentPage + 1);
    } else if (interaction.customId === 'story_read_back10') {
      session.currentPage = Math.max(0, session.currentPage - 10);
    } else if (interaction.customId === 'story_read_fwd10') {
      session.currentPage = Math.min(session.pages.length - 1, session.currentPage + 10);
    } else if (interaction.customId === 'story_read_jump') {
      const selected = parseInt(interaction.values[0]);
      if (!isNaN(selected)) session.currentPage = Math.min(session.pages.length - 1, Math.max(0, selected));
    }
    session.imagePageIndex = 0;
  }

  lastReadPage.set(`${userId}_${session.storyId}`, session.currentPage);
  await interaction.update(buildReadEmbed(session, session.currentPage));
}
