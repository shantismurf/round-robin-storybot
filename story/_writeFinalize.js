import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { getConfigValue, log, replaceTemplateVariables, checkIsAdmin, logGuildEvent } from '../utilities.js';
import { PickNextWriter, NextTurn, deleteThreadAndAnnouncement, endTurnGuarded } from './_turn.js';
import { getActiveThreadId } from '../storybot.js';
import { buildEntryPages, buildEntryEmbed, postThreadEntry, stepImagePage } from './_entryRenderer.js';
import { resolveMentionsToPlainText } from './_entryMarkup.js';
import { pendingPreviewData } from './_state.js';
import { TURN_STATUS, ENTRY_STATUS } from '../constants.js';

// Build entry content from the writer's turn-thread posts, in posting order. Shared by the
// finalize preview and the confirm write so the preview always shows what will be saved.
// What legitimately differs between the two is passed in:
//   textFor(msg)    -> the post's mention-resolved text, or null
//   linkImage(att)  -> the URL to link an image to, or null to leave that image out
// The preview links the writer's own upload (still freshly signed); confirm forwards each image
// to the media channel and links that copy, so forwarding still happens exactly once.
export async function assembleEntryContent(userMessages, textFor, linkImage) {
  const parts = [];
  let imageCount = 0;
  for (const msg of userMessages.values()) {
    const msgText = await textFor(msg);
    const imageAtts = [...msg.attachments.values()].filter(a => a.contentType?.startsWith('image/'));
    if (imageAtts.length === 0) {
      if (msgText) parts.push(msgText);
      continue;
    }
    const links = [];
    for (const att of imageAtts) {
      const url = await linkImage(att);
      if (url) {
        links.push(`[${msgText || att.name}](${url})`);
        imageCount++;
      }
    }
    if (links.length > 0) parts.push(links.join('\n'));
  }
  return { content: parts.join('\n\n'), imageCount };
}

// The guild's configured media channel, or null when none is set or it can't be fetched.
// Images are only kept in an entry when there is a media channel to forward them to.
async function getMediaChannel(connection, guild) {
  const mediaChannelId = await getConfigValue(connection, 'cfgMediaChannelId', guild.id);
  return (mediaChannelId && mediaChannelId !== 'cfgMediaChannelId')
    ? await guild.channels.fetch(mediaChannelId).catch(() => null)
    : null;
}

export function buildPreviewEmbed(userId, pageIndex, confirmRow) {
  const session = pendingPreviewData.get(userId);
  if (!session) return { content: 'Preview session expired.', embeds: [], components: [] };
  const page = session.pages[pageIndex];
  return buildEntryEmbed(page, {
    title: session.title,
    pageIndex,
    totalPages: session.pages.length,
    context: 'preview',
    extraButtons: [confirmRow],
    guildId: session.guildId,
    imagePageIndex: session.imagePageIndex ?? 0,
    footerTemplate: session.lblEntryFooter,
  });
}

