import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitAnnouncement } from '../broadcast.js';

test('splitAnnouncement: no separator gives one part', () => {
  assert.deepEqual(splitAnnouncement('# Title\n\nBody'), ['# Title\n\nBody']);
});

test('splitAnnouncement: cuts at a ===== line and trims each part', () => {
  assert.deepEqual(splitAnnouncement('first\n> quote\n=====\n## second\n'), ['first\n> quote', '## second']);
});

test('splitAnnouncement: separator with blank lines and spaces around it', () => {
  assert.deepEqual(splitAnnouncement('a\n\n  =====  \n\nb'), ['a', 'b']);
});

test('splitAnnouncement: ===== inside a line is not a separator', () => {
  assert.deepEqual(splitAnnouncement('a ===== b'), ['a ===== b']);
});

test('splitAnnouncement: empty parts are dropped, so a stray separator sends no blank embed', () => {
  assert.deepEqual(splitAnnouncement('=====\na\n=====\n=====\n'), ['a']);
  assert.deepEqual(splitAnnouncement('   '), []);
});

