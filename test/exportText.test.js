import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateEntriesTextExport,
  buildEntryDelimiter,
  parseEntryDelimiter,
  buildCloseExportRow,
  EXPORT_ROW_CONFIG_KEYS,
  buildExportStamp,
  parseExportStamp,
} from '../story/_exportText.js';
import { makeFakeConnection } from './_fakeConnection.js';
import { STORY_STATUS } from '../constants.js';

// Real values from db/config_files/config_metadata.sql, with \n already converted the way
// sync-config.js:24 converts it when loading.
const CFG = {
  txtExportTextHeader: '[title] (story #[story_num])\n[turn_count] turn(s), [entry_count] entr(ies), [word_count] words - status: [status] - exported [exported]{?\nWriters: [authors]?}',
  txtExportTextLegend: '--- HOW TO EDIT THIS FILE ---\nEach entry begins with a line like [[turn 12 | #4417]].\n  [[break]]          a scene break{? (shows as: [divider])?}\n--- END ---',
  txtOpen: 'Open',
  txtClosed: 'Closed',
};

const story = (over = {}) => ({
  story_id: 7, guild_story_id: 3, title: 'A Test Story', created_at: '2026-01-01T00:00:00Z',
  story_status: STORY_STATUS.CLOSED, mode: 0, closed_at: '2026-02-01T00:00:00Z',
  show_authors: 1, summary: null, tags: null, rating: 'G', warnings: null, main_pairing: null,
  other_relationships: null, characters: null, dynamic: null, scene_break_divider: '* * *',
  ...over,
});

const entry = (id, turn, content, over = {}) => ({
  story_entry_id: id, content, created_at: '2026-01-02T00:00:00Z',
  discord_display_name: 'maria_d', pen_name: 'Maria', turn_number: turn, ...over,
});

// fetchStoryForExport issues story, writers, entries in that order; then the config lookup is
// a fourth execute() against the config table.
const queue = (storyRow, writers, entries, cfg = CFG) => [
  [storyRow],
  writers,
  entries,
  Object.entries(cfg).map(([config_key, config_value]) => ({ config_key, config_value })),
];

describe('buildEntryDelimiter / parseEntryDelimiter', () => {
  test('round-trips turn number and entry id', () => {
    const line = buildEntryDelimiter(12, '4417', 'Maria');
    assert.deepEqual(parseEntryDelimiter(line), { turnNumber: 12, entryId: '4417' });
  });

  test('round-trips with no writer name', () => {
    assert.deepEqual(parseEntryDelimiter(buildEntryDelimiter(1, '9')), { turnNumber: 1, entryId: '9' });
  });

  // The reason turn and id come first and the name goes last.
  test('a pen name containing a pipe cannot shift what is read as the id', () => {
    const line = buildEntryDelimiter(5, '100', 'Maria | the Bold');
    assert.deepEqual(parseEntryDelimiter(line), { turnNumber: 5, entryId: '100' });
  });

  test('a pen name containing brackets or a hash does not break parsing', () => {
    const line = buildEntryDelimiter(5, '100', 'Mar[i]a #2');
    assert.deepEqual(parseEntryDelimiter(line), { turnNumber: 5, entryId: '100' });
  });

  test('tolerates surrounding whitespace, as an edited file will have', () => {
    assert.deepEqual(parseEntryDelimiter('   [[turn 2 | #55]]  '), { turnNumber: 2, entryId: '55' });
  });

  test('returns null for prose, including prose that merely mentions a turn', () => {
    for (const line of ['', 'Just some prose.', '[[break]]', 'turn 2 | #55', '[[turn two | #55]]', 'She took [[turn 2 | #55]] badly.']) {
      assert.equal(parseEntryDelimiter(line), null, `should not parse: ${line}`);
    }
  });
});

