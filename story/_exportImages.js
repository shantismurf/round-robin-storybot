import { log } from '../utilities.js';
import { DISCORD_ATTACHMENT_RE, extractImageUrls, isDiscordAttachmentUrl } from './_imageUrls.js';

// Re-exported under its old name for call sites that mean the refresh scope specifically.
export const ATTACHMENT_URL_REGEX = DISCORD_ATTACHMENT_RE;
// Matches custom emoji in raw entry markdown: <:name:id> and <a:name:id>
const EMOJI_REGEX = /<(a?):([^:>]+):(\d+)>/g;

const REFRESH_ROUTE = '/attachments/refresh-urls';
const REFRESH_BATCH_SIZE = 50;
const FETCH_TIMEOUT_MS = 15000;
const WSRV_QUALITY = 80;

export function emojiUrl(id, animated) {
  return `https://cdn.discordapp.com/emojis/${id}.${animated ? 'gif' : 'png'}`;
}

// Collect unique image and emoji URLs from raw markdown texts.
// Returns { attachmentUrls, externalUrls, emojiUrls }. The split is the point: only
// attachmentUrls go to Discord's refresh endpoint, because only a Discord CDN link has a
// signature to refresh. externalUrls are downloaded as-is. Both are embedded in the export.
export function collectImageUrls(texts) {
  const attachmentUrls = new Set();
  const externalUrls = new Set();
  const emojiUrls = new Set();
  for (const text of texts) {
    if (!text) continue;
    for (const url of extractImageUrls(text)) {
      (isDiscordAttachmentUrl(url) ? attachmentUrls : externalUrls).add(url);
    }
    for (const match of text.matchAll(EMOJI_REGEX)) emojiUrls.add(emojiUrl(match[3], match[1] === 'a'));
  }
  return {
    attachmentUrls: [...attachmentUrls],
    externalUrls: [...externalUrls],
    emojiUrls: [...emojiUrls],
  };
}

// Ask Discord for fresh signed URLs for expired attachment links (stored entry URLs
// are signed and expire ~24h after issue). Returns Map original -> refreshed.
// URLs that fail to refresh are left out of the map — callers fall back to the original.
export async function refreshAttachmentUrls(rest, urls, { guildName } = {}) {
  const refreshed = new Map();
  if (!rest || urls.length === 0) return refreshed;
  for (let i = 0; i < urls.length; i += REFRESH_BATCH_SIZE) {
    const batch = urls.slice(i, i + REFRESH_BATCH_SIZE);
    try {
      const result = await rest.post(REFRESH_ROUTE, { body: { attachment_urls: batch } });
      for (const entry of result?.refreshed_urls ?? []) {
        if (entry?.original && entry?.refreshed) refreshed.set(entry.original, entry.refreshed);
      }
      log(`refreshAttachmentUrls: batch of ${batch.length} -> ${result?.refreshed_urls?.length ?? 0} refreshed`, { show: false, guildName });
    } catch (error) {
      log(`refreshAttachmentUrls failed for batch of ${batch.length} urls: ${error?.stack ?? error}`, { show: true, guildName });
    }
  }
  return refreshed;
}

// Swap every stored attachment link in `texts` for a freshly signed one, for display.
// Links that can't be refreshed stay as stored. Returns a new array in the same order.
export async function withFreshAttachmentUrls(rest, texts, { guildName } = {}) {
  const { attachmentUrls } = collectImageUrls(texts);
  if (attachmentUrls.length === 0) return texts;
  const refreshMap = await refreshAttachmentUrls(rest, attachmentUrls, { guildName });
  log(`withFreshAttachmentUrls: ${refreshMap.size} of ${attachmentUrls.length} attachment link(s) refreshed`, { show: false, guildName });
  return texts.map(t => t ? t.replace(ATTACHMENT_URL_REGEX, u => refreshMap.get(u) ?? u) : t);
}

