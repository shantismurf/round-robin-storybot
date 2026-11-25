import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { makeFakeConnection } from './_fakeConnection.js';
import { insertEntry, updateEntryContent, getStoryWordCount, sumStoredWords, backfillEntryWordCounts } from '../story/_entryContent.js';
import { ENTRY_STATUS } from '../constants.js';

describe('insertEntry', () => {
  test('stores the word count with the entry and returns its id', async () => {
    const conn = makeFakeConnection([{ insertId: 900 }]);
    const id = await insertEntry(conn, { turnId: 12, content: 'The dragon slept.', status: ENTRY_STATUS.CONFIRMED, entryOrder: 4 });
    assert.equal(id, 900);
    assert.match(conn.calls[0].sql, /entry_order, word_count/);
    assert.deepEqual(conn.calls[0].params, [12, 'The dragon slept.', ENTRY_STATUS.CONFIRMED, 4, 3]);
  });

  // Quick mode's pending row gets its order at confirm, so the column is left out entirely.
  test('leaves entry_order out when none is given', async () => {
    const conn = makeFakeConnection([{ insertId: 901 }]);
    await insertEntry(conn, { turnId: 12, content: 'one two', status: ENTRY_STATUS.PENDING });
    assert.doesNotMatch(conn.calls[0].sql, /entry_order/);
    assert.deepEqual(conn.calls[0].params, [12, 'one two', ENTRY_STATUS.PENDING, 2]);
  });

  test('rethrows a database failure so the caller can roll back', async () => {
    const conn = { async execute() { throw new Error('boom'); } };
    await assert.rejects(insertEntry(conn, { turnId: 1, content: 'x', status: ENTRY_STATUS.CONFIRMED }), /boom/);
  });
});

describe('updateEntryContent', () => {
  test('writes the old text to history first when an editor is given', async () => {
    const conn = makeFakeConnection([{}, {}]);
    await updateEntryContent(conn, 77, 'new words here', { editor: { id: 'u1', name: 'Ana' }, previousContent: 'old words' });
    assert.match(conn.calls[0].sql, /INSERT INTO story_entry_edit/);
    assert.deepEqual(conn.calls[0].params, [77, 'old words', 'u1', 'Ana']);
    assert.match(conn.calls[1].sql, /SET content = \?, word_count = \? WHERE/);
    assert.deepEqual(conn.calls[1].params, ['new words here', 3, 77]);
  });

  test('without an editor it only updates the entry', async () => {
    const conn = makeFakeConnection([{}]);
    await updateEntryContent(conn, 77, 'one');
    assert.equal(conn.calls.length, 1);
    assert.deepEqual(conn.calls[0].params, ['one', 1, 77]);
  });

  test('quick rewrite sets the status and resets created_at too', async () => {
    const conn = makeFakeConnection([{}]);
    await updateEntryContent(conn, 77, 'a b', { status: ENTRY_STATUS.PENDING, resetCreatedAt: true });
    assert.match(conn.calls[0].sql, /content = \?, word_count = \?, entry_status = \?, created_at = NOW\(\)/);
    assert.deepEqual(conn.calls[0].params, ['a b', 2, ENTRY_STATUS.PENDING, 77]);
  });
});

describe('story totals', () => {
  test('getStoryWordCount sums confirmed entries only', async () => {
    const conn = makeFakeConnection([[{ words: '9800' }]]);
    assert.equal(await getStoryWordCount(conn, 45), 9800);
    assert.deepEqual(conn.calls[0].params, [45, ENTRY_STATUS.CONFIRMED]);
  });

  test('sumStoredWords treats a not-yet-counted row as 0', () => {
    assert.equal(sumStoredWords([{ word_count: 3 }, { word_count: null }, { word_count: '2' }]), 5);
  });
});

describe('backfillEntryWordCounts', () => {
  test('does nothing once every entry has a count', async () => {
    const conn = makeFakeConnection([[{ remaining: 0 }]]);
    assert.equal(await backfillEntryWordCounts(conn), 0);
    assert.equal(conn.calls.length, 1);
  });

  test('counts each uncounted entry and writes it back', async () => {
    const conn = makeFakeConnection([
      [{ remaining: 2 }],
      [{ story_entry_id: 1, content: 'one two' }, { story_entry_id: 2, content: 'three' }],
      {}, {},
    ]);
    assert.equal(await backfillEntryWordCounts(conn), 2);
    assert.deepEqual(conn.calls[2].params, [2, 1]);
    assert.deepEqual(conn.calls[3].params, [1, 2]);
  });

  test('reports a failure as -1 instead of stopping startup', async () => {
    const conn = { async execute() { throw new Error('no column'); } };
    assert.equal(await backfillEntryWordCounts(conn), -1);
  });
});
