/**
 * entryRenderer.js — single source of truth for displaying story entry content.
 *
 * Interactive display (paginated, session-backed):
 *   buildEntryPages()  — splits one entry into page objects
 *   buildEntryEmbed()  — renders one page into { embeds, components }
 *
 * Non-interactive display (permanent thread/channel posts):
 *   postEntryToThread() — author line + footer from config, then postThreadEntry()
 *   postThreadEntry()  — sends one message per chunk (and per image) to a channel, safe for any entry length
 *   buildEntryFooter() — the shared lblEntryFooter text, used by both kinds of display
 */

import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } from 'discord.js';
import { splitAtParagraphs, replaceTemplateVariables, log, getConfigValue } from '../utilities.js';
import { applyEntryMarkup } from './_entryMarkup.js';
import { withFreshAttachmentUrls } from './_exportImages.js';
import { IMAGE_LINK_RE, extractImageUrls, isSafeImageUrl } from './_imageUrls.js';
import { countWords } from './_wordCount.js';
import { getStoryWordCount } from './_entryContent.js';

const IMAGES_PER_PAGE = 4;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Interactive: build pages for a single entry
// ---------------------------------------------------------------------------

/**
 * Split one entry's content into page objects compatible with buildEntryEmbed.
 *
 * @param {string} content
 * @param {{ turnNumber, writerName, entryWords, showAuthors, storyEntryId, editInfo, sceneBreakDivider }} meta
 *   entryWords: the entry's stored word_count. Omit it for a preview, whose text is not saved
 *   yet, and the text is counted live.
 * @returns {Array} pages
 */
export function buildEntryPages(content, { turnNumber, writerName, entryWords = null, showAuthors, storyEntryId, editInfo = null, sceneBreakDivider = null } = {}) {
  // Word count for the whole entry (all chunks combined), the same figure on every page of a
  // split entry. Saved entries pass their stored count. A preview counts the raw text live, before
  // markup turns a [[break]] into divider text.
  const entryWordCount = entryWords ?? countWords(content);
  content = applyEntryMarkup(content, { dividerText: sceneBreakDivider, target: 'discord' });
  const chunks = splitAtParagraphs(content);
  return chunks.map((chunk, i) => ({
    turnNumber,
    writerName: showAuthors ? writerName : null,
    content: chunk,
    partIndex: i + 1,
    partCount: chunks.length,
    entryWordCount,
    storyEntryId,
    isFirstChunk: i === 0,
    editInfo: i === 0 ? editInfo : null,
    // Each page carries the images whose links fall in its own text, so a picture shows
    // alongside the part of the entry it belongs to.
    imageUrls: extractImageUrls(chunk),
  }));
}

// The config keys every footer needs. Callers fetch these together and pass the result as
// `templates` (to buildEntryFooter, or as footerTemplates on a buildEntryEmbed session).
export const ENTRY_FOOTER_KEYS = ['lblEntryFooter', 'lblEntryFooterStory'];

/**
 * buildEntryFooter — the one footer every entry view uses, so /story read, the finalize and
 * quick mode previews, and story thread posts all read the same way:
 *   "Turn 5 · Ana · Entry: part 2 of 2, 512 total words · Story: page 14 of 20, 9,800 total words"
 * lblEntryFooter holds the turn, writer and Entry part. lblEntryFooterStory fills its
 * [storyPart] token. Each optional block is left out by omitting its token: writer (show_authors
 * off), part (entry not split), page (not the paged story view), Story (no story total, as in
 * a preview).
 *
 * @param {{ lblEntryFooter: string, lblEntryFooterStory: string }} templates  ENTRY_FOOTER_KEYS values
 */
export function buildEntryFooter(templates, { turnNumber, writerName = null, entryWords, part = null, partCount = null, page = null, totalPages = null, storyWords = null }) {
  const tokens = { turn: String(turnNumber), entryWords: Number(entryWords ?? 0).toLocaleString() };
  if (writerName) tokens.writer = writerName;
  if (partCount > 1) { tokens.part = String(part); tokens.partCount = String(partCount); }
  if (storyWords !== null && storyWords !== undefined) {
    const storyTokens = { storyWords: Number(storyWords).toLocaleString() };
    if (page !== null && page !== undefined && totalPages !== null && totalPages !== undefined) {
      storyTokens.page = String(page);
      storyTokens.total = String(totalPages);
    }
    tokens.storyPart = replaceTemplateVariables(templates.lblEntryFooterStory, storyTokens);
  }
  return replaceTemplateVariables(templates.lblEntryFooter, tokens);
}

/**
 * postEntryToThread — posts a finished entry to a story thread with the shared author line
 * (lblEntryAuthor, only when the story shows authors) and the shared footer on its last
 * message, including the story's word total. Every thread post of an entry goes through here:
 * finalize, quick mode submit, View Last Entry, the edit repost and the starter story.
 *
 * Call it after the entry's save is committed, so the story total includes it. The entry's own
 * count is worked out from the text being posted, which is the same countWords() figure
 * updateEntryContent()/insertEntry() stored for it.
 */