export async function handleFinalizeEntry(connection, interaction) {
  const storyId = interaction.customId.split('_')[2];
  const guildId = interaction.guild.id;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const isAdmin = await checkIsAdmin(connection, interaction, guildId);
  log(`handleFinalizeEntry entry user=${interaction.user.username} story=${storyId}${isAdmin ? ' (admin)' : ''}`, { show: false, guildName: interaction?.guild?.name });

  try {
    let turnInfo, writerId;
    if (isAdmin) {
      const [rows] = await connection.execute(
        `SELECT t.turn_id, t.thread_id, sw.discord_user_id, s.scene_break_divider
         FROM turn t
         JOIN story_writer sw ON t.story_writer_id = sw.story_writer_id
         JOIN story s ON sw.story_id = s.story_id
         WHERE sw.story_id = ? AND t.turn_status = ? AND t.thread_id = ?`,
        [storyId, TURN_STATUS.ACTIVE, interaction.channel.id]
      );
      turnInfo = rows;
      writerId = rows[0]?.discord_user_id;
    } else {
      const [rows] = await connection.execute(
        `SELECT t.turn_id, t.thread_id, sw.discord_user_id, s.scene_break_divider
         FROM turn t
         JOIN story_writer sw ON t.story_writer_id = sw.story_writer_id
         JOIN story s ON sw.story_id = s.story_id
         WHERE sw.story_id = ? AND t.turn_status = ? AND sw.discord_user_id = ?`,
        [storyId, TURN_STATUS.ACTIVE, interaction.user.id]
      );
      turnInfo = rows;
      writerId = interaction.user.id;
    }

    if (turnInfo.length === 0) {
      log(`handleFinalizeEntry: no active turn — story ${storyId} channel ${interaction.channel.id} user ${interaction.user.username}`, { show: false, guildName: interaction?.guild?.name });
      await interaction.editReply({ content: await getConfigValue(connection, 'txtNoActiveTurn', guildId) });
      return;
    }
    log(`handleFinalizeEntry: found turn ${turnInfo[0].turn_id} for writer ${writerId}`, { show: false, guildName: interaction?.guild?.name });

    const thread = await interaction.guild.channels.fetch(turnInfo[0].thread_id);
    const messages = await thread.messages.fetch({ limit: 100 });
    const userMessages = messages
      .filter(msg => msg.author.id === String(writerId))
      .sort((a, b) => a.createdTimestamp - b.createdTimestamp);
    log(`handleFinalizeEntry: fetched ${userMessages.size} messages from writer ${writerId} in thread ${turnInfo[0].thread_id}`, { show: false, guildName: interaction?.guild?.name });

    if (userMessages.size === 0) {
      log(`handleFinalizeEntry: no messages found, rejecting`, { show: false, guildName: interaction?.guild?.name });
      await interaction.editReply({ content: await getConfigValue(connection, 'txtEmptyEntry', guildId) });
      return;
    }

    // Resolve mentions to plain display text once, here — see
    // docs/plans/PLAN-mention-display-text.md. Stored per-message-id on the preview session
    // below and reused as-is by doFinalizeEntry, rather than re-resolved against a second,
    // independent read of these same raw thread messages: the writer approves exactly the text
    // that gets saved, with no risk of the two builds resolving a mention differently (e.g. a
    // member leaving the server in the gap between opening the preview and clicking Confirm).
    const placeholderCfg = await getConfigValue(connection, [
      'txtExportPlaceholderUser', 'txtExportPlaceholderChannel', 'txtExportPlaceholderRole'
    ], guildId);
    const resolvedMessages = new Map();
    for (const msg of userMessages.values()) {
      if (msg.content?.trim()) {
        resolvedMessages.set(msg.id, await resolveMentionsToPlainText(msg.content.trim(), interaction.guild, placeholderCfg));
      }
    }

    // Same assembly as confirm, linking each image to the writer's own upload so the preview
    // shows real pictures without forwarding anything yet. Images are left out when there is no
    // media channel, matching what confirm will save.
    const previewMediaChannel = await getMediaChannel(connection, interaction.guild);
    const { content: assembled, imageCount: previewImageCount } = await assembleEntryContent(
      userMessages,
      msg => resolvedMessages.get(msg.id) ?? null,
      att => previewMediaChannel ? att.url : null,
    );
    log(`handleFinalizeEntry: preview built — ${assembled.length} chars, ${previewImageCount} image(s)`, { show: false, guildName: interaction?.guild?.name });
    // Preview-only display tweak: the stored entry keeps the writer's markdown as written.
    const previewContent = assembled
      .replace(/^#{1,3} (.+)$/gm, '**$1**')
      .replace(/^-# (.+)$/gm, '*$1*');

    const [txtFinalizeConfirm, btnFinalizeConfirm, btnCancel, lblEntryFooter] = await Promise.all([
      getConfigValue(connection, 'txtFinalizeConfirm', guildId),
      getConfigValue(connection, 'btnFinalizeConfirm', guildId),
      getConfigValue(connection, 'btnCancel', guildId),
      getConfigValue(connection, 'lblEntryFooter', guildId),
    ]);

    const pages = buildEntryPages(previewContent, { turnNumber: '—', writerName: null, showAuthors: false, storyEntryId: null, sceneBreakDivider: turnInfo[0].scene_break_divider });
    const confirmRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`story_finalize_confirm_${storyId}`)
        .setLabel(btnFinalizeConfirm)
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`story_finalize_cancel_${storyId}`)
        .setLabel(btnCancel)
        .setStyle(ButtonStyle.Secondary)
    );

    pendingPreviewData.set(interaction.user.id, {
      pages,
      currentPage: 0,
      imagePageIndex: 0,
      storyId,
      guildId,
      writerId: String(writerId),
      title: txtFinalizeConfirm,
      lblEntryFooter,
      // message id -> resolved text, consumed by doFinalizeEntry instead of re-resolving.
      resolvedMessages,
    });

    log(`handleFinalizeEntry: showing preview page 1/${pages.length} to user ${interaction.user.username} for writer ${writerId}`, { show: true, guildName: interaction?.guild?.name });
    await interaction.editReply(buildPreviewEmbed(interaction.user.id, 0, confirmRow));

  } catch (error) {
    log(`handleFinalizeEntry failed: ${error}`, { show: true, guildName: interaction?.guild?.name });
    await interaction.editReply({ content: await getConfigValue(connection, 'txtFailedtoFinalize', guildId) });
  }
}

