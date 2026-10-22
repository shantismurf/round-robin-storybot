import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { splitStoryFile, planStoryImport, movedEntryIds } from '../story/_importPlan.js';
import { parseEntryDelimiter, parseExportStamp, buildEntryDelimiter, buildExportStamp } from '../story/_exportText.js';
import { ENTRY_STATUS } from '../constants.js';

const split = text => splitStoryFile(text, parseEntryDelimiter, parseExportStamp);

const AT = new Date('2026-10-22T04:00:00.000Z');
const LIMIT = 65000;

// A three-turn story: Maria, Jun, Maria.
const story = () => [
  { entryId: '41', content: 'One.', entryStatus: ENTRY_STATUS.CONFIRMED, writerId: '9', writerName: 'Maria', lastEditedAt: null },
  { entryId: '42', content: 'Two.', entryStatus: ENTRY_STATUS.CONFIRMED, writerId: '12', writerName: 'Jun', lastEditedAt: null },
  { entryId: '43', content: 'Three.', entryStatus: ENTRY_STATUS.CONFIRMED, writerId: '9', writerName: 'Maria', lastEditedAt: null },
];
const writers = () => [{ id: '9', name: 'Maria' }, { id: '12', name: 'Jun' }];

const block = (id, turn, content, writer = 'Maria') => ({
  entryId: String(id), turnNumber: turn, writerName: writer, content,
});
const plan = (blocks, { current = story(), exportedAt = AT } = {}) =>
  planStoryImport({ current, blocks, exportedAt, writers: writers(), contentByteLimit: LIMIT });

const rowFor = (result, id) => result.rows.find(r => r.entryId === String(id));

describe('splitStoryFile', () => {
  const file = [
    'A Test Story (story #3)',
    '3 turn(s), 3 entr(ies) - exported 2026-10-22',
    '',
    '--- HOW TO EDIT THIS FILE ---',
    'Leave the turn lines alone.',
    '--- END ---',
    '',
    buildEntryDelimiter(1, '41', 'Maria'),
    '',
    'One.',
    '',
    buildEntryDelimiter(2, '42', 'Jun'),
    '',
    'Two.',
    '',
    'Still two.',
    '',
    buildExportStamp(AT),
    '',
  ].join('\n');

  test('drops everything before the first turn line', () => {
    const { blocks } = split(file);
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0].content, 'One.');
    assert.ok(!blocks[0].content.includes('HOW TO EDIT'));
  });

  test('keeps a block together across blank lines', () => {
    assert.equal(split(file).blocks[1].content, 'Two.\n\nStill two.');
  });

  test('reads the export instant from the trailer', () => {
    assert.equal(split(file).exportedAt.toISOString(), AT.toISOString());
  });

  test('carries the writer name, which is the reassignment instruction', () => {
    assert.deepEqual(split(file).blocks.map(b => b.writerName), ['Maria', 'Jun']);
  });

  test('a file with no turn lines yields no blocks rather than one big one', () => {
    assert.deepEqual(split('Just prose.\n\nMore prose.').blocks, []);
  });

  test('the trailer is not required', () => {
    const { blocks, exportedAt } = split(`${buildEntryDelimiter(1, '41', 'Maria')}\n\nOne.\n`);
    assert.equal(exportedAt, null);
    assert.equal(blocks[0].content, 'One.');
  });

  // The trailer is read from the end, so a line like it inside the prose stays prose.
  test('a stamp-looking line inside the prose stays in the block', () => {
    const text = `${buildEntryDelimiter(1, '41', 'Maria')}\n\nHe wrote ${buildExportStamp(AT)} on it.\n\n${buildExportStamp(AT)}\n`;
    const { blocks } = split(text);
    assert.ok(blocks[0].content.includes('He wrote'));
    assert.ok(blocks[0].content.endsWith('on it.'));
  });
});