describe('generateEntriesTextExport', () => {
  const read = async (...args) => {
    const conn = makeFakeConnection(queue(...args));
    return generateEntriesTextExport(conn, 7, 'guild1');
  };

  test('writes entry content verbatim, with no rendering applied', async () => {
    // Every marker here would be transformed by the HTML export. None may be touched.
    const raw = 'She said *nothing*.\n\n[[break]]\n\n||A secret|| and [[tabi|socks]] and __under__.';
    const result = await read(story(), [{ discord_display_name: 'maria_d', pen_name: 'Maria' }], [entry(41, 1, raw)]);
    const text = result.buffer.toString('utf8');
    assert.ok(text.includes(raw), 'raw content was altered');
    assert.ok(!text.includes('* * *'.repeat(2)), 'divider was substituted into the body');
    assert.ok(!text.includes('<span'), 'markup leaked into the text export');
  });

  test('gives every entry its own delimiter carrying its id', async () => {
    const entries = [entry(41, 1, 'First.'), entry(42, 2, 'Second.')];
    const result = await read(story(), [], entries);
    const text = result.buffer.toString('utf8');
    const found = text.split('\n').map(parseEntryDelimiter).filter(Boolean);
    assert.deepEqual(found, [
      { turnNumber: 1, entryId: '41' },
      { turnNumber: 2, entryId: '42' },
    ]);
  });

  // A turn can hold more than one confirmed entry, which is why the id and not the turn
  // number is what import matches on.
  test('two entries sharing a turn still get distinct, parseable delimiters', async () => {
    const result = await read(story(), [], [entry(41, 3, 'A.'), entry(42, 3, 'B.')]);
    const found = result.buffer.toString('utf8').split('\n').map(parseEntryDelimiter).filter(Boolean);
    assert.deepEqual(found, [
      { turnNumber: 3, entryId: '41' },
      { turnNumber: 3, entryId: '42' },
    ]);
  });

  test('every delimiter in the generated file parses back', async () => {
    const entries = Array.from({ length: 12 }, (_, i) => entry(100 + i, i + 1, `Entry ${i}.`));
    const result = await read(story(), [], entries);
    const found = result.buffer.toString('utf8').split('\n').map(parseEntryDelimiter).filter(Boolean);
    assert.equal(found.length, 12);
    assert.deepEqual(found.map(f => f.entryId), entries.map(e => String(e.story_entry_id)));
  });

  test('honours show_authors, since the file is reachable from the public close post', async () => {
    const shown = await read(story({ show_authors: 1 }), [], [entry(41, 1, 'Text.')]);
    assert.ok(shown.buffer.toString('utf8').includes('Maria'));

    const hidden = await read(story({ show_authors: 0 }), [], [entry(41, 1, 'Text.')]);
    const text = hidden.buffer.toString('utf8');
    assert.ok(!text.includes('Maria'), 'writer name leaked with show_authors off');
    assert.ok(!text.includes('maria_d'), 'discord name leaked with show_authors off');
    // The delimiter must still parse without the name.
    assert.deepEqual(
      text.split('\n').map(parseEntryDelimiter).filter(Boolean),
      [{ turnNumber: 1, entryId: '41' }]
    );
  });

  test('substitutes the story divider into the legend, and drops that clause when unset', async () => {
    const withDivider = await read(story({ scene_break_divider: '* * *' }), [], [entry(41, 1, 'T.')]);
    assert.ok(withDivider.buffer.toString('utf8').includes('(shows as: * * *)'));

    const without = await read(story({ scene_break_divider: null }), [], [entry(41, 1, 'T.')]);
    const text = without.buffer.toString('utf8');
    assert.ok(!text.includes('shows as'), 'optional block was not stripped');
    assert.ok(text.includes('[[break]]'), 'the marker itself should still be listed');
  });

  test('reports counts and a filename, and flags an empty story instead of writing one', async () => {
    const result = await read(story(), [{}, {}], [entry(41, 1, 'one two three'), entry(42, 4, 'four five')]);
    assert.equal(result.hasEntries, true);
    assert.equal(result.entryCount, 2);
    assert.equal(result.turnCount, 4);
    assert.equal(result.wordCount, 5);
    assert.equal(result.writerCount, 2);
    // The visible story number (#3), not the internal story_id (7), and a UTC stamp.
    assert.match(result.filename, /^storybot3_a_test_story_entries_\d{4}-\d{2}-\d{2}_\d{4}\.txt$/);

    const empty = await read(story(), [], []);
    assert.equal(empty.hasEntries, false);
    assert.equal(empty.buffer, null);
    assert.equal(empty.filename, null);
  });

  test('returns null when the story is not in this guild', async () => {
    const conn = makeFakeConnection([[]]);
    assert.equal(await generateEntriesTextExport(conn, 7, 'guild1'), null);
  });

  test('header lists everyone with an entry, in order of their first one, once each', async () => {
    const entries = [
      entry(41, 1, 'T.', { discord_display_name: 'lee_a', pen_name: 'LeeAnn' }),
      entry(42, 2, 'T.', { discord_display_name: 'maria_d', pen_name: null }),
      entry(43, 3, 'T.', { discord_display_name: 'lee_a', pen_name: 'LeeAnn' }),
    ];
    const result = await read(story({ show_authors: 1 }), [], entries);
    // pen_name when set, the Discord display name when not, and no repeat for a second turn.
    assert.ok(result.buffer.toString('utf8').includes('Writers: LeeAnn, maria_d'));
  });

  // The writer list fetchStoryForExport returns is active members only, so it is the wrong
  // source for a header that credits the prose in the file.
  test('credits a writer who has left and leaves out a member who never wrote', async () => {
    const activeWriters = [{ discord_display_name: 'lee_a', pen_name: 'LeeAnn' }];
    const entries = [entry(41, 1, 'T.', { discord_display_name: 'gone_g', pen_name: 'Gwen' })];
    const text = (await read(story({ show_authors: 1 }), activeWriters, entries)).buffer.toString('utf8');
    assert.ok(text.includes('Writers: Gwen'), 'a departed writer with an entry was dropped');
    assert.ok(!text.includes('LeeAnn'), 'a member with no entry was credited');
  });

  test('omits the writers line entirely when show_authors is off', async () => {
    const entries = [entry(41, 1, 'T.', { discord_display_name: 'lee_a', pen_name: 'LeeAnn' })];
    const text = (await read(story({ show_authors: 0 }), [], entries)).buffer.toString('utf8');
    assert.ok(!text.includes('Writers:'), 'the optional header block was not stripped');
    assert.ok(!text.includes('LeeAnn'), 'writer name leaked into the header');
  });

  test('header reflects open vs closed from config, not a hard-coded word', async () => {
    const closed = await read(story({ story_status: STORY_STATUS.CLOSED }), [], [entry(41, 1, 'T.')]);
    assert.ok(closed.buffer.toString('utf8').includes('status: Closed'));

    const open = await read(story({ story_status: STORY_STATUS.ACTIVE }), [], [entry(41, 1, 'T.')]);
    assert.ok(open.buffer.toString('utf8').includes('status: Open'));
  });
});