export async function handlePreviewNav(connection, interaction) {
  await interaction.deferUpdate();
  const session = pendingPreviewData.get(interaction.user.id);
  if (!session) {
    await interaction.editReply({ content: await getConfigValue(connection, 'txtFailedtoFinalize', interaction.guild.id), components: [] });
    return;
  }

  const id = interaction.customId;
  if (id === 'story_preview_img_prev' || id === 'story_preview_img_next') {
    const direction = id === 'story_preview_img_next' ? 1 : -1;
    session.imagePageIndex = stepImagePage(session.imagePageIndex, session.pages[session.currentPage].imageUrls, direction);
  } else {
    // Text page navigation — the new page has its own images, so start its gallery at the first
    if (id === 'story_preview_prev') {
      session.currentPage = Math.max(0, session.currentPage - 1);
    } else if (id === 'story_preview_next') {
      session.currentPage = Math.min(session.pages.length - 1, session.currentPage + 1);
    } else if (id === 'story_preview_back10') {
      session.currentPage = Math.max(0, session.currentPage - 10);
    } else if (id === 'story_preview_fwd10') {
      session.currentPage = Math.min(session.pages.length - 1, session.currentPage + 10);
    }
    session.imagePageIndex = 0;
  }

  const [btnFinalizeConfirm, btnCancel] = await Promise.all([
    getConfigValue(connection, 'btnFinalizeConfirm', session.guildId),
    getConfigValue(connection, 'btnCancel', session.guildId),
  ]);
  const confirmRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`story_finalize_confirm_${session.storyId}`)
      .setLabel(btnFinalizeConfirm)
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`story_finalize_cancel_${session.storyId}`)
      .setLabel(btnCancel)
      .setStyle(ButtonStyle.Secondary)
  );

  await interaction.editReply(buildPreviewEmbed(interaction.user.id, session.currentPage, confirmRow));
}

