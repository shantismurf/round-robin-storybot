/**
 * _importPlan.js — working out what an edited story file would do, before anything is written.
 *
 * Pure functions, no database and no Discord, because this is the part that has to be right: the
 * file is the editor's whole story back from a word processor, and applying it moves prose,
 * renumbers turns, re-credits entries and soft-deletes anything they dropped. Everything here is
 * decided from the file plus a snapshot of the story, so it can be tested exhaustively.
 *
 * Three rules shape it, all from docs/plans/PLAN-copyedit-round-trip.md:
 *
 *  - **The file's order is the story's order.** Reordering is done by moving a whole block, so
 *    the sequence of blocks in the file is the new reading order.
 *  - **The id is the identity.** `#4417` in the delimiter is what a block matches on. The turn
 *    number beside it is a display value that this import recomputes, and a writer name is not
 *    unique.
 *  - **Removal is by omission**, which is why applying needs a confirm. It is a soft delete, so
 *    the entry keeps its slot and Restore brings it back where it was.
 */

import { ENTRY_STATUS } from '../constants.js';

const wordCount = text => String(text ?? '').trim().split(/\s+/).filter(Boolean).length;

// A writer name as a key: case and surrounding space are the two differences a word processor
// introduces on its own, and neither should read as a reassignment.
const writerKey = name => String(name ?? '').trim().toLowerCase();

/**
 * Splits a whole-story file into blocks.
 *
 * Everything before the first delimiter is the header and legend and is dropped — the import
 * reads nothing from it, so an editor who mangles it loses nothing. Lines after the last
 * delimiter belong to the last block, minus the `[[exported-at]]` trailer if it is still there.
 *
 * @param {string} text
 * @param {(line: string) => ({turnNumber: number, entryId: string, writerName: string|null}|null)} parseDelimiter
 * @param {(line: string) => (Date|null)} parseStamp
 * @returns {{ blocks: Array, exportedAt: Date|null }}
 */
export function splitStoryFile(text, parseDelimiter, parseStamp) {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');

  // The trailer is read from the end rather than by scanning, so prose containing a similar
  // line cannot be mistaken for it.
  let last = lines.length - 1;
  while (last >= 0 && lines[last].trim() === '') last -= 1;
  const exportedAt = last >= 0 ? parseStamp(lines[last]) : null;
  const body = exportedAt ? lines.slice(0, last) : lines;

  const blocks = [];
  for (const line of body) {
    const delimiter = parseDelimiter(line);
    if (delimiter) {
      blocks.push({ ...delimiter, lines: [] });
    } else if (blocks.length > 0) {
      blocks[blocks.length - 1].lines.push(line);
    }
  }

  return {
    exportedAt,
    blocks: blocks.map(b => ({
      entryId: String(b.entryId),
      turnNumber: b.turnNumber,
      writerName: b.writerName,
      content: b.lines.join('\n').trim(),
    })),
  };
}

/**
 * Works out what applying a file would do.
 *
 * `current` is the story's ordered rows — confirmed and deleted, in `entry_order` — each
 * `{ entryId, content, entryStatus, writerId, writerName, lastEditedAt }`. `writers` is every
 * writer who could be credited, `{ id, name }`.
 *
 * Returns either `{ error, ...context }` for a file that cannot be applied at all, or a plan:
 * `{ rows, order, removals, restorations, changedCount, unchangedCount }`. `order` is every
 * ordered entry id in its new sequence, which is what the renumber writes.
 *
 * @param {object} args
 * @param {Array} args.current
 * @param {Array} args.blocks
 * @param {Date|null} args.exportedAt
 * @param {Array<{id: string, name: string}>} args.writers
 * @param {number} args.contentByteLimit
 */
