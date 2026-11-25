/**
 * _entryContent.js — the one place entry text is written to the database.
 *
 * Every save of entry text goes through insertEntry() or updateEntryContent(), so its stored
 * word_count (migration 028) can never be missed or go stale. Do not write
 * `INSERT INTO story_entry` or `UPDATE story_entry SET content` anywhere else: a path that does
 * leaves that entry out of every word total in the bot. A change that leaves the text alone
 * (delete, the Restore button, reorder, change writer) does not need to come here, because its
 * count cannot change. See docs/plans/PLAN-stored-word-counts.md.
 *
 * Both write functions take `conn` as either the pool or an open transaction connection, so
 * each caller keeps control of its own transaction, exactly as before.
 *
 * Logging follows the codebase's helper pattern: an optional `guildName` in the options (as in
 * story/_entryChangeLog.js). These functions log what they know (entry, turn, editor). The
 * story and the acting user are in each caller's own action log line.
 */
import { log } from '../utilities.js';
import { ENTRY_STATUS } from '../constants.js';
import { countWords } from './_wordCount.js';

// Logged when text that is not empty counts as 0 words, the one sign the counter itself broke.
function warnIfZero(words, content, where, guildName) {
  if (words === 0 && String(content ?? '').trim().length > 0) {
    log(`${where}: non-empty text (${String(content).length} chars) counted as 0 words — check countWords()`, { show: true, guildName });
  }
}

/**
 * insertEntry — saves a new entry and its word count. Used by finalize, quick mode's first save,
 * and the starter story.
 *
 * @param {object} conn          pool or transaction connection
 * @param {object} args
 * @param {number} args.turnId
 * @param {string} args.content
 * @param {string} args.status   an ENTRY_STATUS value
 * @param {number} [args.entryOrder]  omitted for quick mode's pending row, which gets its order at confirm
 * @param {string} [args.guildName]
 * @returns {Promise<number>} the new story_entry_id
 */
export async function insertEntry(conn, { turnId, content, status, entryOrder = null, guildName = null }) {
  const words = countWords(content);
  warnIfZero(words, content, `insertEntry turn ${turnId}`, guildName);
  try {
    const [result] = entryOrder === null
      ? await conn.execute(
        `INSERT INTO story_entry (turn_id, content, entry_status, word_count, created_at) VALUES (?, ?, ?, ?, NOW())`,
        [turnId, content, status, words]
      )
      : await conn.execute(
        `INSERT INTO story_entry (turn_id, content, entry_status, entry_order, word_count, created_at) VALUES (?, ?, ?, ?, ?, NOW())`,
        [turnId, content, status, entryOrder, words]
      );
    log(`insertEntry: entry ${result.insertId} turn ${turnId} status=${status} order=${entryOrder ?? 'none'} ${content.length} chars, ${words} words`, { show: false, guildName });
    return result.insertId;
  } catch (error) {
    log(`insertEntry failed for turn ${turnId}: ${error?.stack ?? error}`, { show: true, guildName });
    throw error;
  }
}

/**
 * updateEntryContent — saves new text on an existing entry and its word count. Used by edit
 * save, restoring an older version, the file round trip, story import, and quick mode's rewrite
 * after a discard.
 *
 * @param {object} conn          pool or transaction connection
 * @param {number} entryId
 * @param {string} content       the new text
 * @param {object} [opts]
 * @param {{id: string, name: string}} [opts.editor]  when given, the previous text is first
 *        written to story_entry_edit as a history version (every edit path does this)
 * @param {string} [opts.previousContent]  the text being replaced, required with `editor`
 * @param {string} [opts.status]   set the entry's status too (version restore, quick rewrite)
 * @param {boolean} [opts.resetCreatedAt]  quick rewrite only
 * @param {string} [opts.guildName]
 */