export async function doFinalizeEntry(connection, interaction, storyId, writerId) {
  log(`doFinalizeEntry: start — story ${storyId}, writer ${writerId}, triggered by ${interaction.user.username}`, { show: true, guildName: interaction?.guild?.name });
  try {
    const [turnInfo] = await connection.execute(
      `SELECT t.turn_id, t.thread_id, sw.discord_user_id, sw.story_id, s.guild_story_id,
              (SELECT COUNT(DISTINCT t2.turn_id)
               FROM turn t2
               JOIN story_writer sw2 ON t2.story_writer_id = sw2.story_writer_id
               JOIN story_entry se2 ON se2.turn_id = t2.turn_id AND se2.entry_status = ?
               WHERE sw2.story_id = sw.story_id AND t2.started_at < t.started_at) + 1 AS turn_number
       FROM turn t
       JOIN story_writer sw ON t.story_writer_id = sw.story_writer_id
       JOIN story s ON sw.story_id = s.story_id
       WHERE sw.story_id = ? AND t.turn_status = ? AND sw.discord_user_id = ?`,
      [ENTRY_STATUS.CONFIRMED, storyId, TURN_STATUS.ACTIVE, writerId]
    );
    if (turnInfo.length === 0) {
      log(`doFinalizeEntry: no active turn for writer ${writerId} story ${storyId}`, { show: true, guildName: interaction?.guild?.name });
      await interaction.editReply({ content: await getConfigValue(connection, 'txtNoActiveTurn', interaction.guild.id), components: [] });
      return;
    }
    const turn = turnInfo[0];
    log(`doFinalizeEntry: turn ${turn.turn_id} (story #${turn.guild_story_id}, turn #${turn.turn_number}), thread ${turn.thread_id}`, { show: false, guildName: interaction?.guild?.name });

    const thread = await interaction.guild.channels.fetch(turn.thread_id);
    const messages = await thread.messages.fetch({ limit: 100 });
    const userMessages = messages
      .filter(msg => msg.author.id === String(writerId))
      .sort((a, b) => a.createdTimestamp - b.createdTimestamp);
    log(`doFinalizeEntry: ${userMessages.size} messages from writer ${writerId} fetched`, { show: false, guildName: interaction?.guild?.name });

    if (userMessages.size === 0) {
      log(`doFinalizeEntry: no messages found, aborting`, { show: true, guildName: interaction?.guild?.name });
      await interaction.editReply({ content: await getConfigValue(connection, 'txtEmptyEntry', interaction.guild.id), components: [] });
      return;
    }

    const txtProcessing = await getConfigValue(connection, 'txtEntrySubmittedProcessing', interaction.guild.id).catch(() => null);
    if (txtProcessing) await thread.send(txtProcessing).catch(() => {});

    const [mediaChannel, mediaPostLabelTemplate] = await Promise.all([
      getMediaChannel(connection, interaction.guild),
      getConfigValue(connection, 'txtMediaPostLabel', interaction.guild.id),
    ]);
    log(`doFinalizeEntry: media channel ${mediaChannel ? mediaChannel.id : 'not configured'}`, { show: false, guildName: interaction?.guild?.name });

    // This function re-fetches the raw thread messages rather than reusing the preview's, but
    // builds the entry with the same assembleEntryContent the preview uses. The two calls differ
    // only where they must: (1) the preview strips markdown (# headers -> bold, -# subtext ->
    // italic) for its own display, after assembly, which the stored entry must NOT have; (2) this
    // call forwards each image to the media channel and links that copy, where the preview links
    // the writer's own upload — image forwarding has to happen exactly once, on confirm, not
    // during preview paging. Mention resolution has neither reason to be redone, so it's resolved
    // once in the preview and reused here — see docs/plans/PLAN-mention-display-text.md. Falls
    // back to resolving fresh only if the preview session is somehow gone by the time Confirm is
    // clicked (shouldn't happen on any real path: both callers of doFinalizeEntry fetch this same
    // session first), so a missing session never blocks the write, just loses the "resolve once"
    // guarantee for that one entry.
    const session = pendingPreviewData.get(interaction.user.id);
    const placeholderCfg = session
      ? null
      : await getConfigValue(connection, [
          'txtExportPlaceholderUser', 'txtExportPlaceholderChannel', 'txtExportPlaceholderRole'
        ], interaction.guild.id);
    if (!session) {
      log(`doFinalizeEntry: no preview session found for user ${interaction.user.id} — resolving mentions fresh instead of reusing the preview's resolution`, { show: true, guildName: interaction?.guild?.name });
    }

    const { content: entryContent, imageCount: imagesForwarded } = await assembleEntryContent(
      userMessages,
      async msg => session
        ? session.resolvedMessages.get(msg.id) ?? null
        : (msg.content?.trim() ? await resolveMentionsToPlainText(msg.content.trim(), interaction.guild, placeholderCfg) : null),
      async att => {
        if (!mediaChannel) return null;
        log(`doFinalizeEntry: forwarding image "${att.name}" to media channel`, { show: true, guildName: interaction?.guild?.name });
        try {
          const forwarded = await mediaChannel.send({
            content: replaceTemplateVariables(mediaPostLabelTemplate, { story_id: turn.guild_story_id, turn_number: turn.turn_number }),
            files: [att.url]
          });
          log(`doFinalizeEntry: image "${att.name}" forwarded successfully`, { show: false, guildName: interaction?.guild?.name });
          return forwarded.attachments.first().url;
        } catch (err) {
          log(`doFinalizeEntry: failed to forward image "${att.name}" to media channel: ${err}`, { show: true, guildName: interaction?.guild?.name });
          return null;
        }
      },
    );
    log(`doFinalizeEntry: entry built — ${entryContent.length} chars, ${imagesForwarded} image(s) forwarded`, { show: false, guildName: interaction?.guild?.name });

    const [storyInfo] = await connection.execute(
      `SELECT s.show_authors, s.story_thread_id, s.restricted_thread_id, s.rating, s.scene_break_divider, sw.discord_display_name
       FROM story s
       JOIN story_writer sw ON sw.story_id = s.story_id AND sw.discord_user_id = ?
       WHERE s.story_id = ?`,
      [writerId, storyId]
    );
    const activeThreadId = getActiveThreadId(storyInfo[0]);
    log(`doFinalizeEntry: story info fetched — show_authors=${storyInfo[0]?.show_authors}, active_thread=${activeThreadId}`, { show: false, guildName: interaction?.guild?.name });
    const { show_authors, scene_break_divider, discord_display_name } = storyInfo[0];

    log(`doFinalizeEntry: beginning DB transaction — turn ${turn.turn_id}`, { show: false, guildName: interaction?.guild?.name });
    const txn = await connection.getConnection();
    await txn.beginTransaction();
    let nextTurnResult = null;
    try {
      const ended = await endTurnGuarded(txn, turn.turn_id);
      if (!ended) {
        await txn.rollback();
        log(`doFinalizeEntry: turn ${turn.turn_id} already ended (race with timeout/other finalize) — aborting`, { show: true, guildName: interaction?.guild?.name });
        await interaction.editReply({ content: await getConfigValue(connection, 'txtWriteTurnEnded', interaction.guild.id), components: [] });
        return;
      }
      await txn.execute(
        `INSERT INTO story_entry (turn_id, content, entry_status, created_at) VALUES (?, ?, ?, NOW())`,
        [turn.turn_id, entryContent, ENTRY_STATUS.CONFIRMED]
      );
      const nextWriterId = await PickNextWriter(txn, storyId);
      nextTurnResult = nextWriterId
        ? await NextTurn(txn, interaction, nextWriterId, { deferAnnouncement: true })
        : { success: false, error: 'No eligible next writer' };
      await txn.commit();
      log(`doFinalizeEntry: DB transaction committed — entry inserted, turn ${turn.turn_id} ended, next writer ${nextWriterId}`, { show: true, guildName: interaction?.guild?.name });
    } catch (txnError) {
      await txn.rollback();
      log(`doFinalizeEntry: DB transaction rolled back — ${txnError}\n${txnError?.stack ?? ''}`, { show: true, guildName: interaction?.guild?.name });
      if (txnError.code === 'ER_DUP_ENTRY') {
        await interaction.editReply({ content: await getConfigValue(connection, 'txtWriteAlreadySubmitted', interaction.guild.id), components: [] });
        return;
      }
      throw txnError;
    } finally {
      txn.release();
    }

    await logGuildEvent(connection, interaction.guild.id, 'turn_finalized');

    if (!nextTurnResult?.success) {
      log(`doFinalizeEntry: NextTurn failed for story ${storyId} after turn ${turn.turn_id} was finalized — story has no active turn: ${nextTurnResult?.error}`, { show: true, guildName: interaction?.guild?.name, hub: true });
    }

    const [turnNumResult] = await connection.execute(
      `SELECT COUNT(DISTINCT t2.turn_id) AS turn_number
       FROM turn t2
       JOIN story_writer sw2 ON t2.story_writer_id = sw2.story_writer_id
       JOIN story_entry se2 ON se2.turn_id = t2.turn_id AND se2.entry_status = ?
       WHERE sw2.story_id = ? AND t2.started_at <= (SELECT started_at FROM turn WHERE turn_id = ?)`,
      [ENTRY_STATUS.CONFIRMED, storyId, turn.turn_id]
    );
    const turn_number = turnNumResult[0].turn_number;

    try {
      const storyThread = await interaction.guild.channels.fetch(activeThreadId);
      if (storyThread.locked) await storyThread.setLocked(false).catch(() => {});
      if (storyThread.archived) await storyThread.setArchived(false).catch(() => {});
      const authorLine = show_authors ? `Turn ${turn_number} — ${discord_display_name}` : null;
      await postThreadEntry(storyThread, entryContent, authorLine, scene_break_divider);
      log(`doFinalizeEntry: entry posted to story thread ${activeThreadId} as turn ${turn_number}`, { show: true, guildName: interaction?.guild?.name });
    } catch (embedError) {
      log(`doFinalizeEntry: failed to post entry to story thread: ${embedError}`, { show: true, guildName: interaction?.guild?.name });
    }

    // Next turn's announcement goes after the last page of this entry (NextTurn deferred it)
    if (nextTurnResult?.announce) await nextTurnResult.announce(connection);

    pendingPreviewData.delete(interaction.user.id);
    await interaction.editReply({ content: await getConfigValue(connection, 'txtEntryFinalized', interaction.guild.id), components: [] });
    log(`doFinalizeEntry: complete — deleting turn thread ${turn.thread_id}`, { show: true, guildName: interaction?.guild?.name });
    await deleteThreadAndAnnouncement(thread);

  } catch (error) {
    log(`doFinalizeEntry failed: ${error}`, { show: true, guildName: interaction?.guild?.name });
    try {
      await interaction.editReply({ content: await getConfigValue(connection, 'txtFailedtoFinalize', interaction.guild.id), components: [] });
    } catch {}
  }
}