export async function postEntryToThread(connection, channel, { content, storyId, turnNumber, writerName, showAuthors, edited = false, sceneBreakDivider = null, guildId }) {
  const guildName = channel?.guild?.name;
  const cfg = await getConfigValue(connection, ['lblEntryAuthor', 'txtEntryEditedMark', ...ENTRY_FOOTER_KEYS], guildId);
  const authorTokens = { turn: String(turnNumber), writer: writerName };
  if (edited) authorTokens.edited = cfg.txtEntryEditedMark;
  const authorLine = showAuthors ? replaceTemplateVariables(cfg.lblEntryAuthor, authorTokens) : null;
  const storyWords = await getStoryWordCount(connection, storyId, { guildName });
  const footerText = buildEntryFooter(cfg, {
    turnNumber,
    writerName: showAuthors ? writerName : null,
    entryWords: countWords(content),
    storyWords,
  });
  log(`postEntryToThread: story ${storyId} turn ${turnNumber} to thread ${channel?.id}, footer "${footerText}"`, { show: false, guildName });
  await postThreadEntry(channel, content, authorLine, sceneBreakDivider, footerText);
}

/**
 * Render a page and navigation buttons into { embeds, components }.
 *
 * @param {object} page        — one element from buildEntryPages()
 * @param {object} session     — { title, pageIndex, totalPages, imagePageIndex, guildId, storyThreadId, context, extraButtons, footerTemplates, txtEntryEditedBy, storyWordCount }
 *   context: 'read' | 'preview' | 'view'  — selects which customId prefix to use for nav buttons
 *   extraButtons: ActionRowBuilder[]       — injected rows appended after the nav row (e.g. Confirm/Cancel)
 *   footerTemplates: object|undefined      — the ENTRY_FOOTER_KEYS config values; footer is omitted if not supplied
 *   txtEntryEditedBy: string|undefined     — the edited-by line under an edited entry (read only)
 *   storyWordCount: number|undefined       — whole-story word count; only read.js has this, so the Story block is optional
 */
