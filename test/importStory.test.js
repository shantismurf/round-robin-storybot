import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildImportSummaryLines, fitSummary, readStoryForImport, IMPORT_STORY_CONFIG_KEYS,
} from '../story/_importStory.js';
import { makeFakeConnection } from './_fakeConnection.js';
import { ENTRY_STATUS } from '../constants.js';

// The drafted values from db/config_files/config_storyadmin.sql, kept literal so a wording
// change there cannot quietly change what these assertions test.
const cfg = {
  txtImportStoryRow: '[turn_number]. [writer_name] — [from_words] to [to_words] words{? ([notes])?}',
  txtImportStoryRowRemoved: '[turn_number]. [writer_name] — [from_words] words{? ([notes])?}',
  txtImportStoryNoteMoved: 'moved to turn [to_position]',
  txtImportStoryNoteWriter: 'now [to_writer]',
  txtImportStoryNoteRemoved: 'removed',
  txtImportStoryNoteRestored: 'restored',
  txtImportStoryNoteConflict: 'edited since you exported it',
  txtImportStoryOverflow: 'The full list is attached.',
};

const row = (over = {}) => ({
  entryId: '41', fromPosition: 1, toPosition: 1, writerName: 'Maria',
  fromWords: 1420, toWords: 1380, contentChanged: true, moved: false, restored: false,
  removed: false, writerTo: null, conflict: false, changed: true, ...over,
});

describe('buildImportSummaryLines', () => {
  test('an edited turn reads as its word counts, with no note', () => {
    assert.deepEqual(buildImportSummaryLines({ rows: [row()] }, cfg), ['1. Maria — 1,420 to 1,380 words']);
  });

  // The line is numbered as the editor's own file numbers it, so the note is the only place the
  // new number appears.
  test('a moved turn is numbered where it was and says where it went', () => {
    const lines = buildImportSummaryLines({ rows: [row({ moved: true, fromPosition: 20, toPosition: 2 })] }, cfg);
    assert.deepEqual(lines, ['20. Maria — 1,420 to 1,380 words (moved to turn 2)']);
  });

  test('a removal reads as removed, on the line where that turn was', () => {
    const lines = buildImportSummaryLines({
      rows: [row({ removed: true, toPosition: null, fromPosition: 4, toWords: 0, contentChanged: false })],
    }, cfg);
    // No "to 0 words" on a turn that is going away -- LeeAnn, 2026-10-22.
    assert.deepEqual(lines, ['4. Maria — 1,420 words (removed)']);
  });

  test('a reassignment names the new writer', () => {
    const lines = buildImportSummaryLines({ rows: [row({ writerTo: 'Jun', writerName: 'Jun' })] }, cfg);
    assert.deepEqual(lines, ['1. Jun — 1,420 to 1,380 words (now Jun)']);
  });

  test('several notes ride one line', () => {
    const lines = buildImportSummaryLines({
      rows: [row({ moved: true, toPosition: 2, writerTo: 'Jun', conflict: true })],
    }, cfg);
    assert.equal(lines[0], '1. Maria — 1,420 to 1,380 words (moved to turn 2, now Jun, edited since you exported it)');
  });

  // Only changed turns are listed: the signal is what moved, and the count of the rest closes
  // the summary.
  test('unchanged turns are not listed', () => {
    const lines = buildImportSummaryLines({
      rows: [row(), row({ entryId: '42', changed: false, contentChanged: false })],
    }, cfg);
    assert.equal(lines.length, 1);
  });
});

describe('fitSummary', () => {
  test('a short list goes inline with nothing attached', () => {
    const { description, overflow } = fitSummary(['a', 'b'], cfg);
    assert.equal(description, 'a\nb');
    assert.equal(overflow, null);
  });

  // About a hundred turns fit an embed description. Past that the editor still sees the start of
  // the list, and the whole thing rides as a file rather than another paginated panel.
  test('a long list keeps what fits and attaches the rest', () => {
    const lines = Array.from({ length: 200 }, (_, i) => `${i + 1}. Maria — 1,420 to 1,380 words`);
    const { description, overflow } = fitSummary(lines, cfg, 400);
    assert.ok(description.length <= 400);
    assert.ok(description.endsWith(cfg.txtImportStoryOverflow));
    assert.equal(overflow, lines.join('\n'));
    assert.ok(description.startsWith('1. Maria'));
  });
});

describe('readStoryForImport', () => {
  test('reads confirmed and deleted rows in reading order, with each entry last edit', async () => {
    const conn = makeFakeConnection([[
      { story_entry_id: 41, content: 'One.', entry_status: ENTRY_STATUS.CONFIRMED, entry_order: 1, story_writer_id: 9, discord_display_name: 'maria_h', pen_name: 'Maria', last_edited_at: null },
      { story_entry_id: 42, content: 'Two.', entry_status: ENTRY_STATUS.DELETED, entry_order: 2, story_writer_id: 12, discord_display_name: 'jun', pen_name: null, last_edited_at: '2026-10-22 04:00:00' },
    ]]);
    const rows = await readStoryForImport(conn, 7);
    assert.deepEqual(rows.map(r => r.entryId), ['41', '42']);
    assert.equal(rows[0].writerName, 'Maria');
    assert.equal(rows[1].writerName, 'jun');
    assert.equal(rows[1].entryStatus, ENTRY_STATUS.DELETED);
    assert.match(conn.calls[0].sql, /ORDER BY se\.entry_order, se\.story_entry_id/);
    assert.deepEqual(conn.calls[0].params, [7, ENTRY_STATUS.CONFIRMED, ENTRY_STATUS.DELETED]);
  });
});

describe('IMPORT_STORY_CONFIG_KEYS', () => {
  test('covers every key the summary renders', () => {
    for (const key of Object.keys(cfg)) {
      assert.ok(IMPORT_STORY_CONFIG_KEYS.includes(key), `missing key: ${key}`);
    }
  });

  test('has no duplicates', () => {
    assert.equal(new Set(IMPORT_STORY_CONFIG_KEYS).size, IMPORT_STORY_CONFIG_KEYS.length);
  });
});
