import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildEntryFooter } from '../story/_entryRenderer.js';

// Read the real values from config, so these tests fail if the shipped wording drifts from the
// approved examples in docs/plans/PLAN-stored-word-counts.md.
const configSql = readFileSync(new URL('../db/config_files/config_system.sql', import.meta.url), 'utf8');
function configValue(key) {
  const m = configSql.match(new RegExp(`\\('${key}', '((?:[^']|'')*)'`));
  assert.ok(m, `${key} missing from config_system.sql`);
  return m[1].replace(/''/g, "'");
}
const T = { lblEntryFooter: configValue('lblEntryFooter'), lblEntryFooterStory: configValue('lblEntryFooterStory') };

test('buildEntryFooter: /story read, split entry', () => {
  assert.equal(
    buildEntryFooter(T, { turnNumber: 5, writerName: 'Ana', entryWords: 512, part: 2, partCount: 2, page: 14, totalPages: 20, storyWords: 9800 }),
    'Turn 5 · Ana · Entry: part 2 of 2, 512 total words · Story: page 14 of 20, 9,800 total words'
  );
});

test('buildEntryFooter: /story read, entry not split drops the part', () => {
  assert.equal(
    buildEntryFooter(T, { turnNumber: 5, writerName: 'Ana', entryWords: 512, part: 1, partCount: 1, page: 14, totalPages: 20, storyWords: 9800 }),
    'Turn 5 · Ana · Entry: 512 total words · Story: page 14 of 20, 9,800 total words'
  );
});

test('buildEntryFooter: story thread post has the story total but no page', () => {
  assert.equal(
    buildEntryFooter(T, { turnNumber: 5, writerName: 'Ana', entryWords: 512, storyWords: 9800 }),
    'Turn 5 · Ana · Entry: 512 total words · Story: 9,800 total words'
  );
});

test('buildEntryFooter: preview of a long entry has no Story part', () => {
  assert.equal(
    buildEntryFooter(T, { turnNumber: 5, entryWords: 512, part: 1, partCount: 2 }),
    'Turn 5 · Entry: part 1 of 2, 512 total words'
  );
});

test('buildEntryFooter: authors hidden drops only the writer', () => {
  assert.equal(
    buildEntryFooter(T, { turnNumber: 5, writerName: null, entryWords: 512, storyWords: 9800 }),
    'Turn 5 · Entry: 512 total words · Story: 9,800 total words'
  );
});