export function buildEntryEmbed(page, session) {
  const { title, pageIndex, totalPages, context = 'read', extraButtons = [], storyThreadId, guildId, footerTemplates, txtEntryEditedBy, storyWordCount } = session;

  let description = page.content;
  if (page.editInfo && txtEntryEditedBy) {
    description += `\n\n${replaceTemplateVariables(txtEntryEditedBy, { editor: page.editInfo.editedByName, edited_at: page.editInfo.editedAt })}`;
  }

  const imageUrls = page.imageUrls ?? [];
  const imagePageIndex = session.imagePageIndex ?? 0;
  const totalImagePages = imageUrls.length > 0 ? Math.ceil(imageUrls.length / IMAGES_PER_PAGE) : 0;
  const imageSlice = imageUrls.slice(imagePageIndex * IMAGES_PER_PAGE, (imagePageIndex + 1) * IMAGES_PER_PAGE);
  const groupUrl = storyThreadId
    ? `https://discord.com/channels/${guildId}/${storyThreadId}`
    : 'https://discord.com';

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setColor(0x5865f2);

  if (footerTemplates) {
    embed.setFooter({ text: buildEntryFooter(footerTemplates, {
      turnNumber: page.turnNumber,
      writerName: page.writerName,
      entryWords: page.entryWordCount,
      part: page.partIndex,
      partCount: page.partCount,
      // Story pages only mean something in the paged story view. In a preview the only pages
      // are the entry's own parts, which the part block already shows.
      page: context === 'read' ? pageIndex + 1 : null,
      totalPages: context === 'read' ? totalPages : null,
      storyWords: storyWordCount,
    }) });
  }

  if (imageSlice.length > 0) embed.setURL(groupUrl);

  const embeds = [embed];
  for (const url of imageSlice) {
    embeds.push(new EmbedBuilder().setURL(groupUrl).setImage(url));
  }

  const prefix = NAV_PREFIX[context] ?? NAV_PREFIX.read;

  const navRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${prefix}_back10`)
      .setLabel('«')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(pageIndex === 0),
    new ButtonBuilder()
      .setCustomId(`${prefix}_prev`)
      .setLabel('← Prev')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(pageIndex === 0),
    new ButtonBuilder()
      .setCustomId(`${prefix}_next`)
      .setLabel('Next →')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(pageIndex >= totalPages - 1),
    new ButtonBuilder()
      .setCustomId(`${prefix}_fwd10`)
      .setLabel('»')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(pageIndex >= totalPages - 1),
  );

  const components = [navRow, ...extraButtons];

  if (totalImagePages > 1) {
    components.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`${prefix}_img_prev`)
        .setLabel('◀ Images')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(imagePageIndex === 0),
      new ButtonBuilder()
        .setCustomId(`${prefix}_img_next`)
        .setLabel('Images ▶')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(imagePageIndex >= totalImagePages - 1)
    ));
  }

  return { embeds, components };
}

// Next image-page index for an Images ◀ (-1) / Images ▶ (+1) press, kept in range for this page's images.
// Shared by every paged view so read and preview step the gallery the same way.
export function stepImagePage(imagePageIndex, imageUrls, direction) {
  const totalImagePages = Math.max(1, Math.ceil((imageUrls?.length ?? 0) / IMAGES_PER_PAGE));
  return Math.min(totalImagePages - 1, Math.max(0, (imagePageIndex ?? 0) + direction));
}

// Button customId prefixes per context — distinct to avoid session collisions.
export const NAV_PREFIX = {
  read:    'story_read',
  preview: 'story_preview',
  view:    'story_view',
};

// ---------------------------------------------------------------------------
// Non-interactive: stacked embeds for permanent thread posts
// ---------------------------------------------------------------------------

// Split entry content into ordered text and image segments, so images can post inline.
export function splitAtImages(content) {
  const segments = [];
  let last = 0;
  for (const m of content.matchAll(IMAGE_LINK_RE)) {
    // A URL that matches the shape but fails validation is left in the prose rather than
    // posted as an image. discord.js fetches the URL to upload it, so this is the gate that
    // keeps the bot from being pointed at an address of someone else's choosing.
    if (!isSafeImageUrl(m[2] ?? m[3])) continue;
    const text = content.slice(last, m.index).trim();
    if (text) segments.push({ type: 'text', text });
    segments.push({ type: 'image', url: m[2] ?? m[3], caption: m[1] ?? null, raw: m[0] });
    last = m.index + m[0].length;
  }
  const tail = content.slice(last).trim();
  if (tail) segments.push({ type: 'text', text: tail });
  return segments;
}

// File name from an attachment URL (path's last segment, query string dropped).
function attachmentFileName(url) {
  const path = url.split('?')[0];
  return decodeURIComponent(path.slice(path.lastIndexOf('/') + 1));
}

/**
 * Post a story entry to a channel, splitting at paragraph boundaries so no
 * single message exceeds Discord's 6000-char total embed limit, and at each image
 * so it appears inline where the writer placed it.
 * Each text chunk becomes one message with one embed. Each image becomes its own
 * message with the file attached (re-uploaded, so it belongs to that message and
 * never goes stale the way a stored signed link does), with its caption as the
 * embed text unless the caption is just the file name.
 *
 * @param {TextChannel} channel    — Discord channel or thread to post to
 * @param {string}      content    — full entry content
 * @param {string|null} authorLine — e.g. "Turn 3 — Dragonborn"; null if show_authors is false
 * @param {string|null} sceneBreakDivider — story's Scene Break Divider text, or null if unset
 */
export async function postThreadEntry(channel, content, authorLine = null, sceneBreakDivider = null, footerText = null) {
  content = applyEntryMarkup(content, { dividerText: sceneBreakDivider, target: 'discord' });
  const guildName = channel?.guild?.name;
  let segments = splitAtImages(content);
  const imageCount = segments.filter(s => s.type === 'image').length;
  if (imageCount > 0) {
    // Stored links are signed and expire ~24h after issue; refresh before uploading.
    const freshUrls = await withFreshAttachmentUrls(channel?.client?.rest, segments.map(s => s.url ?? null), { guildName });
    segments = segments.map((s, i) => s.type === 'image' ? { ...s, freshUrl: freshUrls[i] } : s);
  }
  log(`postThreadEntry: posting to ${channel?.id} — ${segments.length} segment(s), ${imageCount} image(s)`, { show: false, guildName });

  // Build every message first so the footer can go on the last one.
  const posts = [];
  for (const seg of segments) {
    if (seg.type === 'image') {
      const name = attachmentFileName(seg.url);
      const embed = new EmbedBuilder().setImage(`attachment://${name}`);
      if (seg.caption && seg.caption !== name) embed.setDescription(seg.caption);
      posts.push({ embed, image: { seg, name } });
      continue;
    }
    for (const chunk of splitAtParagraphs(seg.text, 3800)) {
      posts.push({ embed: new EmbedBuilder().setDescription(chunk) });
    }
  }
  if (posts.length === 0) return;
  if (authorLine) posts[0].embed.setAuthor({ name: authorLine });
  if (footerText) posts[posts.length - 1].embed.setFooter({ text: footerText });

  for (const [i, post] of posts.entries()) {
    if (!post.image) {
      await channel.send({ embeds: [post.embed] });
      continue;
    }
    const { seg, name } = post.image;
    try {
      await channel.send({ embeds: [post.embed], files: [new AttachmentBuilder(seg.freshUrl, { name })] });
    } catch (error) {
      // Fall back to the link as text so the entry is never missing a piece.
      log(`postThreadEntry failed to attach image ${name} in ${channel?.id}, posting link instead: ${error?.stack ?? error}`, { show: true, guildName });
      const fallback = new EmbedBuilder().setDescription(seg.raw);
      if (i === 0 && authorLine) fallback.setAuthor({ name: authorLine });
      if (i === posts.length - 1 && footerText) fallback.setFooter({ text: footerText });
      await channel.send({ embeds: [fallback] });
    }
  }
}
