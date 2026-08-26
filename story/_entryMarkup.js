// Shared inline markup transforms for story entry content.
//
// [[break]] and [[text|translation]] below are applied at RENDER time (never baked into
// story_entry.content). resolveMentionsToPlainText is the opposite: it runs once, at WRITE
// time, and its result IS what gets stored as content from then on. See
// docs/plans/PLAN-mention-display-text.md for the full design rationale — the short version:
// story entries never contain functional Discord mentions or clickable links, anywhere
// they're shown (Discord thread posts, embeds, or the AO3-facing export). A mention typed into
// a story is in-fiction text, not a real address-book lookup — it should never accidentally
// notify a real user, and never leak a private server's channel/user structure to a reader on
// an external platform. This is a deliberate decision, not an oversight — don't "fix" it by
// making mentions functional again without re-reading that doc first.
//  - [[break]]            -> story's Scene Break Divider text (or left literal if unset)
//  - [[text|translation]] -> hover-tooltip translation

const TOOLTIP_RE = /\[\[([^[\]\n|]*)\|([^[\]\n]*)\]\]/g;

// Resolves <@id>/<#id>/<@&id> Discord mention tokens to plain display text — the real
// name/channel/role when it can be resolved against `guild`, or a generic placeholder when it
// can't (unresolvable is unresolvable, regardless of *why*: ordinary cache miss, deleted,
// user left the server, or a channel hidden by Discord's channel-obfuscation-for-bots change).
// Never the raw numeric ID, never a functional link, under any circumstance.
//
// `cfg` supplies the placeholder text — pass the object from getConfigValue() with
// txtExportPlaceholderUser/Channel/Role already fetched; missing keys fall back to a literal
// bracketed tag (matches getConfigValue's own "return the key name" miss behavior) rather than
// throwing, since a missing config key shouldn't block a story write.
//
// Idempotent: running this on already-resolved plain text (no <@id>-shaped tokens present)
// finds nothing to match and returns the input unchanged — this is what lets export.js reuse it
// on old rows that still hold raw tokens from before this helper existed, with no need to branch
// on which era of data it's looking at.
export async function resolveMentionsToPlainText(text, guild, cfg = {}) {
  if (!guild) {
    return text
      .replace(/<@!?(\d+)>/g, cfg.txtExportPlaceholderUser ?? '@[user]')
      .replace(/<#(\d+)>/g, cfg.txtExportPlaceholderChannel ?? '#[channel]')
      .replace(/<@&(\d+)>/g, cfg.txtExportPlaceholderRole ?? '@[role]');
  }

  // Batch-fetch all mentioned users first (avoid duplicate requests for repeated mentions).
  // Stores { resolved: bool, name } rather than a bare string, so the replace step below knows
  // whether to prefix "@" itself (a resolved display name never has one) or use the placeholder
  // verbatim (config-authored text may or may not include its own "@").
  const userIds = [...new Set([...text.matchAll(/<@!?(\d+)>/g)].map(m => m[1]))];
  const memberMap = new Map();
  for (const userId of userIds) {
    try {
      const member = await guild.members.fetch(userId);
      memberMap.set(userId, { resolved: true, name: member.displayName });
    } catch {
      memberMap.set(userId, { resolved: false, name: cfg.txtExportPlaceholderUser ?? '@[user]' });
    }
  }

  return text
    .replace(/<@!?(\d+)>/g, (_, id) => {
      const entry = memberMap.get(id);
      return entry.resolved ? `@${entry.name}` : entry.name;
    })
    .replace(/<#(\d+)>/g, (_, id) => {
      const ch = guild.channels.cache.get(id);
      return ch ? `#${ch.name}` : (cfg.txtExportPlaceholderChannel ?? '#[channel]');
    })
    .replace(/<@&(\d+)>/g, (_, id) => {
      const role = guild.roles.cache.get(id);
      return role ? `@${role.name}` : (cfg.txtExportPlaceholderRole ?? '@[role]');
    });
}

function replaceTooltips(line, target) {
  return line.replace(TOOLTIP_RE, (_, text, translation) => {
    text = text.trim();
    translation = translation.trim();
    return target === 'html'
      ? `<span class="tooltip">${text}<span class="tooltiptext">${translation}</span></span>`
      : `${text} *(${translation})*`;
  });
}

// export.js uses this to decide whether a line should become <p class="scene-break">
export function isSceneBreakLine(line, dividerText) {
  return !!dividerText && line.trim().toLowerCase() === '[[break]]';
}

// target: 'discord' -> content is the full multi-line entry; handles [[break]]
//   line-swap AND [[text|translation]] tooltips, returns the transformed string.
// target: 'html' -> content is a SINGLE line (export.js already handled [[break]]
//   for this line before calling this); handles only [[text|translation]].
export function applyEntryMarkup(content, { dividerText = null, target = 'discord' } = {}) {
  if (target === 'html') return replaceTooltips(content, 'html');

  return content.split('\n').map(line => {
    if (line.trim().toLowerCase() === '[[break]]') return dividerText ?? line;
    return replaceTooltips(line, 'discord');
  }).join('\n');
}
