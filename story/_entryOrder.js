/**
 * entryOrder.js — one definition of a story's reading order.
 *
 * `story_entry.entry_order` (migration 026) carries display order, dense 1..n per story, so a
 * story can be reordered for publication without rewriting `turn.started_at`, which stays the
 * record of when each turn actually happened.
 *
 * Fifteen queries across twelve files used to compute a turn number from `started_at` with
 * their own copy of the same correlated subquery, and five more sorted lists by it. That is how
 * numbering and display order drift apart, so both now come from here.
 *
 * Deleted entries keep their slot. A soft-deleted entry holds its `entry_order` so Restore can
 * put it back where it was without guessing, which means any renumber must carry deleted rows
 * too, and a new entry takes MAX + 1 over every status rather than a count of live ones.
 * Abandoned quick-mode drafts (pending, discarded) never get a value at all.
 */

import { ENTRY_STATUS } from '../constants.js';

/**
 * Display turn number for one entry, as a correlated subquery: how many entries of the same
 * story sit at or before it in `entry_order`. Dense over the statuses the caller counts, so a
 * held slot leaves no hole in the number a reader sees.
 *
 * The caller supplies the status values as bound parameters — one `?` per status, in the same
 * position in its own parameter array. Most callers count confirmed rows only; Manage Entries
 * counts deleted ones too, because it shows a deleted entry in place.
 *
 * @param {{ entry?: string, writer?: string, statusCount?: number }} [opts]
 *   entry       alias of the outer story_entry row (default 'se')
 *   writer      alias of the outer story_writer row (default 'sw')
 *   statusCount how many status placeholders to emit (default 1)
 */
export function turnNumberSubquery({ entry = 'se', writer = 'sw', statusCount = 1 } = {}) {
  const placeholders = Array.from({ length: statusCount }, () => '?').join(', ');
  return `(SELECT COUNT(*)
            FROM story_entry se_num
            JOIN turn t_num ON se_num.turn_id = t_num.turn_id
            JOIN story_writer sw_num ON t_num.story_writer_id = sw_num.story_writer_id
            WHERE sw_num.story_id = ${writer}.story_id
              AND se_num.entry_status IN (${placeholders})
              AND se_num.entry_order <= ${entry}.entry_order)`;
}

/**
 * How many confirmed entries a story already has, as a correlated subquery. Used where the
 * number is wanted for an entry that does not exist yet — finalize computes the number the turn
 * being submitted is about to take, which is simply one past this count.
 *
 * Takes one bound status parameter, like turnNumberSubquery.
 *
 * @param {{ writer?: string }} [opts] writer — alias of the outer story_writer row
 */
export function confirmedEntryCountSubquery({ writer = 'sw' } = {}) {
  return `(SELECT COUNT(*)
            FROM story_entry se_cnt
            JOIN turn t_cnt ON se_cnt.turn_id = t_cnt.turn_id
            JOIN story_writer sw_cnt ON t_cnt.story_writer_id = sw_cnt.story_writer_id
            WHERE sw_cnt.story_id = ${writer}.story_id
              AND se_cnt.entry_status = ?)`;
}

/**
 * Reading-order sort for a list someone looks at. The id is a tiebreaker rather than decoration:
 * an entry confirmed by a path that failed to assign an order would otherwise sort arbitrarily.
 *
 * @param {string} [entry] alias of the story_entry row being sorted
 */
export function entryOrderSort(entry = 'se') {
  return `${entry}.entry_order, ${entry}.story_entry_id`;
}

/**
 * The `entry_order` a newly confirmed entry should take: one past the highest in the story,
 * counting every status, so it can never land on the slot a deleted entry is holding.
 *
 * Call inside the transaction that confirms the entry — these are the same explicit
 * BEGIN/COMMIT blocks every story state change already runs in, so two turns finalizing at once
 * cannot both read the same maximum.
 *
 * @param {object} connection
 * @param {number|string} storyId
 * @returns {Promise<number>}
 */
export async function nextEntryOrder(connection, storyId) {
  const [rows] = await connection.execute(
    `SELECT COALESCE(MAX(se.entry_order), 0) + 1 AS next_order
     FROM story_entry se
     JOIN turn t ON se.turn_id = t.turn_id
     JOIN story_writer sw ON t.story_writer_id = sw.story_writer_id
     WHERE sw.story_id = ?`,
    [storyId]
  );
  return rows[0]?.next_order ?? 1;
}

/**
 * The `entry_order` for the story that owns one entry, found from the entry rather than from a
 * story id the caller may not have. Quick mode confirms by entry id inside its own transaction.
 *
 * @param {object} connection
 * @param {number|string} entryId
 * @returns {Promise<number>}
 */
export async function nextEntryOrderForEntry(connection, entryId) {
  const [rows] = await connection.execute(
    `SELECT COALESCE(MAX(se.entry_order), 0) + 1 AS next_order
     FROM story_entry se
     JOIN turn t ON se.turn_id = t.turn_id
     JOIN story_writer sw ON t.story_writer_id = sw.story_writer_id
     WHERE sw.story_id = (
       SELECT sw_entry.story_id
       FROM story_entry se_entry
       JOIN turn t_entry ON se_entry.turn_id = t_entry.turn_id
       JOIN story_writer sw_entry ON t_entry.story_writer_id = sw_entry.story_writer_id
       WHERE se_entry.story_entry_id = ?
     )`,
    [entryId]
  );
  return rows[0]?.next_order ?? 1;
}