export async function updateEntryContent(conn, entryId, content, { editor = null, previousContent = null, status = null, resetCreatedAt = false, guildName = null } = {}) {
  const words = countWords(content);
  warnIfZero(words, content, `updateEntryContent entry ${entryId}`, guildName);
  try {
    if (editor) {
      await conn.execute(
        `INSERT INTO story_entry_edit (entry_id, content, edited_by, edited_by_name) VALUES (?, ?, ?, ?)`,
        [entryId, previousContent, editor.id, editor.name]
      );
    }
    const sets = ['content = ?', 'word_count = ?'];
    const params = [content, words];
    if (status !== null) { sets.push('entry_status = ?'); params.push(status); }
    if (resetCreatedAt) sets.push('created_at = NOW()');
    params.push(entryId);
    await conn.execute(`UPDATE story_entry SET ${sets.join(', ')} WHERE story_entry_id = ?`, params);
    log(`updateEntryContent: entry ${entryId} ${content.length} chars, ${words} words${status !== null ? ` status=${status}` : ''}${editor ? ` — history copy written, editor ${editor.name} (${editor.id})` : ''}`, { show: false, guildName });
  } catch (error) {
    log(`updateEntryContent failed for entry ${entryId}: ${error?.stack ?? error}`, { show: true, guildName });
    throw error;
  }
}

/**
 * getStoryWordCount — a story's word total: the stored counts of its confirmed entries.
 */
export async function getStoryWordCount(conn, storyId, { guildName = null } = {}) {
  const [[row]] = await conn.execute(
    `SELECT COALESCE(SUM(se.word_count), 0) AS words
     FROM story_entry se
     JOIN turn t ON se.turn_id = t.turn_id
     JOIN story_writer sw ON t.story_writer_id = sw.story_writer_id
     WHERE sw.story_id = ? AND se.entry_status = ?`,
    [storyId, ENTRY_STATUS.CONFIRMED]
  );
  const words = Number(row?.words ?? 0);
  log(`getStoryWordCount: story ${storyId} = ${words} words`, { show: false, guildName });
  return words;
}

/** Sum of stored counts over rows that carry word_count (rows from a query that selected it). */
export function sumStoredWords(rows) {
  return rows.reduce((total, r) => total + Number(r.word_count ?? 0), 0);
}

const BACKFILL_BATCH = 500;

/**
 * backfillEntryWordCounts — fills in word_count for entries saved before migration 028 (NULL).
 * Runs on every start, after the bot logs in so its result reaches Hub #logs (startup steps in
 * deploy.js run before login and never do). Does nothing once no NULL rows remain, so it also
 * repairs any row a future bug leaves uncounted.
 */
export async function backfillEntryWordCounts(conn) {
  try {
    const [[{ remaining }]] = await conn.execute(`SELECT COUNT(*) AS remaining FROM story_entry WHERE word_count IS NULL`);
    if (Number(remaining) === 0) {
      log('backfillEntryWordCounts: every entry already has a word count', { show: false });
      return 0;
    }
    let done = 0;
    let left = Number(remaining);
    while (left > 0) {
      const [rows] = await conn.execute(
        `SELECT story_entry_id, content FROM story_entry WHERE word_count IS NULL ORDER BY story_entry_id LIMIT ${BACKFILL_BATCH}`
      );
      if (rows.length === 0) break;
      for (const r of rows) {
        const words = countWords(r.content);
        warnIfZero(words, r.content, `backfillEntryWordCounts entry ${r.story_entry_id}`, null);
        await conn.execute(`UPDATE story_entry SET word_count = ? WHERE story_entry_id = ?`, [words, r.story_entry_id]);
      }
      done += rows.length;
      left -= rows.length;
      log(`backfillEntryWordCounts: counted ${done}, ${Math.max(left, 0)} left`, { show: false });
    }
    log(`backfillEntryWordCounts: filled in word counts for ${done} entries`, { show: true, hub: true });
    return done;
  } catch (error) {
    log(`backfillEntryWordCounts failed: ${error?.stack ?? error}`, { show: true, hub: true });
    return -1;
  }
}