// Fetch a URL and return { buffer, contentType } for image responses, or null.
// If the response advertises a Content-Length above maxBytes the body is not downloaded.
async function fetchImage(url, maxBytes, fetchFn, { guildName } = {}) {
  try {
    const res = await fetchFn(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) {
      log(`fetchImage got HTTP ${res.status} for ${url}`, { show: false, guildName });
      return null;
    }
    const contentType = (res.headers.get('content-type') ?? '').split(';')[0].trim();
    if (!contentType.startsWith('image/')) {
      log(`fetchImage skipped non-image content-type '${contentType}' for ${url}`, { show: false, guildName });
      return null;
    }
    const declaredLength = parseInt(res.headers.get('content-length'), 10);
    if (Number.isFinite(maxBytes) && Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      await res.body?.cancel?.();
      return { oversize: true, bytes: declaredLength };
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    if (Number.isFinite(maxBytes) && buffer.byteLength > maxBytes) {
      return { oversize: true, bytes: buffer.byteLength };
    }
    return { buffer, contentType };
  } catch (error) {
    log(`fetchImage failed for ${url}: ${error?.stack ?? error}`, { show: false, guildName });
    return null;
  }
}

// Discord's media proxy serves resized copies of attachments on the same path and
// signed query params — undocumented but used by Discord's own clients.
export function discordProxyResizeUrl(url, width) {
  const rewritten = url.replace('https://cdn.discordapp.com/', 'https://media.discordapp.net/');
  if (rewritten === url) return null;
  const separator = rewritten.includes('?') ? '&' : '?';
  return `${rewritten}${separator}format=webp&width=${width}`;
}

// wsrv.nl is the backup resizer: free open-source image proxy on Cloudflare's CDN.
export function wsrvResizeUrl(url, width) {
  return `https://wsrv.nl/?url=${encodeURIComponent(url)}&w=${width}&output=webp&q=${WSRV_QUALITY}`;
}

/**
 * Download every image and build the embed store used by discordMarkdownToHtml.
 *
 * Returns { images, placeholderText, embeddedCount, failedCount, embeddedBytes } where
 * images is a Map url -> { id, dataUri } (dataUri null when the image could not be
 * embedded — rendered as a visible placeholder, never as an expiring CDN link).
 *
 * Oversized attachments are resized via Discord's media proxy first, wsrv.nl second.
 * A per-image cap (maxBytes) and a whole-export budget (totalBytes) keep the final
 * HTML under Discord's bot upload limit.
 */
export async function buildImageStore({
  attachmentUrls,
  externalUrls,
  emojiUrls,
  refreshMap,
  maxBytes,
  totalBytes,
  resizeWidth,
  placeholderText,
  guildName,
  storyId,
  fetchFn = fetch,
}) {
  const images = new Map();
  let nextId = 1;
  let embeddedBytes = 0;
  let embeddedCount = 0;
  let failedCount = 0;

  const budgetLeft = () => (Number.isFinite(totalBytes) ? totalBytes - embeddedBytes : Infinity);

  const store = (url, result, source) => {
    if (result?.buffer) {
      if (result.buffer.byteLength > budgetLeft()) {
        log(`buildImageStore: total embed budget exceeded for story ${storyId}, image ${url} (${result.buffer.byteLength} bytes, ${budgetLeft()} left)`, { show: true, guildName });
        images.set(url, { id: nextId++, dataUri: null });
        failedCount++;
        return;
      }
      embeddedBytes += result.buffer.byteLength;
      embeddedCount++;
      images.set(url, { id: nextId++, dataUri: `data:${result.contentType};base64,${result.buffer.toString('base64')}` });
      log(`buildImageStore: embedded ${url} via ${source} (${result.buffer.byteLength} bytes)`, { show: false, guildName });
    } else {
      log(`buildImageStore: could not embed image for story ${storyId}: ${url}`, { show: true, guildName });
      images.set(url, { id: nextId++, dataUri: null });
      failedCount++;
    }
  };

  for (const url of attachmentUrls ?? []) {
    const freshUrl = refreshMap?.get(url) ?? url;
    const perImageCap = Math.min(Number.isFinite(maxBytes) ? maxBytes : Infinity, budgetLeft());
    let result = await fetchImage(freshUrl, perImageCap, fetchFn, { guildName });
    if (result?.oversize) {
      log(`buildImageStore: ${freshUrl} is oversize (${result.bytes} bytes), trying resize`, { show: false, guildName });
      const proxyUrl = discordProxyResizeUrl(freshUrl, resizeWidth);
      result = proxyUrl ? await fetchImage(proxyUrl, perImageCap, fetchFn, { guildName }) : null;
      if (!result?.buffer) {
        result = await fetchImage(wsrvResizeUrl(freshUrl, resizeWidth), perImageCap, fetchFn, { guildName });
        store(url, result, 'wsrv.nl resize');
      } else {
        store(url, result, 'discord proxy resize');
      }
    } else {
      store(url, result, 'direct');
    }
  }

  // External images have no signature to refresh and no Discord media proxy behind them, so
  // an oversize one goes straight to wsrv.nl rather than trying discordProxyResizeUrl first
  // (which would no-op on a non-Discord host anyway).
  for (const url of externalUrls ?? []) {
    const perImageCap = Math.min(Number.isFinite(maxBytes) ? maxBytes : Infinity, budgetLeft());
    let result = await fetchImage(url, perImageCap, fetchFn, { guildName });
    if (result?.oversize) {
      log(`buildImageStore: external ${url} is oversize (${result.bytes} bytes), trying resize`, { show: false, guildName });
      result = await fetchImage(wsrvResizeUrl(url, resizeWidth), perImageCap, fetchFn, { guildName });
      store(url, result, 'wsrv.nl resize (external)');
    } else {
      store(url, result, 'external');
    }
  }

  for (const url of emojiUrls ?? []) {
    const perImageCap = Math.min(Number.isFinite(maxBytes) ? maxBytes : Infinity, budgetLeft());
    store(url, await fetchImage(url, perImageCap, fetchFn, { guildName }), 'emoji');
  }

  return { images, placeholderText, embeddedCount, failedCount, embeddedBytes };
}

// Bottom-of-file image data block: one JSON blob plus a tiny loader that fills each
// placeholder <img data-storybot-img> when the file is opened. Keeping the base64 out
// of the story body keeps the file readable and the AO3 copy region clean.
export function buildImageDataBlock(imageStore) {
  if (!imageStore || imageStore.embeddedCount === 0) return '';
  const data = {};
  for (const { id, dataUri } of imageStore.images.values()) {
    if (dataUri) data[id] = dataUri;
  }
  return `
  <!-- ═══ STORYBOT IMAGE DATA — embedded image files, referenced by the story above. Do not copy this section into AO3. ═══ -->
  <script type="application/json" id="storybot-images">${JSON.stringify(data)}</script>
  <script>
    (function () {
      var el = document.getElementById('storybot-images');
      if (!el) return;
      var data = JSON.parse(el.textContent);
      var imgs = document.querySelectorAll('img[data-storybot-img]');
      for (var i = 0; i < imgs.length; i++) {
        var src = data[imgs[i].getAttribute('data-storybot-img')];
        if (src) imgs[i].src = src;
      }
    })();
  </script>`;
}