describe('the export stamp', () => {
  test('round-trips an instant at full precision', () => {
    const when = new Date('2026-10-21T20:54:13.123Z');
    const parsed = parseExportStamp(buildExportStamp(when));
    // Full precision is the point: a date alone cannot tell the importer whether an edit
    // made the same day happened before or after the export.
    assert.equal(parsed.getTime(), when.getTime());
  });

  test('tolerates the surrounding whitespace an edited file will have', () => {
    const when = new Date('2026-01-02T03:04:05.000Z');
    assert.equal(parseExportStamp(`  ${buildExportStamp(when)} `).getTime(), when.getTime());
  });

  test('returns null for anything that is not a stamp', () => {
    for (const line of [
      '', null, undefined, 'Just prose.', '--- END ---',
      '[[turn 2 | #55]]', '[[exported-at]]', '[[exported-at not-a-date]]',
      'She said [[exported-at 2026-10-21T00:00:00Z]] oddly.',
    ]) assert.equal(parseExportStamp(line), null, `should not parse: ${line}`);
  });

  test('the generated file ends with a parseable stamp', async () => {
    const conn = makeFakeConnection(queue(story(), [], [entry(41, 1, 'Text.')]));
    const result = await generateEntriesTextExport(conn, 7, 'guild1');
    const lines = result.buffer.toString('utf8').trimEnd().split('\n');
    const parsed = parseExportStamp(lines[lines.length - 1]);
    assert.ok(parsed instanceof Date, 'last line should be the stamp');
    assert.ok(Date.now() - parsed.getTime() < 60_000, 'stamp should be the export instant');
  });

  test('the human header keeps its plain date, unchanged by the stamp', async () => {
    const conn = makeFakeConnection(queue(story(), [], [entry(41, 1, 'Text.')]));
    const text = (await generateEntriesTextExport(conn, 7, 'guild1')).buffer.toString('utf8');
    // The header's date ends its line, so no trailing character to anchor against.
    assert.match(text, /exported \d{4}-\d{2}-\d{2}$/m, 'header date should stay day-precision');
    assert.ok(!/exported \d{4}-\d{2}-\d{2}T/.test(text), 'header must not gain a time component');
  });
});

describe('buildCloseExportRow', () => {
  const cfg = {
    btnExportNoBreaks: '⬇ Export (no breaks)',
    btnExportWithBreaks: '⬇ Export (breaks with turns and names)',
    btnExportForEditing: '📝 Export Entries for Editing',
  };

  test('offers all three exports, each carrying the story id', () => {
    const row = buildCloseExportRow(cfg, 42).toJSON();
    assert.deepEqual(row.components.map(c => c.custom_id), [
      'story_export_close_noturns_42',
      'story_export_close_withturns_42',
      'story_export_close_entries_42',
    ]);
    assert.ok(row.components.length <= 5, 'row over Discord per-row limit');
  });

  test('every customId still ends in the story id, which the handler parses off the end', () => {
    for (const c of buildCloseExportRow(cfg, 1234).toJSON().components) {
      assert.equal(parseInt(c.custom_id.split('_').at(-1)), 1234);
    }
  });

  test('EXPORT_ROW_CONFIG_KEYS covers every label the row reads', () => {
    for (const key of Object.keys(cfg)) assert.ok(EXPORT_ROW_CONFIG_KEYS.includes(key), `missing ${key}`);
    assert.equal(new Set(EXPORT_ROW_CONFIG_KEYS).size, EXPORT_ROW_CONFIG_KEYS.length);
  });
});
