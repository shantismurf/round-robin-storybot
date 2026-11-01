import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildExportFilename,
  sanitizeFilenameTitle,
  filenameTimestamp,
} from '../story/_exportData.js';

const AT = new Date('2026-10-21T23:48:12.345Z');

describe('sanitizeFilenameTitle', () => {
  // The regression this guards: /[^a-z0-9]/ turned ordinary punctuation into underscores, so
  // a title came back unreadable.
  test('keeps punctuation a filesystem does not mind', () => {
    assert.equal(sanitizeFilenameTitle("The Dragon's Keep (Part 2)"), "the_dragon's_keep_(part_2)");
    assert.equal(sanitizeFilenameTitle('Tea, Cake & Murder'), 'tea,_cake_&_murder');
  });

  test('removes the characters that actually break a filename', () => {
    assert.equal(sanitizeFilenameTitle('a/b\\c:d*e?f"g<h>i|j'), 'abcdefghij');
    assert.equal(sanitizeFilenameTitle('tab\there'), 'tab_here');
  });

  test('collapses whitespace runs to one underscore', () => {
    assert.equal(sanitizeFilenameTitle('too   many    spaces'), 'too_many_spaces');
  });

  test('trims leading and trailing separators, including one left by the cut', () => {
    assert.equal(sanitizeFilenameTitle('...leading dots'), 'leading_dots');
    assert.equal(sanitizeFilenameTitle('trailing dots...'), 'trailing_dots');
  });

  test('truncates at 60 characters without an ellipsis', () => {
    const long = 'a'.repeat(80);
    assert.equal(sanitizeFilenameTitle(long).length, 60);
    // A cut landing on a space must not leave the underscore it became.
    const cutOnSpace = `${'b'.repeat(59)} tail`;
    assert.equal(sanitizeFilenameTitle(cutOnSpace), 'b'.repeat(59));
  });

  test('survives an empty or missing title', () => {
    for (const input of ['', null, undefined, '   ']) {
      assert.equal(sanitizeFilenameTitle(input), '');
    }
  });
});

describe('filenameTimestamp', () => {
  test('is UTC, 24-hour, with no colon and no Z', () => {
    assert.equal(filenameTimestamp(AT), '2026-10-21_2348');
  });

  // Windows refuses a colon outright; macOS has historically mapped it to a path separator.
  test('contains nothing a filesystem would refuse', () => {
    assert.ok(!/[\\/:*?"<>|]/.test(filenameTimestamp(AT)));
  });

  test('keeps a 24-hour clock rather than wrapping at noon', () => {
    assert.equal(filenameTimestamp(new Date('2026-01-02T13:05:00Z')), '2026-01-02_1305');
    assert.equal(filenameTimestamp(new Date('2026-01-02T00:00:00Z')), '2026-01-02_0000');
  });
});

describe('buildExportFilename', () => {
  test('uses the visible story number, not the internal id', () => {
    assert.equal(
      buildExportFilename({ guildStoryId: 3, title: 'A Test Story', exportedAt: AT, ext: 'html' }),
      'storybot3_a_test_story_2026-10-21_2348.html'
    );
  });

  test('inserts the part when one is given', () => {
    assert.equal(
      buildExportFilename({ guildStoryId: 3, title: 'A Test Story', part: 'entries', exportedAt: AT, ext: 'txt' }),
      'storybot3_a_test_story_entries_2026-10-21_2348.txt'
    );
    assert.equal(
      buildExportFilename({ guildStoryId: 3, title: 'A Test Story', part: 'turn12', exportedAt: AT, ext: 'txt' }),
      'storybot3_a_test_story_turn12_2026-10-21_2348.txt'
    );
  });

  test('leaves no double underscore when the title sanitizes away entirely', () => {
    assert.equal(
      buildExportFilename({ guildStoryId: 9, title: '///', exportedAt: AT, ext: 'txt' }),
      'storybot9_2026-10-21_2348.txt'
    );
  });

  test('two exports of one story a minute apart do not collide', () => {
    const a = buildExportFilename({ guildStoryId: 3, title: 'T', exportedAt: AT, ext: 'txt' });
    const b = buildExportFilename({ guildStoryId: 3, title: 'T', exportedAt: new Date('2026-10-21T23:49:12Z'), ext: 'txt' });
    assert.notEqual(a, b);
  });
});