describe('planStoryImport — refusals', () => {
  const kinds = result => result.problems.map(p => p.kind);
  const itemsOf = (result, kind) => result.problems.find(p => p.kind === kind)?.items;

  test('a file with no blocks', () => {
    assert.deepEqual(plan([]), { problems: [{ kind: 'no_blocks', items: [] }] });
  });

  test('an id that is not a turn in this story', () => {
    const result = plan([block(41, 1, 'One.'), block(999, 2, 'Two.', 'Jun')]);
    assert.deepEqual(kinds(result), ['unknown_entry']);
    assert.deepEqual(itemsOf(result, 'unknown_entry'), ['999']);
  });

  test('the same id twice', () => {
    const result = plan([block(41, 1, 'One.'), block(41, 2, 'Again.')]);
    assert.deepEqual(kinds(result), ['duplicate_entry']);
    assert.deepEqual(itemsOf(result, 'duplicate_entry'), ['41']);
  });

  // A name the story does not know is a typo, not an instruction to invent a writer.
  test('a writer name nobody in the story has', () => {
    const result = plan([block(41, 1, 'One.', 'Marai')]);
    assert.deepEqual(kinds(result), ['unknown_writer']);
    assert.deepEqual(itemsOf(result, 'unknown_writer'), ['Marai']);
  });

  // The distinction that matters: emptying a block is not how a turn is removed.
  test('a block emptied of its prose', () => {
    const result = plan([block(41, 1, ''), block(42, 2, 'Two.', 'Jun'), block(43, 3, 'Three.')]);
    assert.deepEqual(kinds(result), ['empty_entry']);
    assert.deepEqual(itemsOf(result, 'empty_entry'), ['1']);
  });

  test('a block too long for the column', () => {
    const result = plan([block(41, 1, 'x'.repeat(LIMIT + 1))]);
    assert.deepEqual(kinds(result), ['entry_too_large']);
  });

  // The point of the report: the editor fixes everything in one pass -- LeeAnn, 2026-10-22.
  test('every problem in the file comes back at once, in one order', () => {
    const result = plan([
      block(999, 1, 'Unknown.'),
      block(41, 2, 'One.'),
      block(41, 3, 'One again.'),
      block(42, 4, '', 'Jun'),
      block(43, 5, 'x'.repeat(LIMIT + 1), 'Marai'),
    ]);
    assert.deepEqual(kinds(result), [
      'unknown_entry', 'duplicate_entry', 'unknown_writer', 'empty_entry', 'entry_too_large',
    ]);
    assert.deepEqual(itemsOf(result, 'empty_entry'), ['4']);
    assert.deepEqual(itemsOf(result, 'entry_too_large'), ['5']);
    assert.deepEqual(itemsOf(result, 'unknown_writer'), ['Marai']);
  });

  test('the same problem twice is listed once per turn, not once per kind', () => {
    const result = plan([block(999, 1, 'One.'), block(998, 2, 'Two.'), block(43, 3, 'Three.')]);
    assert.deepEqual(itemsOf(result, 'unknown_entry'), ['999', '998']);
  });

  // A turn id repeated three times is one thing to fix, so it is named once.
  test('a repeated id is named once', () => {
    const result = plan([block(41, 1, 'One.'), block(41, 2, 'Again.'), block(41, 3, 'And again.')]);
    assert.deepEqual(itemsOf(result, 'duplicate_entry'), ['41']);
  });
});

describe('planStoryImport — content', () => {
  test('an unchanged file changes nothing', () => {
    const result = plan([block(41, 1, 'One.'), block(42, 2, 'Two.', 'Jun'), block(43, 3, 'Three.')]);
    assert.equal(result.changedCount, 0);
    assert.equal(result.unchangedCount, 3);
  });

  test('an edited block reports both word counts', () => {
    const result = plan([block(41, 1, 'One, revised and longer.'), block(42, 2, 'Two.', 'Jun'), block(43, 3, 'Three.')]);
    const row = rowFor(result, 41);
    assert.equal(row.contentChanged, true);
    assert.equal(row.fromWords, 1);
    assert.equal(row.toWords, 4);
    assert.equal(result.changedCount, 1);
  });

  // The one line in the summary the editor cannot have known about.
  test('an entry edited in Discord after the export is flagged as a conflict', () => {
    const current = story();
    current[0].lastEditedAt = '2026-10-22T05:00:00.000Z';
    const result = plan([block(41, 1, 'Revised.'), block(42, 2, 'Two.', 'Jun'), block(43, 3, 'Three.')], { current });
    assert.equal(rowFor(result, 41).conflict, true);
    assert.equal(result.conflicts, 1);
  });

  test('an edit made before the export is not a conflict', () => {
    const current = story();
    current[0].lastEditedAt = '2026-10-22T03:00:00.000Z';
    assert.equal(rowFor(plan([block(41, 1, 'Revised.')], { current }), 41).conflict, false);
  });

  test('a file with no trailer cannot conflict, and says nothing about it', () => {
    const current = story();
    current[0].lastEditedAt = '2026-10-22T05:00:00.000Z';
    const result = plan([block(41, 1, 'Revised.')], { current, exportedAt: null });
    assert.equal(rowFor(result, 41).conflict, false);
  });
});

