import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  entryExportHeader,
  buildSingleEntryExport,
  parseSingleEntryFile,
  readConflictingEdit,
  EDIT_FILE_CONFIG_KEYS,
  ENTRY_CONTENT_BYTE_LIMIT,
} from '../story/_editFileRoundTrip.js';
import { buildEntryDelimiter, buildExportStamp } from '../story/_exportText.js';
import { makeFakeConnection } from './_fakeConnection.js';

const entry = () => ({
  story_entry_id: 4417,
  content: 'The door opened.\n\nNobody was there.',
  guild_story_id: 3,
  title: 'A Test Story',
  show_authors: 1,
  discord_display_name: 'maria_h',
  pen_name: 'Maria',
  turn_number: 12,
});

const AT = new Date('2026-10-22T03:48:17.123Z');

describe('buildSingleEntryExport', () => {
  test('leads with the delimiter and ends with the stamp', () => {
    const text = buildSingleEntryExport(entry(), AT).buffer.toString('utf8');
    const lines = text.split('\n');
    assert.equal(lines[0], '[[turn 12 | #4417 | Maria]]');
    assert.equal(lines.at(-2), '[[exported-at 2026-10-22T03:48:17.123Z]]');
    assert.equal(lines.at(-1), '', 'the file ends with a newline');
  });

  // No header and no legend: the editor is looking at this one turn on the panel they pressed
  // the button on, and the legend is about a file holding a whole story.
  test('carries no story header or legend', () => {
    const text = buildSingleEntryExport(entry(), AT).buffer.toString('utf8');
    assert.ok(!text.includes('HOW TO EDIT THIS FILE'));
    assert.ok(!text.includes('story #3'));
  });

  test('the entry text is verbatim, including its paragraph break', () => {
    const text = buildSingleEntryExport(entry(), AT).buffer.toString('utf8');
    assert.ok(text.includes('The door opened.\n\nNobody was there.'));
  });

  test('the filename names the turn and the export time', () => {
    const { filename } = buildSingleEntryExport(entry(), AT);
    assert.equal(filename, 'storybot3_a_test_story_turn12_2026-10-22_0348.txt');
  });

  // Same rule as the whole-story export: a writer who chose not to be credited is not named in
  // a file that leaves Discord.
  test('a story with authors hidden exports no writer name', () => {
    const text = buildSingleEntryExport({ ...entry(), show_authors: 0 }, AT).buffer.toString('utf8');
    assert.equal(text.split('\n')[0], '[[turn 12 | #4417]]');
  });

  test('reports the word count the download message quotes', () => {
    assert.equal(buildSingleEntryExport(entry(), AT).wordCount, 6);
  });
});

describe('entryExportHeader', () => {
  // Quoted in the import modal and in the mismatch message, so it has to be byte-identical to
  // the file's own first line -- the editor compares the two by eye.
  test('is the file\'s first line, exactly', () => {
    const header = entryExportHeader(entry());
    assert.equal(header, '[[turn 12 | #4417 | Maria]]');
    assert.equal(buildSingleEntryExport(entry(), AT).buffer.toString('utf8').split('\n')[0], header);
  });

  test('carries no writer name when the story hides authors', () => {
    assert.equal(entryExportHeader({ ...entry(), show_authors: 0 }), '[[turn 12 | #4417]]');
  });
});

describe('parseSingleEntryFile', () => {
  const fileFor = (content, { id = 4417, turn = 12, stamp = AT } = {}) =>
    `${buildEntryDelimiter(turn, id, 'Maria')}\n\n${content}\n\n${stamp ? buildExportStamp(stamp) : ''}\n`;

  test('round-trips what the export wrote', () => {
    const exported = buildSingleEntryExport(entry(), AT).buffer.toString('utf8');
    const parsed = parseSingleEntryFile(exported);
    assert.equal(parsed.entryId, '4417');
    assert.equal(parsed.turnNumber, 12);
    assert.equal(parsed.content, 'The door opened.\n\nNobody was there.');
    assert.equal(parsed.exportedAt.toISOString(), AT.toISOString());
  });

  test('keeps paragraph breaks inside the entry', () => {
    const parsed = parseSingleEntryFile(fileFor('One.\n\nTwo.\n\n\nThree.'));
    assert.equal(parsed.content, 'One.\n\nTwo.\n\n\nThree.');
  });

  // A phone or Windows editor will hand back CRLF, and a few will add blank lines at the end.
  test('survives CRLF line endings and trailing blank lines', () => {
    const crlf = fileFor('One.\n\nTwo.').replace(/\n/g, '\r\n') + '\r\n\r\n';
    const parsed = parseSingleEntryFile(crlf);
    assert.equal(parsed.content, 'One.\n\nTwo.');
    assert.equal(parsed.entryId, '4417');
  });

  test('a file with no stamp still parses, with no instant to compare against', () => {
    const parsed = parseSingleEntryFile(fileFor('Edited prose.', { stamp: null }));
    assert.equal(parsed.content, 'Edited prose.');
    assert.equal(parsed.exportedAt, null);
  });

  test('refuses a file whose first line is not a turn line', () => {
    assert.deepEqual(parseSingleEntryFile('Just some prose.\n\nMore prose.'), { error: 'unreadable' });
    assert.deepEqual(parseSingleEntryFile(''), { error: 'unreadable' });
  });

  // The trailer is read from the end, not by scanning, so prose that happens to contain a
  // similar line is not mistaken for it — and such a line stays part of the entry.
  test('a delimiter-looking line inside the prose is left in the content', () => {
    const parsed = parseSingleEntryFile(fileFor('She wrote "[[turn 9 | #11]]" on the board.'));
    assert.equal(parsed.entryId, '4417');
    assert.equal(parsed.content, 'She wrote "[[turn 9 | #11]]" on the board.');
  });

  test('reports the id in the file, whatever entry the panel has open', () => {
    assert.equal(parseSingleEntryFile(fileFor('Prose.', { id: 99, turn: 3 })).entryId, '99');
  });

  test('an emptied file parses as empty content rather than as unreadable', () => {
    assert.equal(parseSingleEntryFile(fileFor('')).content, '');
  });
});

describe('readConflictingEdit', () => {
  test('asks nothing of the database when the file has no stamp', async () => {
    const conn = makeFakeConnection([]);
    assert.equal(await readConflictingEdit(conn, 4417, null), null);
    assert.equal(conn.calls.length, 0);
  });

  test('reports an edit made after the export', async () => {
    const conn = makeFakeConnection([[{ edited_at: '2026-10-22 04:00:00' }]]);
    assert.equal(await readConflictingEdit(conn, 4417, AT), '2026-10-22 04:00:00');
    assert.deepEqual(conn.calls[0].params, [4417, AT]);
  });

  test('is null when nothing was edited since', async () => {
    assert.equal(await readConflictingEdit(makeFakeConnection([[]]), 4417, AT), null);
  });
});

describe('EDIT_FILE_CONFIG_KEYS', () => {
  test('has no duplicates', () => {
    assert.equal(new Set(EDIT_FILE_CONFIG_KEYS).size, EDIT_FILE_CONFIG_KEYS.length);
  });

  // story_entry.content is TEXT: 65,535 bytes. The guard has to stay under it with room for the
  // column's own length prefix, or the database truncates an import instead of refusing it.
  test('the content limit stays inside what TEXT can hold', () => {
    assert.ok(ENTRY_CONTENT_BYTE_LIMIT < 65535);
  });
});