export function planStoryImport({ current, blocks, exportedAt, writers, contentByteLimit }) {
  if (!blocks || blocks.length === 0) return { error: 'no_blocks' };

  const byId = new Map(current.map(e => [String(e.entryId), e]));
  const writerByName = new Map(writers.map(w => [writerKey(w.name), w]));

  const seen = new Set();
  for (const block of blocks) {
    if (seen.has(block.entryId)) {
      return { error: 'duplicate_entry', entryId: block.entryId, turnNumber: block.turnNumber };
    }
    seen.add(block.entryId);

    if (!byId.has(block.entryId)) {
      return { error: 'unknown_entry', entryId: block.entryId, turnNumber: block.turnNumber };
    }
    // An emptied block is not how a turn is removed: deleting the whole block is. Saying so is
    // the difference between an accident the editor can fix and one they cannot see.
    if (block.content === '') {
      return { error: 'empty_entry', entryId: block.entryId, turnNumber: block.turnNumber };
    }
    if (Buffer.byteLength(block.content, 'utf8') > contentByteLimit) {
      return { error: 'entry_too_large', entryId: block.entryId, turnNumber: block.turnNumber };
    }
    // A name the story does not know is a typo, not an instruction. Reassignment can only point
    // at a writer who has already joined, so there is nobody to invent.
    if (block.writerName && !writerByName.has(writerKey(block.writerName))) {
      return { error: 'unknown_writer', writerName: block.writerName, turnNumber: block.turnNumber };
    }
  }

  // The new sequence: the file's blocks in file order, then every ordered entry the file does
  // not mention, each put back immediately after the entry that currently precedes it. That is
  // what keeps a soft-deleted entry beside the prose it belongs between, so Restore returns it
  // where it was rather than at the end of the story.
  const order = blocks.map(b => b.entryId);
  const absent = current.map(e => String(e.entryId)).filter(id => !seen.has(id));
  for (const id of absent) {
    const currentIndex = current.findIndex(e => String(e.entryId) === id);
    let anchor = -1;
    for (let i = currentIndex - 1; i >= 0; i -= 1) {
      const candidate = order.indexOf(String(current[i].entryId));
      if (candidate !== -1) { anchor = candidate; break; }
    }
    order.splice(anchor + 1, 0, id);
  }

  // Turn numbers follow display order, so they are counted over what will be confirmed once this
  // is applied: the file's blocks, in file order.
  const turnNumbers = new Map();
  blocks.forEach((block, i) => turnNumbers.set(block.entryId, i + 1));

  // The turn number each entry shows today, for the "moved from" side of the summary.
  const positionsNow = new Map();
  let position = 0;
  for (const entry of current) {
    if (entry.entryStatus === ENTRY_STATUS.CONFIRMED) {
      position += 1;
      positionsNow.set(String(entry.entryId), position);
    }
  }

  const rows = [];

  for (const block of blocks) {
    const entry = byId.get(block.entryId);
    const toPosition = turnNumbers.get(block.entryId);
    const fromPosition = positionsNow.get(block.entryId) ?? null;
    const newWriter = block.writerName ? writerByName.get(writerKey(block.writerName)) : null;

    const contentChanged = block.content !== entry.content;
    const moved = fromPosition !== null && fromPosition !== toPosition;
    const reassigned = !!newWriter && String(newWriter.id) !== String(entry.writerId);
    // A block for an entry that is currently deleted says the editor wants it back: the file is
    // the story, and it is in the file. Symmetric with removal by omission.
    const restored = entry.entryStatus === ENTRY_STATUS.DELETED;

    rows.push({
      entryId: block.entryId,
      fromPosition,
      toPosition,
      writerName: newWriter?.name ?? entry.writerName,
      fromWords: wordCount(entry.content),
      toWords: wordCount(block.content),
      content: block.content,
      previousContent: entry.content,
      contentChanged,
      moved,
      restored,
      removed: false,
      writerFrom: reassigned ? entry.writerName : null,
      writerFromId: reassigned ? entry.writerId : null,
      writerTo: reassigned ? newWriter.name : null,
      writerId: reassigned ? newWriter.id : null,
      // The one line in the summary the editor cannot have known about: this entry was edited
      // in Discord after they took the file away.
      conflict: !!(exportedAt && entry.lastEditedAt && new Date(entry.lastEditedAt) > exportedAt),
      changed: contentChanged || moved || reassigned || restored,
    });
  }

  // Removals, listed one by one rather than counted. A phone editor that eats the tail of a file
  // then arrives as a list of turns the editor recognises, which is alarming in the way a bare
  // "9 removed" is not.
  for (const entry of current) {
    const id = String(entry.entryId);
    if (seen.has(id) || entry.entryStatus !== ENTRY_STATUS.CONFIRMED) continue;
    rows.push({
      entryId: id,
      fromPosition: positionsNow.get(id) ?? null,
      toPosition: null,
      writerName: entry.writerName,
      fromWords: wordCount(entry.content),
      toWords: 0,
      content: null,
      previousContent: entry.content,
      contentChanged: false,
      moved: false,
      restored: false,
      removed: true,
      writerFrom: null,
      writerFromId: null,
      writerTo: null,
      writerId: null,
      conflict: false,
      changed: true,
    });
  }

  // Sorted by where each turn ends up, so the summary reads down the story. A removal has no
  // destination, so it sorts by where it was.
  rows.sort((a, b) => (a.toPosition ?? a.fromPosition ?? 0) - (b.toPosition ?? b.fromPosition ?? 0));

  const changed = rows.filter(r => r.changed);
  return {
    rows,
    order,
    changedCount: changed.length,
    unchangedCount: rows.length - changed.length,
    removals: rows.filter(r => r.removed).length,
    restorations: rows.filter(r => r.restored).length,
    conflicts: rows.filter(r => r.conflict).length,
  };
}