describe('planStoryImport — order', () => {
  test('the file order is the new order', () => {
    const result = plan([block(43, 3, 'Three.'), block(41, 1, 'One.'), block(42, 2, 'Two.', 'Jun')]);
    assert.deepEqual(result.order, ['43', '41', '42']);
    assert.equal(rowFor(result, 43).toPosition, 1);
    assert.equal(rowFor(result, 43).fromPosition, 3);
    assert.equal(rowFor(result, 43).moved, true);
    // 41 and 42 were renumbered by 43 arriving in front of them, which is not a move they made:
    // their order relative to each other, and to everything else left, is untouched.
    assert.equal(rowFor(result, 41).moved, false);
    assert.equal(rowFor(result, 42).moved, false);
    assert.equal(result.changedCount, 1); // the one turn the editor moved, and nothing else
  });

  // The whole reason moves are measured relatively: LeeAnn, 2026-10-22, "saying the number of
  // turns changed isn't helpful when they all get reordered".
  test('a turn dragged to the front is one move, not one per turn behind it', () => {
    const ids = ['41', '42', '43', '44', '45', '46'];
    const movedToFront = ['46', '41', '42', '43', '44', '45'];
    assert.deepEqual([...movedEntryIds(ids, movedToFront)], ['46']);
  });

  test('two turns swapped with each other is one move', () => {
    assert.deepEqual([...movedEntryIds(['41', '42', '43'], ['42', '41', '43'])].length, 1);
  });

  test('a file in the story order has no moves in it', () => {
    assert.deepEqual([...movedEntryIds(['41', '42', '43'], ['41', '42', '43'])], []);
  });

  test('a reversed story reports every turn but the one left in place', () => {
    assert.equal(movedEntryIds(['41', '42', '43', '44'], ['44', '43', '42', '41']).size, 3);
  });

  test('ids on only one side are not moves', () => {
    // 42 was removed from the file and 99 is being restored into it: neither is a reorder.
    assert.deepEqual([...movedEntryIds(['41', '42', '43'], ['41', '99', '43'])], []);
  });

  test('turn numbers are recomputed from the file, not read out of it', () => {
    // Every delimiter claims turn 1; the position comes from where the block sits.
    const result = plan([block(42, 1, 'Two.', 'Jun'), block(41, 1, 'One.'), block(43, 1, 'Three.')]);
    assert.equal(rowFor(result, 42).toPosition, 1);
    assert.equal(rowFor(result, 41).toPosition, 2);
    assert.equal(rowFor(result, 43).toPosition, 3);
  });

  // The summary is numbered as the editor's own file numbers each turn, so it is sorted that way
  // too rather than by where things land -- otherwise the numbers shuffle down the page.
  test('the summary reads down the file the editor edited', () => {
    const result = plan([block(43, 3, 'Three.'), block(41, 1, 'One, revised.'), block(42, 2, 'Two.', 'Jun')]);
    const positions = result.rows.map(r => r.fromPosition ?? r.toPosition);
    assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
  });

  // A soft-deleted entry has to stay beside the prose it belongs between, or Restore brings it
  // back at the wrong place.
  test('a deleted entry keeps its place in the sequence', () => {
    const current = [
      ...story().slice(0, 2),
      { entryId: '99', content: 'Cut.', entryStatus: ENTRY_STATUS.DELETED, writerId: '9', writerName: 'Maria', lastEditedAt: null },
      story()[2],
    ];
    const result = plan([block(41, 1, 'One.'), block(42, 2, 'Two.', 'Jun'), block(43, 3, 'Three.')], { current });
    assert.deepEqual(result.order, ['41', '42', '99', '43']);
  });

  test('a deleted entry follows the entry it sat behind when that entry moves', () => {
    const current = [
      ...story().slice(0, 2),
      { entryId: '99', content: 'Cut.', entryStatus: ENTRY_STATUS.DELETED, writerId: '9', writerName: 'Maria', lastEditedAt: null },
      story()[2],
    ];
    const result = plan([block(42, 1, 'Two.', 'Jun'), block(43, 2, 'Three.'), block(41, 3, 'One.')], { current });
    assert.deepEqual(result.order, ['42', '99', '43', '41']);
  });
});

