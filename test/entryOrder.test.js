import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  turnNumberSubquery,
  confirmedEntryCountSubquery,
  entryOrderSort,
  nextEntryOrder,
  nextEntryOrderForEntry,
  ORDERED_STATUSES,
  readEntryPosition,
  moveEntryToPosition,
} from '../story/_entryOrder.js';
import { makeFakeConnection } from './_fakeConnection.js';
import { ENTRY_STATUS } from '../constants.js';

const placeholders = sql => (sql.match(/\?/g) ?? []).length;

describe('turnNumberSubquery', () => {
  // Every caller binds its status values in its own parameter array, so the number of
  // placeholders the fragment emits has to match what the caller passes — a mismatch shifts
  // every later parameter in the query.
  test('emits one placeholder by default and one per status when asked', () => {
    assert.equal(placeholders(turnNumberSubquery()), 1);
    assert.equal(placeholders(turnNumberSubquery({ statusCount: 1 })), 1);
    assert.equal(placeholders(turnNumberSubquery({ statusCount: 2 })), 2);
  });

  test('counts by entry_order, not by when the turn happened', () => {
    const sql = turnNumberSubquery();
    assert.match(sql, /se_num\.entry_order <= se\.entry_order/);
    assert.ok(!sql.includes('started_at'), 'numbering must not depend on turn chronology');
  });

  test('reads the outer aliases it is given', () => {
    const sql = turnNumberSubquery({ entry: 'e', writer: 'w' });
    assert.match(sql, /sw_num\.story_id = w\.story_id/);
    assert.match(sql, /se_num\.entry_order <= e\.entry_order/);
  });

  // Its own aliases must not collide with the outer query's se/t/sw, or the correlation breaks
  // and the subquery silently counts the wrong rows.
  test('uses aliases of its own', () => {
    const sql = turnNumberSubquery();
    for (const alias of ['se_num', 't_num', 'sw_num']) assert.ok(sql.includes(alias), alias);
    assert.ok(!/\bJOIN turn t\b/.test(sql), 'would shadow the outer turn alias');
  });
});

describe('confirmedEntryCountSubquery', () => {
  test('counts the story without correlating on an entry that does not exist yet', () => {
    const sql = confirmedEntryCountSubquery();
    assert.equal(placeholders(sql), 1);
    assert.match(sql, /sw_cnt\.story_id = sw\.story_id/);
    assert.ok(!sql.includes('entry_order'), 'finalize has no entry row to compare against yet');
  });
});

describe('entryOrderSort', () => {
  test('sorts by order with the id as a tiebreaker', () => {
    assert.equal(entryOrderSort(), 'se.entry_order, se.story_entry_id');
    assert.equal(entryOrderSort('e'), 'e.entry_order, e.story_entry_id');
  });
});

describe('nextEntryOrder', () => {
  test('is one past the highest value in the story', async () => {
    const conn = makeFakeConnection([[{ next_order: 12 }]]);
    assert.equal(await nextEntryOrder(conn, 7), 12);
  });

  // A deleted entry keeps its slot, so the next entry must clear the whole range rather than
  // counting live rows — otherwise it lands on the slot a Restore is waiting to reclaim.
  test('counts every status, not just confirmed rows', async () => {
    const conn = makeFakeConnection([[{ next_order: 1 }]]);
    await nextEntryOrder(conn, 7);
    assert.ok(!conn.calls[0].sql.includes('entry_status'), 'a held slot must still raise the maximum');
  });

  test('starts a story at 1 when it has no entries', async () => {
    const conn = makeFakeConnection([[{ next_order: null }]]);
    assert.equal(await nextEntryOrder(conn, 7), 1);
  });
});

describe('nextEntryOrderForEntry', () => {
  test('finds the story from the entry, for callers that only have an entry id', async () => {
    const conn = makeFakeConnection([[{ next_order: 4 }]]);
    assert.equal(await nextEntryOrderForEntry(conn, 4417), 4);
    assert.match(conn.calls[0].sql, /se_entry\.story_entry_id = \?/);
    assert.deepEqual(conn.calls[0].params, [4417]);
  });
});

describe('ORDERED_STATUSES', () => {
  test('is the pair that occupies a slot in the reading order', () => {
    assert.deepEqual([...ORDERED_STATUSES], [ENTRY_STATUS.CONFIRMED, ENTRY_STATUS.DELETED]);
  });
});

