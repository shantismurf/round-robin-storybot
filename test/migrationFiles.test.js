import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// database-setup.js's runMigrationFile splits a migration file on the statement separator and
// only then strips comment text, so a separator written inside a comment cuts the comment in
// half and leaves its tail glued to the front of the next statement. The result is a syntax
// error at deploy time, on a host with no way to run a migration by hand. CLAUDE.md states the
// rule; this test is what enforces it, because the mistake is invisible on reading.
const MIGRATIONS_DIR = 'db/migrations';

// The same split the runner performs, kept deliberately identical.
const splitStatements = sql => sql
  .split(';')
  .map(s => s.trim())
  .filter(s => s.replace(/--[^\n]*/g, '').trim().length > 0);

const firstCodeWord = statement => statement
  .split('\n')
  .filter(line => !line.trim().startsWith('--'))
  .join(' ')
  .trim()
  .split(/\s+/)[0]
  .toUpperCase();

const SQL_OPENERS = new Set([
  'ALTER', 'CREATE', 'DROP', 'INSERT', 'UPDATE', 'DELETE', 'REPLACE', 'SET', 'RENAME',
  'TRUNCATE', 'WITH', 'SELECT', 'CALL', 'START', 'COMMIT', 'ROLLBACK',
]);

// Nothing is exempt. 001 carried the defect in a parenthetical ("safe to re-run; only updates
// rows where 0") until 2026-10-22 — it is stamped as applied on every existing database, so
// nothing ever hit it, but a fresh install would have. If a migration ever has to be exempted,
// add it here with the reason, and know that the exemption also asserts it is still broken.
const KNOWN_BROKEN = new Set();

const files = fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort();

describe('migration files', () => {
  test('there are migrations to check', () => {
    assert.ok(files.length > 0);
  });

  for (const file of files) {
    test(`${file} splits into statements that each start with SQL`, () => {
      const statements = splitStatements(fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'));
      for (const statement of statements) {
        const opener = firstCodeWord(statement);
        const ok = SQL_OPENERS.has(opener);
        if (KNOWN_BROKEN.has(file)) {
          if (!ok) return; // documented above
          continue;
        }
        assert.ok(ok, `${file}: a statement starts with "${opener}" — likely a semicolon inside a comment`);
      }
      if (KNOWN_BROKEN.has(file)) {
        assert.ok(statements.some(s => !SQL_OPENERS.has(firstCodeWord(s))),
          `${file} is in KNOWN_BROKEN but now looks clean — remove it from the list`);
      }
    });
  }
});