describe('planStoryImport — removal and restoration', () => {
  test('a block the editor deleted removes that turn', () => {
    const result = plan([block(41, 1, 'One.'), block(43, 2, 'Three.')]);
    const row = rowFor(result, 42);
    assert.equal(row.removed, true);
    assert.equal(row.fromPosition, 2);
    assert.equal(row.toPosition, null);
    assert.equal(result.removals, 1);
    // It keeps its slot between the two turns it sat between, which is what makes Restore put
    // it back where it belongs rather than at the end of the story.
    assert.deepEqual(result.order, ['41', '42', '43']);
  });

  test('removals are listed one by one, not counted', () => {
    const result = plan([block(41, 1, 'One.')]);
    assert.equal(result.rows.filter(r => r.removed).length, 2);
    assert.deepEqual(result.rows.filter(r => r.removed).map(r => r.fromPosition), [2, 3]);
  });

  // Symmetric with removal by omission: the file is the story, and this entry is in it.
  test('a block for a deleted entry brings it back', () => {
    const current = story();
    current[1].entryStatus = ENTRY_STATUS.DELETED;
    const result = plan([block(41, 1, 'One.'), block(42, 2, 'Two.', 'Jun'), block(43, 3, 'Three.')], { current });
    assert.equal(rowFor(result, 42).restored, true);
    assert.equal(result.restorations, 1);
  });

  test('an already-deleted entry left out of the file is not reported as a removal', () => {
    const current = story();
    current[1].entryStatus = ENTRY_STATUS.DELETED;
    const result = plan([block(41, 1, 'One.'), block(43, 2, 'Three.')], { current });
    assert.equal(result.removals, 0);
    assert.deepEqual(result.order, ['41', '42', '43']);
  });
});

describe('planStoryImport — writers', () => {
  test('a changed name re-credits the turn', () => {
    const result = plan([block(41, 1, 'One.', 'Jun'), block(42, 2, 'Two.', 'Jun'), block(43, 3, 'Three.')]);
    const row = rowFor(result, 41);
    assert.equal(row.writerFrom, 'Maria');
    assert.equal(row.writerTo, 'Jun');
    assert.equal(row.writerId, '12');
    assert.equal(row.writerFromId, '9');
    assert.equal(row.changed, true);
  });

  // The two differences a word processor introduces on its own must not read as a reassignment.
  test('case and surrounding space are not a reassignment', () => {
    const result = plan([block(41, 1, 'One.', '  maria '), block(42, 2, 'Two.', 'Jun'), block(43, 3, 'Three.')]);
    assert.equal(rowFor(result, 41).writerTo, null);
    assert.equal(result.changedCount, 0);
  });

  // A story with show_authors off exports no names at all, and must still import.
  test('a file with no names in it changes no credits', () => {
    const result = plan([
      { entryId: '41', turnNumber: 1, writerName: null, content: 'One.' },
      { entryId: '42', turnNumber: 2, writerName: null, content: 'Two.' },
      { entryId: '43', turnNumber: 3, writerName: null, content: 'Three.' },
    ]);
    assert.equal(result.changedCount, 0);
    assert.equal(rowFor(result, 41).writerName, 'Maria');
  });
});