describe('readEntryPosition', () => {
  test('reports the turn number and the story total, not raw entry_order', async () => {
    const conn = makeFakeConnection([[{ entry_order: 9, story_id: 7, position: 5, total_positions: 11 }]]);
    assert.deepEqual(await readEntryPosition(conn, 4417), {
      entryOrder: 9, position: 5, totalPositions: 11, storyId: 7,
    });
    // Two status placeholders (the numbering subquery and the count subquery) then the entry id —
    // a mismatch here would shift the entry id into a status comparison.
    assert.deepEqual(conn.calls[0].params, [ENTRY_STATUS.CONFIRMED, ENTRY_STATUS.CONFIRMED, 4417]);
  });

  test('is null for an entry that does not exist', async () => {
    assert.equal(await readEntryPosition(makeFakeConnection([[]]), 1), null);
  });
});

describe('moveEntryToPosition', () => {
  // readEntryPosition, then the target lookup, then the shift, then the entry's own update.
  const scripted = ({ entryOrder, position, totalPositions, targetOrder }) => makeFakeConnection([
    [{ entry_order: entryOrder, story_id: 7, position, total_positions: totalPositions }],
    targetOrder === undefined ? [] : [{ entry_order: targetOrder }],
    { affectedRows: 1 },
    { affectedRows: 1 },
  ]);

  test('refuses a turn number outside the story', async () => {
    const conn = scripted({ entryOrder: 9, position: 5, totalPositions: 11 });
    assert.deepEqual(await moveEntryToPosition(conn, 4417, 12), { invalid: true, totalPositions: 11 });
    assert.equal(conn.calls.length, 1, 'nothing may be written on an invalid target');
  });

  test('refuses a target that is not a whole number', async () => {
    const conn = scripted({ entryOrder: 9, position: 5, totalPositions: 11 });
    const result = await moveEntryToPosition(conn, 4417, Number.NaN);
    assert.equal(result.invalid, true);
  });

  test('writes nothing when the entry is already at that turn number', async () => {
    const conn = scripted({ entryOrder: 9, position: 5, totalPositions: 11 });
    assert.deepEqual(await moveEntryToPosition(conn, 4417, 5), { unchanged: true, from: 5, to: 5 });
    assert.equal(conn.calls.length, 1);
  });

  // Moving earlier: everything from the target slot up to (not including) the entry's own slot
  // shifts down the page by one, and the entry takes the slot it displaced.
  test('moving earlier shifts the range up by one', async () => {
    const conn = scripted({ entryOrder: 9, position: 5, totalPositions: 11, targetOrder: 3 });
    assert.deepEqual(await moveEntryToPosition(conn, 4417, 2), { from: 5, to: 2 });
    const shift = conn.calls[2];
    assert.match(shift.sql, /entry_order = se\.entry_order \+ 1/);
    assert.match(shift.sql, /entry_order >= \? AND se\.entry_order < \?/);
    assert.deepEqual(shift.params, [7, 3, 9]);
    assert.deepEqual(conn.calls[3].params, [3, 4417]);
  });

  test('moving later shifts the range down by one', async () => {
    const conn = scripted({ entryOrder: 3, position: 2, totalPositions: 11, targetOrder: 9 });
    assert.deepEqual(await moveEntryToPosition(conn, 4417, 5), { from: 2, to: 5 });
    const shift = conn.calls[2];
    assert.match(shift.sql, /entry_order = se\.entry_order - 1/);
    assert.match(shift.sql, /entry_order > \? AND se\.entry_order <= \?/);
    assert.deepEqual(shift.params, [7, 3, 9]);
  });

  // The whole reason the renumber exists: a soft-deleted entry keeps its slot so Restore is a
  // plain status flip. If the shift filtered on entry_status, a held slot would be left behind and
  // would collide with a live one.
  test('the shift carries every status, including deleted entries', async () => {
    const conn = scripted({ entryOrder: 9, position: 5, totalPositions: 11, targetOrder: 3 });
    await moveEntryToPosition(conn, 4417, 2);
    assert.ok(!conn.calls[2].sql.includes('entry_status'), 'a deleted entry must travel with its neighbours');
  });

  // The target slot is read from the live list rather than computed, so it stays correct however
  // many deleted rows sit in between.
  test('takes the target slot from the confirmed list at that offset', async () => {
    const conn = scripted({ entryOrder: 9, position: 5, totalPositions: 11, targetOrder: 3 });
    await moveEntryToPosition(conn, 4417, 2);
    assert.match(conn.calls[1].sql, /LIMIT 1 OFFSET \?/);
    assert.deepEqual(conn.calls[1].params, [7, ENTRY_STATUS.CONFIRMED, 1]);
  });

  test('refuses when the target turn number has no confirmed entry', async () => {
    const conn = scripted({ entryOrder: 9, position: 5, totalPositions: 11 });
    assert.deepEqual(await moveEntryToPosition(conn, 4417, 2), { invalid: true, totalPositions: 11 });
  });

  test('is null for an entry that does not exist', async () => {
    assert.equal(await moveEntryToPosition(makeFakeConnection([[]]), 1, 2), null);
  });
});
