import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  turnNumberSubquery,
  confirmedEntryCountSubquery,
  entryOrderSort,
  nextEntryOrder,
  nextEntryOrderForEntry,
  ORDERED_STATUSES,
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
