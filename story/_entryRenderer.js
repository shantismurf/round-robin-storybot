/**
 * entryRenderer.js — single source of truth for displaying story entry content.
 *
 * Interactive display (paginated, session-backed):
 *   buildEntryPages()  — splits one entry into page objects
 *   buildEntryEmbed()  — renders one page into { embeds, components }
 *
 * Non-interactive display (permanent thread/channel posts):
 *   postThreadEntry()  — sends one message per chunk (and per image) to a channel, safe for any entry length
 */

import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } from 'discord.js';
import { splitAtParagraphs, replaceTemplateVariables, log } from '../utilities.js';
import { applyEntryMarkup } from './_entryMarkup.js';
import { withFreshAttachmentUrls } from './_exportImages.js';

const IMAGES_PER_PAGE = 4;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function extractImageUrls(content) {
  const urls = [];
  const mdRe = /\[[^\]]*\]\((https:\/\/cdn\.discordapp\.com\/attachments\/[^\s)]+)\)/g;
  let m;
  while ((m = mdRe.exec(content)) !== null) urls.push(m[1]);
  const bareRe = /(?<!\()(https:\/\/cdn\.discordapp\.com\/attachments\/[^\s<"]+)/g;
  while ((m = bareRe.exec(content)) !== null) urls.push(m[1]);
  return urls;
}

// ---------------------------------------------------------------------------
// Interactive: build pages for a single entry
// ---------------------------------------------------------------------------

/**
 * Split one entry's content into page objects compatible with buildEntryEmbed.
 *
 * @param {string} content
 * @param {{ turnNumber, writerName, showAuthors, storyEntryId, editInfo, sceneBreakDivider }} meta
 * @returns {Array} pages
 */
export function buildEntryPages(content, { turnNumber, writerName, showAuthors, storyEntryId, editInfo = null, sceneBreakDivider = null } = {}) {
  content = applyEntryMarkup(content, { dividerText: sceneBreakDivider, target: 'discord' });
  const chunks = splitAtParagraphs(content);
  // Word count for the whole entry (all chunks combined) — same figure shown on every page of a split entry.
  const entryWordCount = content.trim().split(/\s+/).filter(Boolean).length;
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

/**
 * Render a page and navigation buttons into { embeds, components }.
 *
 * @param {object} page        — one element from buildEntryPages()
 * @param {object} session     — { title, pageIndex, totalPages, imagePageIndex, guildId, storyThreadId, context, extraButtons, footerTemplate, storyWordCount }
 *   context: 'read' | 'preview' | 'view'  — selects which customId prefix to use for nav buttons
 *   extraButtons: ActionRowBuilder[]       — injected rows appended after the nav row (e.g. Confirm/Cancel)
 *   footerTemplate: string|undefined       — lblEntryFooter config value; footer is omitted if not supplied (caller sets its own)
 *   storyWordCount: number|undefined       — whole-story word count; only read.js has this, so [storyWords] is optional in the template
 */
export function buildEntryEmbed(page, session) {
  const { title, pageIndex, totalPages, context = 'read', extraButtons = [], storyThreadId, guildId, footerTemplate, storyWordCount } = session;

  let description = page.content;
  if (page.editInfo) {
    description += `\n\n*edited by ${page.editInfo.editedByName} · ${page.editInfo.editedAt}*`;
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

  if (footerTemplate) {
    const footerTokens = {
      turn: String(page.turnNumber),
      part: String(page.partIndex),
      partCount: String(page.partCount),
      entryWords: page.entryWordCount.toLocaleString(),
      page: String(pageIndex + 1),
      total: String(totalPages),
    };
    if (page.writerName) footerTokens.writer = page.writerName;
    if (storyWordCount !== undefined && storyWordCount !== null) footerTokens.storyWords = storyWordCount.toLocaleString();
    embed.setFooter({ text: replaceTemplateVariables(footerTemplate, footerTokens) });
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

// Matches an image link in entry content: [caption](cdn attachment url) or a bare cdn url.
const IMAGE_LINK_RE = /\[([^\]]*)\]\((https:\/\/cdn\.discordapp\.com\/attachments\/[^\s)]+)\)|(?<!\()(https:\/\/cdn\.discordapp\.com\/attachments\/[^\s<"]+)/g;

// Split entry content into ordered text and image segments, so images can post inline.
export function splitAtImages(content) {
  const segments = [];
  let last = 0;
  for (const m of content.matchAll(IMAGE_LINK_RE)) {
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
export async function postThreadEntry(channel, content, authorLine = null, sceneBreakDivider = null) {
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

  let first = true;
  for (const seg of segments) {
    if (seg.type === 'image') {
      const name = attachmentFileName(seg.url);
      const embed = new EmbedBuilder().setImage(`attachment://${name}`);
      if (seg.caption && seg.caption !== name) embed.setDescription(seg.caption);
      if (first && authorLine) embed.setAuthor({ name: authorLine });
      try {
        await channel.send({ embeds: [embed], files: [new AttachmentBuilder(seg.freshUrl, { name })] });
      } catch (error) {
        // Fall back to the link as text so the entry is never missing a piece.
        log(`postThreadEntry failed to attach image ${name} in ${channel?.id}, posting link instead: ${error?.stack ?? error}`, { show: true, guildName });
        const fallback = new EmbedBuilder().setDescription(seg.raw);
        if (first && authorLine) fallback.setAuthor({ name: authorLine });
        await channel.send({ embeds: [fallback] });
      }
      first = false;
      continue;
    }
    for (const chunk of splitAtParagraphs(seg.text, 3800)) {
      const embed = new EmbedBuilder().setDescription(chunk);
      if (first && authorLine) embed.setAuthor({ name: authorLine });
      await channel.send({ embeds: [embed] });
      first = false;
    }
  }
}
