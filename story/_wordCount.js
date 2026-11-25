import { extractImageUrls } from './_imageUrls.js';

/**
 * countWords — the one word count for entry text, used wherever a count is stored or shown.
 * See docs/plans/PLAN-stored-word-counts.md.
 *
 * It counts the way AO3 does, so the bot's numbers match a story once it is posted there. The
 * core is AO3's WordCounter (lib/word_counter.rb), as already ported in LeeAnn's ficfeed bot
 * (commands/wordcount.js):
 *  - a word is a run of letters, digits, combining marks or connector punctuation, so anything
 *    else ends it: "one—two" and "well...okay" are 2 words, and "1,200" is 2 (AO3's quirk, kept
 *    so the numbers match)
 *  - "--" becomes a dash first, then apostrophes and hyphens are dropped, so "one-word" and
 *    "one's" are 1 word each
 *  - Chinese, Japanese and Thai count one word per character
 *  - bare punctuation ("* * *", a lone "—") has no word characters, so it is not counted
 *
 * Before that, two steps of our own, because entries are stored as markdown-ish text rather
 * than the HTML AO3 counts:
 *  - image URLs are removed (a [caption](url) link keeps its caption)
 *  - [[break]] scene-break marker lines are skipped
 * A [[text|translation]] tooltip counts both halves on its own, since the brackets and pipe are
 * not word characters. That matches AO3, which counts the hidden translation in the exported
 * tooltip span (LeeAnn, 2026-11-24).
 */
const CHARACTER_COUNT_SCRIPTS = ['Han', 'Hiragana', 'Katakana', 'Thai'];
const SCRIPT_PATTERN = CHARACTER_COUNT_SCRIPTS.map(script => `\\p{Script=${script}}`).join('|');
const WORD_PATTERN = new RegExp(
  `${SCRIPT_PATTERN}|(?:(?!${SCRIPT_PATTERN})[\\p{L}\\p{Nd}\\p{M}\\p{Pc}])+`,
  'gu'
);
const BREAK_LINE = /^[ \t]*\[\[break\]\][ \t]*$/gim;

export function countWords(text) {
  if (!text) return 0;
  let s = String(text);
  for (const url of extractImageUrls(s)) s = s.split(url).join('');
  s = s.replace(BREAK_LINE, '');
  const normalized = s.replace(/--/g, '—').replace(/['’‘-]/g, '');
  return (normalized.match(WORD_PATTERN) || []).length;
}