// The statuses that occupy a slot in the reading order: confirmed entries, and deleted ones
// holding their place for a Restore. Exported so a caller counting both does not spell the pair
// out again.
export const ORDERED_STATUSES = Object.freeze([ENTRY_STATUS.CONFIRMED, ENTRY_STATUS.DELETED]);

/**
 * The confirmed entry one turn after this one, or null at the end of the story. Used to offer an
 * admin the next entry to edit without going back to a picker.
 *
 * @returns {Promise<number|null>} that entry's story_entry_id
 */
export async function findNextEntryId(connection, storyId, turnNumber) {
  if (!Number.isInteger(turnNumber)) return null;
  const [rows] = await connection.execute(
    `SELECT se.story_entry_id
     FROM story_entry se
     JOIN turn t ON se.turn_id = t.turn_id
     JOIN story_writer sw ON t.story_writer_id = sw.story_writer_id
     WHERE sw.story_id = ? AND se.entry_status = ?
       AND ${turnNumberSubquery()} = ?`,
    [storyId, ENTRY_STATUS.CONFIRMED, ENTRY_STATUS.CONFIRMED, turnNumber + 1]
  );
  return rows.length > 0 ? rows[0].story_entry_id : null;
}

/**
 * Where one entry sits in its story: its raw `entry_order`, the turn number a reader sees, and
 * how many turns the story has. Position is counted over confirmed rows, so a deleted entry
 * holding a slot does not inflate the numbers anyone is shown.
 *
 * @returns {Promise<null|{ entryOrder: number, position: number, totalPositions: number, storyId: number }>}
 */
export async function readEntryPosition(connection, entryId) {
  const [rows] = await connection.execute(
    `SELECT se.entry_order, sw.story_id,
            ${turnNumberSubquery()} AS position,
            ${confirmedEntryCountSubquery()} AS total_positions
     FROM story_entry se
     JOIN turn t ON se.turn_id = t.turn_id
     JOIN story_writer sw ON t.story_writer_id = sw.story_writer_id
     WHERE se.story_entry_id = ?`,
    [ENTRY_STATUS.CONFIRMED, ENTRY_STATUS.CONFIRMED, entryId]
  );
  if (rows.length === 0) return null;
  return {
    entryOrder: rows[0].entry_order,
    position: rows[0].position,
    totalPositions: rows[0].total_positions,
    storyId: rows[0].story_id,
  };
}

/**
 * Move an entry to the turn number `targetPosition`, renumbering what it displaces.
 *
 * Positions in and out are turn numbers as a reader sees them. Internally the move permutes
 * `entry_order` values, which keeps the sequence dense without a renumber of the whole story,
 * and the shift deliberately covers **every** status: a soft-deleted entry has to travel with
 * its neighbours, or its held slot would collide with a live one the next time anything moved,
 * and Restore could no longer be a plain status flip.
 *
 * Must be called inside a transaction — it issues two or three statements that are only correct
 * together.
 *
 * @returns {Promise<null|{ invalid?: true, unchanged?: true, totalPositions?: number, from?: number, to?: number }>}
 */
export async function moveEntryToPosition(txn, entryId, targetPosition) {
  const current = await readEntryPosition(txn, entryId);
  if (!current) return null;
  const { entryOrder, position, totalPositions, storyId } = current;

  if (!Number.isInteger(targetPosition) || targetPosition < 1 || targetPosition > totalPositions) {
    return { invalid: true, totalPositions };
  }
  if (targetPosition === position) return { unchanged: true, from: position, to: position };

  // The slot to land on is whatever entry_order the confirmed entry at that turn number holds
  // right now. Taking it from the live list rather than computing it keeps this correct however
  // many deleted rows sit in between.
  const [targetRows] = await txn.execute(
    `SELECT se.entry_order
     FROM story_entry se
     JOIN turn t ON se.turn_id = t.turn_id
     JOIN story_writer sw ON t.story_writer_id = sw.story_writer_id
     WHERE sw.story_id = ? AND se.entry_status = ?
     ORDER BY ${entryOrderSort()}
     LIMIT 1 OFFSET ?`,
    [storyId, ENTRY_STATUS.CONFIRMED, targetPosition - 1]
  );
  if (targetRows.length === 0) return { invalid: true, totalPositions };
  const targetOrder = targetRows[0].entry_order;

  // One side of the range shifts to make room. There is deliberately no unique key on
  // entry_order, so the intermediate state these two statements pass through is legal.
  if (targetOrder < entryOrder) {
    await txn.execute(
      `UPDATE story_entry se
       JOIN turn t ON se.turn_id = t.turn_id
       JOIN story_writer sw ON t.story_writer_id = sw.story_writer_id
       SET se.entry_order = se.entry_order + 1
       WHERE sw.story_id = ? AND se.entry_order >= ? AND se.entry_order < ?`,
      [storyId, targetOrder, entryOrder]
    );
  } else {
    await txn.execute(
      `UPDATE story_entry se
       JOIN turn t ON se.turn_id = t.turn_id
       JOIN story_writer sw ON t.story_writer_id = sw.story_writer_id
       SET se.entry_order = se.entry_order - 1
       WHERE sw.story_id = ? AND se.entry_order > ? AND se.entry_order <= ?`,
      [storyId, entryOrder, targetOrder]
    );
  }

  await txn.execute(
    `UPDATE story_entry SET entry_order = ? WHERE story_entry_id = ?`,
    [targetOrder, entryId]
  );

  return { from: position, to: targetPosition };
}
