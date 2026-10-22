import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  logEntryReorder,
  logEntryWriterChange,
  listStoryWritersForCredit,
  readEntryWriter,
} from '../story/_entryChangeLog.js';
import { makeFakeConnection } from './_fakeConnection.js';
import { EDIT_CHANGE_TYPE } from '../constants.js';

const editor = { editorId: '111', editorName: 'LeeAnn', guildName: 'Test Guild' };

describe('logEntryReorder', () => {
  test('writes a change row with no content', async () => {
    const conn = makeFakeConnection([{ affectedRows: 1 }]);
    await logEntryReorder(conn, { entryId: 4417, ...editor, from: 5, to: 2 });
    const { sql, params } = conn.calls[0];
    assert.match(sql, /INSERT INTO story_entry_edit/);
    // content NULL is what tells the history panel this row is not a version to restore.
    assert.deepEqual(params, [4417, '111', 'LeeAnn', EDIT_CHANGE_TYPE.REORDER, 5, 2]);
    assert.match(sql, /VALUES \(\?, NULL,/);
  });
});

describe('logEntryWriterChange', () => {
  test('records both sides, as snapshots', async () => {
    const conn = makeFakeConnection([{ affectedRows: 1 }]);
    await logEntryWriterChange(conn, {
      entryId: 4417, ...editor,
      previousWriter: { id: '9', name: 'Maria' },
      newWriter: { id: '12', name: 'Jun' },
    });
    const { sql, params } = conn.calls[0];
    assert.match(sql, /VALUES \(\?, NULL,/);
    assert.deepEqual(params, [4417, '111', 'LeeAnn', EDIT_CHANGE_TYPE.REASSIGN, '9', 'Maria', '12', 'Jun']);
  });

  // A name stored on the row rather than joined at read time: a writer who leaves the story, or
  // renames their pen name, must not rewrite what the history says happened.
  test('survives a missing previous writer', async () => {
    const conn = makeFakeConnection([{ affectedRows: 1 }]);
    await logEntryWriterChange(conn, {
      entryId: 4417, ...editor,
      previousWriter: null,
      newWriter: { id: '12', name: 'Jun' },
    });
    assert.deepEqual(conn.calls[0].params.slice(4), [null, null, '12', 'Jun']);
  });
});

describe('listStoryWritersForCredit', () => {
  test('offers every writer ever joined, not just active ones', async () => {
    const conn = makeFakeConnection([[
      { story_writer_id: 9, discord_display_name: 'maria_h', pen_name: 'Maria' },
      { story_writer_id: 12, discord_display_name: 'jun', pen_name: null },
    ]]);
    assert.deepEqual(await listStoryWritersForCredit(conn, 7), [
      { id: '9', name: 'Maria' },
      { id: '12', name: 'jun' },
    ]);
    // Crediting an entry is not a question of who may write next, so sw_status is not a filter.
    assert.ok(!conn.calls[0].sql.includes('sw_status'));
  });

  test('stays inside Discord 25-option select limit', async () => {
    const conn = makeFakeConnection([[]]);
    await listStoryWritersForCredit(conn, 7);
    assert.match(conn.calls[0].sql, /LIMIT 25/);
  });

  test('drops a writer with no usable name rather than offering a blank option', async () => {
    const conn = makeFakeConnection([[
      { story_writer_id: 9, discord_display_name: null, pen_name: null },
      { story_writer_id: 12, discord_display_name: 'jun', pen_name: null },
    ]]);
    assert.deepEqual(await listStoryWritersForCredit(conn, 7), [{ id: '12', name: 'jun' }]);
  });
});

describe('readEntryWriter', () => {
  test('prefers the pen name, and carries the turn and story along', async () => {
    const conn = makeFakeConnection([[
      { turn_id: 300, story_writer_id: 9, discord_display_name: 'maria_h', pen_name: 'Maria', story_id: 7 },
    ]]);
    assert.deepEqual(await readEntryWriter(conn, 4417), {
      turnId: '300', storyId: 7, id: '9', name: 'Maria',
    });
  });

  test('is null for an entry that does not exist', async () => {
    assert.equal(await readEntryWriter(makeFakeConnection([[]]), 1), null);
  });
});
