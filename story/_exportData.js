// The one query path both exports use. Its own module rather than living in either export
// file, so story/export.js (HTML, for AO3) and story/_exportText.js (plain text, for editing)
// can share it without importing each other.
import { WRITER_STATUS, ENTRY_STATUS } from '../constants.js';

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
            (SELECT COUNT(DISTINCT t2.turn_id) FROM turn t2
             JOIN story_writer sw2 ON t2.story_writer_id = sw2.story_writer_id
             JOIN story_entry se2 ON se2.turn_id = t2.turn_id AND se2.entry_status = ?
             WHERE sw2.story_id = sw.story_id AND t2.started_at <= t.started_at) as turn_number
     FROM story_entry se
     JOIN turn t ON se.turn_id = t.turn_id
     JOIN story_writer sw ON t.story_writer_id = sw.story_writer_id
     WHERE sw.story_id = ? AND se.entry_status = ?
     ORDER BY t.started_at`,
    [ENTRY_STATUS.CONFIRMED, storyId, ENTRY_STATUS.CONFIRMED]
  );

  return { story: storyRows[0], writers, entries };
}
