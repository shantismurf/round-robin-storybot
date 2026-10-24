// The one query path both exports use. Its own module rather than living in either export
// file, so story/export.js (HTML, for AO3) and story/_exportText.js (plain text, for editing)
// can share it without importing each other.
import { WRITER_STATUS, ENTRY_STATUS } from '../constants.js';
import { turnNumberSubquery, entryOrderSort } from './_entryOrder.js';

/**
 * The story, its active writers and its confirmed entries in turn order — everything both
 * export formats need. Shared so the HTML export and the plain-text editing export cannot
 * disagree about which entries belong to a story or what order they come in.
 * Returns null if the story does not exist in this guild.
 */
export async function fetchStoryForExport(connection, storyId, guildId) {
  const [storyRows] = await connection.execute(
    `SELECT story_id, guild_story_id, title, created_at, story_status, mode, closed_at, show_authors,
            summary, tags, rating, warnings, main_pairing, other_relationships, characters, dynamic, scene_break_divider
     FROM story WHERE story_id = ? AND guild_id = ?`,
    [storyId, guildId]
  );
  if (storyRows.length === 0) return null;

  const [writers] = await connection.execute(
    `SELECT discord_display_name, pen_name FROM story_writer WHERE story_id = ? AND sw_status = ? ORDER BY joined_at ASC`,
    [storyId, WRITER_STATUS.ACTIVE]
  );

  // story_entry_id is selected for the text export's per-entry delimiters; the HTML export
  // ignores it.
  const [entries] = await connection.execute(
    `SELECT se.story_entry_id, se.content, se.created_at, sw.discord_display_name, sw.pen_name,
            ${turnNumberSubquery()} as turn_number
     FROM story_entry se
     JOIN turn t ON se.turn_id = t.turn_id
     JOIN story_writer sw ON t.story_writer_id = sw.story_writer_id
     WHERE sw.story_id = ? AND se.entry_status = ?
     ORDER BY ${entryOrderSort()}`,
    [ENTRY_STATUS.CONFIRMED, storyId, ENTRY_STATUS.CONFIRMED]
  );

  return { story: storyRows[0], writers, entries };
}

// ---------------------------------------------------------------------------
// Export filenames
// ---------------------------------------------------------------------------

// Characters no filesystem will accept, plus control characters. Everything else — parentheses,
// apostrophes, commas — is deliberately left alone: a title should still read like its title
// once it is a filename. The old pattern replaced every non-alphanumeric character, which
// turned "The Dragon's Keep (Part 2)" into "the_dragon_s_keep__part_2_".
const UNSAFE_FILENAME_CHARS = /[\\/:*?"<>|\u0000-\u001f]/g;
const FILENAME_TITLE_LIMIT = 60;

export function sanitizeFilenameTitle(title) {
  return String(title ?? '')
    // Whitespace first, so a tab becomes the underscore between two words rather than being
    // stripped as a control character and joining them.
    .replace(/\s+/g, '_')
    .replace(UNSAFE_FILENAME_CHARS, '')
    .replace(/^[.\-_]+/, '')
    .slice(0, FILENAME_TITLE_LIMIT)
    // A cut at the limit can land mid-word and leave a dangling separator.
    .replace(/[.\-_]+$/, '')
    .toLowerCase();
}

// Export instant for a filename: UTC on a 24-hour clock, as 2026-10-21_2348.
// No colon, because Windows forbids it in filenames outright and macOS has historically
// treated it as a path separator, so the download would be mangled by the reader's own OS.
// No trailing Z either — it is jargon to almost everyone who will see this file.
export function filenameTimestamp(date) {
  const iso = new Date(date).toISOString();
  return `${iso.slice(0, 10)}_${iso.slice(11, 13)}${iso.slice(14, 16)}`;
}

/**
 * The one filename both exports use:
 *   storybot<visible story number>_<title>[_<part>]_<date>_<time>.<ext>
 * The number is guild_story_id, the "#3" shown in the UI — not the internal story_id, which
 * matches nothing a reader can see. The timestamp exists because exporting the same story
 * twice otherwise leaves "(1)" and "(2)" in a downloads folder with nothing to tell apart.
 *
 * @param {{ guildStoryId: number|string, title: string, part?: string|null, exportedAt: Date, ext: string }} opts
 */
export function buildExportFilename({ guildStoryId, title, part = null, exportedAt, ext }) {
  const pieces = [`storybot${guildStoryId}`, sanitizeFilenameTitle(title)];
  if (part) pieces.push(part);
  pieces.push(filenameTimestamp(exportedAt));
  return `${pieces.filter(Boolean).join('_')}.${ext}`;
}
