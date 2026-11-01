-- Migration 027: story_entry_edit becomes a per-entry event log.
--
-- The table already held content versions. Reordering an entry and changing its writer are
-- changes to the same entry and belong in the same history, so it gains a discriminator and
-- both sides of each change. See docs/plans/completed/PLAN-copyedit-round-trip.md.
--
-- Why both sides on the row rather than only the previous value: the history panel pages one
-- row at a time (LIMIT 1 OFFSET ?), so whatever is on the row is all it has to render with.
-- Storing only the previous writer would mean fetching a neighbour, or the turn itself for the
-- newest row, to show "Maria to Jun".
--
-- Why typed columns rather than a detail JSON like guild_event has: there are three stable
-- change types, the panel reads these rows on every page turn, and mysql2 3.23 changing how it
-- returns MariaDB JSON columns already took out every background job once.
--
-- content becomes nullable because a reorder or a writer change has no content to snapshot.
-- change_type IS NULL means the row is a content version, which is what every existing row is.
-- story/_editHistory.js reads content and writes it back into the entry on Restore, so the
-- discriminator is also what makes Restore refuse a row that holds no content.
--
-- NOTE no semicolons inside these comments. The migration runner splits the file on the
-- statement separator before it strips comment text, so one written here would corrupt the
-- statement that follows -- which is why this note does not contain the character it names.

ALTER TABLE story_entry_edit MODIFY COLUMN content TEXT NULL;

ALTER TABLE story_entry_edit
  ADD COLUMN IF NOT EXISTS change_type ENUM('reorder', 'reassign') NULL;

ALTER TABLE story_entry_edit
  ADD COLUMN IF NOT EXISTS previous_writer_id BIGINT UNSIGNED NULL,
  ADD COLUMN IF NOT EXISTS previous_writer_name VARCHAR(255) NULL,
  ADD COLUMN IF NOT EXISTS new_writer_id BIGINT UNSIGNED NULL,
  ADD COLUMN IF NOT EXISTS new_writer_name VARCHAR(255) NULL;

-- Positions are the turn numbers a reader sees, not raw entry_order values. entry_order is
-- dense, so one deliberate move rewrites the position of every entry after it -- logging each
-- would write a row per shifted entry and bury the real history. One row records the intent.
ALTER TABLE story_entry_edit
  ADD COLUMN IF NOT EXISTS previous_position INT NULL,
  ADD COLUMN IF NOT EXISTS new_position INT NULL;

-- The writer names are snapshots, mirroring edited_by_name: a writer who later leaves, or
-- changes their pen name, must not rewrite what the history says happened.
