// One definition of "this URL is an image" for the whole pipeline.
//
// Seven separate regexes used to spell this out, each hard-coded to
// cdn.discordapp.com/attachments/: two in _exportImages.js, two in export.js, three in
// _entryRenderer.js and one in _storyStatus.js. They drifted in their delimiter sets, and
// widening image support meant finding all seven. They now all come from here.
//
// The module keeps two things deliberately apart, because conflating them is a bug:
//
//   1. "Is this an image we should render, count, or download?" — any https image URL.
//   2. "Does this URL need a fresh Discord signature?" — Discord CDN links ONLY.
//
// Stored attachment links are signed and expire ~24h after issue, so (2) exists to swap
// them for freshly signed ones via Discord's refresh endpoint. An external URL has no
// signature to refresh and must never be sent to that endpoint, so DISCORD_ATTACHMENT_RE
// stays narrow while the image patterns widen around it.
//
// See docs/plans/completed/PLAN-copyedit-round-trip.md, "Images: tokens rejected, and the real gap".

// Extensions we accept. Deliberately a closed list: the point is to recognise image files,
// not to follow whatever a URL claims to be.
const IMAGE_EXT = 'png|jpe?g|gif|webp|avif';

// The URL shape used inside the content-scanning patterns below. Lazy up to the extension so
// it stops at the first one, then a greedy query string so Discord's signed ?ex=&is=&hm=
// params are kept — truncating those would break every stored attachment link.
const URL_CORE = String.raw`https:\/\/[^\s<>"'\)\]]+?\.(?:${IMAGE_EXT})(?:\?[^\s<>"'\)\]]*)?`;

// Discord CDN attachment links, and nothing else. This is the refresh scope (job 2 above).
// Kept as its own pattern rather than derived from URL_CORE, so widening the image patterns
// can never accidentally widen what gets posted to the refresh endpoint.
export const DISCORD_ATTACHMENT_RE = /https:\/\/cdn\.discordapp\.com\/attachments\/[^\s)\]<>"']+/g;

export function isDiscordAttachmentUrl(url) {
  return typeof url === 'string' && url.startsWith('https://cdn.discordapp.com/attachments/');
}

// A bare image URL in entry content. The lookbehind keeps it from re-matching the URL inside
// a [caption](url) link, which IMAGE_LINK_RE already handles.
export const BARE_IMAGE_URL_RE = new RegExp(String.raw`(?<!\()(${URL_CORE})`, 'g');

// An image in entry content, either [caption](url) or a bare url. Group 1 is the caption and
// group 2 the url for the markdown form; group 3 is the url for the bare form.
export const IMAGE_LINK_RE = new RegExp(
  String.raw`\[([^\]]*)\]\((${URL_CORE})\)|(?<!\()(${URL_CORE})`,
  'g'
);

// Markdown image links only: [caption](url). Used where the caption matters.
export const MARKDOWN_IMAGE_RE = new RegExp(String.raw`\[[^\]]*\]\((${URL_CORE})\)`, 'g');

// Legacy ![](url) syntax, stripped before markdown rendering.
export const BANG_IMAGE_RE = new RegExp(String.raw`!\[\]\((${URL_CORE})\)`, 'g');

// An <a href="url">text</a> that marked produced from an image link, for the HTML export's
// post-render pass. Its own URL shape rather than URL_CORE: inside an HTML attribute the
// terminator is the quote, so ')' and ']' are ordinary URL characters here.
const ATTR_URL_CORE = String.raw`https:\/\/[^\s"]+?\.(?:${IMAGE_EXT})(?:\?[^\s"]*)?`;
export const ANCHOR_IMAGE_RE = new RegExp(
  String.raw`<a href="(${ATTR_URL_CORE})"[^>]*>([^<]*)<\/a>`,
  'g'
);

// Hosts we refuse outright. A bare IP literal is rejected wholesale rather than range-checked:
// legitimate image hosts have names, and enumerating every private range (10/8, 172.16/12,
// 192.168/16, 127/8, 169.254/16, 100.64/10, ::1, fc00::/7, fe80::/10, ::ffff: mapped v4) is
// easy to get subtly wrong.
//
// This is shape validation, not a resolver check: a hostname that resolves to a private
// address still gets through, and stopping that needs resolve-then-connect control that
// Node's fetch does not offer. The remaining defences are in fetchImage
// (story/_exportImages.js) — an image/* content-type requirement, a timeout, and size caps —
// which together mean an internal endpoint has to serve a real image to get anywhere.
const IPV4_LITERAL = /^\d{1,3}(\.\d{1,3}){3}$/;
const BLOCKED_HOST = /^(localhost|.*\.localhost)$/i;

/**
 * Whether a URL found in entry content may be treated as an image: https, a recognised image
 * extension, and not an address that points back inside our own network.
 *
 * Shape only — it never calls the network, so a link to an image that no longer exists still
 * passes here and fails later as a visible placeholder. That is the intended behaviour: a
 * writer should not wait on an HTTP round trip to save an entry, and a URL that works today
 * can rot tomorrow regardless of what we checked at write time.
 */
export function isSafeImageUrl(url) {
  if (typeof url !== 'string' || url.length === 0) return false;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  const host = parsed.hostname;
  if (!host) return false;
  // new URL() wraps IPv6 literals in brackets, which is the only way hostname contains ':'.
  if (host.startsWith('[') || host.includes(':')) return false;
  if (IPV4_LITERAL.test(host)) return false;
  if (BLOCKED_HOST.test(host)) return false;
  if (!new RegExp(String.raw`\.(?:${IMAGE_EXT})$`, 'i').test(parsed.pathname)) return false;
  return true;
}

/**
 * Every image URL in a piece of entry content, in order, markdown and bare forms both,
 * filtered to the ones that pass isSafeImageUrl.
 */
export function extractImageUrls(content) {
  if (!content) return [];
  const urls = [];
  for (const m of content.matchAll(IMAGE_LINK_RE)) {
    const url = m[2] ?? m[3];
    if (url && isSafeImageUrl(url)) urls.push(url);
  }
  return urls;
}
