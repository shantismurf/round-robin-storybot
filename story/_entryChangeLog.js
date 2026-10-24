/**
 * entryChangeLog.js — writing the non-content rows of `story_entry_edit`.
 *
 * The table is a per-entry event log (migration 027): content versions, reorders and writer
 * changes, discriminated by `change_type`. A content version has `change_type` NULL, which is
 * what every row held before 027, so the absence of a value is itself the meaning.
 *
 * Both sides of a change go on the row rather than only the previous value, because the history
 * panel pages one row at a time and has nothing else to render from. The writer names are
 * snapshots for the same reason `edited_by_name` is one: a writer who later leaves, or renames
 * their pen name, must not rewrite what the history says happened.
 *
 * These rows are read-only history. There is no undo — a move or a writer change is set again
 * with the button that set it, so the panel disables Restore on a change row rather than
 * offering a second path to the same operation.
 */

import { EDIT_CHANGE_TYPE } from '../constants.js';
import { log } from '../utilities.js';

/**
 * Record a reorder. Positions are turn numbers as a reader sees them, not raw `entry_order`
 * values, and only the deliberate move is logged: `entry_order` is dense, so moving one entry
 * shifts every entry after it, and a row per shifted entry would bury the real history.
 */
export async function logEntryReorder(connection, { entryId, editorId, editorName, from, to, guildName }) {
  await connection.execute(
    `INSERT INTO story_entry_edit
       (entry_id, content, edited_by, edited_by_name, change_type, previous_position, new_position)
     VALUES (?, NULL, ?, ?, ?, ?, ?)`,
    [entryId, editorId, editorName, EDIT_CHANGE_TYPE.REORDER, from, to]
  );
  log(`logEntryReorder: entry ${entryId} moved from turn ${from} to turn ${to} by ${editorName} (${editorId})`, { show: true, guildName });
}

/**
 * Record a writer change. A row per change rather than one column on `turn`, so a
 * Maria -> Jun -> Maria chain is preserved instead of being swallowed.
 */
export async function logEntryWriterChange(connection, { entryId, editorId, editorName, previousWriter, newWriter, guildName }) {
  await connection.execute(
    `INSERT INTO story_entry_edit
       (entry_id, content, edited_by, edited_by_name, change_type,
        previous_writer_id, previous_writer_name, new_writer_id, new_writer_name)
     VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?)`,
    [
      entryId, editorId, editorName, EDIT_CHANGE_TYPE.REASSIGN,
      previousWriter?.id ?? null, previousWriter?.name ?? null,
      newWriter?.id ?? null, newWriter?.name ?? null,
    ]
  );
  log(`logEntryWriterChange: entry ${entryId} moved from writer ${previousWriter?.name} (${previousWriter?.id}) to ${newWriter?.name} (${newWriter?.id}) by ${editorName} (${editorId})`, { show: true, guildName });
}

/**
 * Every writer ever joined to a story, for the Change Writer picker — any `sw_status`, not just
 * active members. Crediting an entry is not a question of who can write next, and it matches
 * the export header, which credits everyone who has an entry in the work.
 *
 * Capped at Discord's 25-option select limit by default, because the picker is where this is
 * read from. The whole-story import passes `{ limit: null }` for the uncapped list: there a name
 * is matched rather than offered, and a story with more than 25 writers would otherwise refuse
 * its own unedited export, reporting the 26th writer as somebody the story does not have.
 */
export async function listStoryWritersForCredit(connection, storyId, { limit = 25 } = {}) {
  const limitClause = Number.isInteger(limit) && limit > 0 ? `\n     LIMIT ${limit}` : '';
  const [rows] = await connection.execute(
    `SELECT story_writer_id, discord_display_name, pen_name
     FROM story_writer
     WHERE story_id = ?
     ORDER BY COALESCE(pen_name, discord_display_name) ASC${limitClause}`,
    [storyId]
  );
  return rows.map(r => ({
    id: String(r.story_writer_id),
    name: r.pen_name || r.discord_display_name,
  })).filter(w => w.name);
}

/**
 * The writer a turn currently belongs to, as a snapshot for the log's previous side.
 */
export async function readEntryWriter(connection, entryId) {
  const [rows] = await connection.execute(
    `SELECT t.turn_id, sw.story_writer_id, sw.discord_display_name, sw.pen_name, sw.story_id
     FROM story_entry se
     JOIN turn t ON se.turn_id = t.turn_id
     JOIN story_writer sw ON t.story_writer_id = sw.story_writer_id
     WHERE se.story_entry_id = ?`,
    [entryId]
  );
  if (rows.length === 0) return null;
  return {
    turnId: String(rows[0].turn_id),
    storyId: rows[0].story_id,
    id: String(rows[0].story_writer_id),
    name: rows[0].pen_name || rows[0].discord_display_name,
  };
}