export async function handleFinalizeConfirm(connection, interaction) {
  const storyId = interaction.customId.split('_')[3];
  const session = pendingPreviewData.get(interaction.user.id);
  const writerId = session?.writerId ?? interaction.user.id;
  log(`handleFinalizeConfirm entry user=${interaction.user.username} writer=${writerId} story=${storyId}`, { show: false, guildName: interaction?.guild?.name });
  await interaction.deferUpdate();

  try {
    const [turnInfo] = await connection.execute(
      `SELECT t.turn_id, t.thread_id FROM turn t
       JOIN story_writer sw ON t.story_writer_id = sw.story_writer_id
       WHERE sw.story_id = ? AND t.turn_status = ? AND sw.discord_user_id = ?`,
      [storyId, TURN_STATUS.ACTIVE, writerId]
    );
    if (turnInfo.length === 0) {
      log(`handleFinalizeConfirm: no active turn for writer ${writerId} story ${storyId}`, { show: false, guildName: interaction?.guild?.name });
      await interaction.editReply({ content: await getConfigValue(connection, 'txtNoActiveTurn', interaction.guild.id), components: [] });
      return;
    }
    log(`handleFinalizeConfirm: turn ${turnInfo[0].turn_id} found, fetching thread messages`, { show: false, guildName: interaction?.guild?.name });
    const thread = await interaction.guild.channels.fetch(turnInfo[0].thread_id);
    const messages = await thread.messages.fetch({ limit: 100 });
    const userMessages = messages
      .filter(msg => msg.author.id === String(writerId))
      .sort((a, b) => a.createdTimestamp - b.createdTimestamp);
    log(`handleFinalizeConfirm: ${userMessages.size} messages from writer ${writerId} fetched`, { show: false, guildName: interaction?.guild?.name });
    if (userMessages.size === 0) {
      log(`handleFinalizeConfirm: no messages found, aborting`, { show: false, guildName: interaction?.guild?.name });
      await interaction.editReply({ content: await getConfigValue(connection, 'txtEmptyEntry', interaction.guild.id), components: [] });
      return;
    }

    const mediaChannelId = await getConfigValue(connection, 'cfgMediaChannelId', interaction.guild.id);
    const mediaChannel = (mediaChannelId && mediaChannelId !== 'cfgMediaChannelId')
      ? await interaction.guild.channels.fetch(mediaChannelId).catch(() => null)
      : null;

    const imageInfos = [];
    for (const msg of userMessages.values()) {
      const displayText = msg.content?.trim() || null;
      for (const att of msg.attachments.values()) {
        if (att.contentType?.startsWith('image/')) {
          imageInfos.push({ filename: att.name, displayText: displayText || att.name });
        }
      }
    }
    log(`handleFinalizeConfirm: ${imageInfos.length} image(s) found, media channel: ${mediaChannel ? mediaChannel.id : 'not configured'}`, { show: false, guildName: interaction?.guild?.name });

    if (imageInfos.length > 0 && mediaChannel) {
      log(`handleFinalizeConfirm: showing image review popup`, { show: false, guildName: interaction?.guild?.name });
      const listLines = imageInfos.map(i => `- ${i.filename} : ${i.displayText}`).join('\n');
      const [reviewTemplate, btnConfirm, btnCancel] = await Promise.all([
        getConfigValue(connection, 'txtFinalizeImageReview', interaction.guild.id),
        getConfigValue(connection, 'btnFinalizeConfirm', interaction.guild.id),
        getConfigValue(connection, 'btnCancel', interaction.guild.id),
      ]);
      const embed = new EmbedBuilder()
        .setDescription(replaceTemplateVariables(reviewTemplate, { image_list: listLines }));
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`story_finalize_image_confirm_${storyId}`)
          .setLabel(btnConfirm)
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`story_finalize_cancel_${storyId}`)
          .setLabel(btnCancel)
          .setStyle(ButtonStyle.Secondary)
      );
      await interaction.editReply({ content: '', embeds: [embed], components: [row] });
      return;
    }

    log(`handleFinalizeConfirm: no images or no media channel — proceeding directly to finalize`, { show: false, guildName: interaction?.guild?.name });
    await doFinalizeEntry(connection, interaction, storyId, writerId);

  } catch (error) {
    log(`handleFinalizeConfirm failed: ${error}`, { show: true, guildName: interaction?.guild?.name });
    try {
      await interaction.editReply({ content: await getConfigValue(connection, 'txtFailedtoFinalize', interaction.guild.id), components: [] });
    } catch {}
  }
}

export async function handleFinalizeImageConfirm(connection, interaction) {
  const storyId = interaction.customId.split('_').at(-1);
  const session = pendingPreviewData.get(interaction.user.id);
  const writerId = session?.writerId ?? interaction.user.id;
  log(`handleFinalizeImageConfirm entry user=${interaction.user.username} story=${storyId} writer=${writerId}`, { show: false, guildName: interaction?.guild?.name });
  await interaction.deferUpdate();
  await doFinalizeEntry(connection, interaction, storyId, writerId);
}
