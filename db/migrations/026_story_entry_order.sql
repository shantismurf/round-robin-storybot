-- Migration 026: story-wide display order for entries.
--
-- Display order was derived entirely from turn.started_at, which is also the honest record of
-- when a turn happened. Those are two different facts. Reordering a story for publication must
-- not rewrite its history, so reading order gets a column of its own and started_at is left
-- alone. See docs/plans/PLAN-copyedit-round-trip.md.
--
-- The column lives on story_entry rather than turn for two reasons. A skipped or timed-out turn
-- produces no entry at all, so order on turn would hand slots to turns that contribute nothing.
-- And migration 021 limits a turn to one confirmed entry, so ordering confirmed entries is the
-- same thing as ordering turns, with no contiguity invariant to maintain.
--
-- The backfill covers confirmed AND deleted rows. A soft-deleted entry keeps its slot so that
-- Restore puts it back where it was, which also means every later renumber has to carry deleted
-- rows. Abandoned quick-mode drafts (pending, discarded) are never part of a story's reading
-- order and keep a NULL.
--
-- ROW_NUMBER() needs MariaDB 10.2 or newer. Safe: commands/story.js already runs DENSE_RANK()
-- against this database in the turn autocomplete.
--
-- NOTE no semicolons inside these comments. The migration runner splits the file on the
-- statement separator before it strips comment text, so one written here would corrupt the
-- statement that follows -- which is why this note does not contain the character it names.

ALTER TABLE story_entry ADD COLUMN IF NOT EXISTS entry_order INT NULL;

UPDATE story_entry se
JOIN (
  SELECT se2.story_entry_id,
         ROW_NUMBER() OVER (
           PARTITION BY sw2.story_id
           ORDER BY t2.started_at, se2.story_entry_id
         ) AS position
  FROM story_entry se2
  JOIN turn t2 ON se2.turn_id = t2.turn_id
  JOIN story_writer sw2 ON t2.story_writer_id = sw2.story_writer_id
  WHERE se2.entry_status IN ('confirmed', 'deleted')
) ranked ON ranked.story_entry_id = se.story_entry_id
SET se.entry_order = ranked.position
WHERE se.entry_order IS NULL;

-- story_entry.order_in_turn was removed from init.sql in April 2026 along with every query that
-- read it, but no migration ever dropped it, so a database created before then is still carrying
-- the column and its index, unused. Both drops are conditional because a database created after
-- April never had either.
--
-- The index is dropped first and explicitly rather than left to the column drop. In MariaDB,
-- dropping a column that is part of a multi-column index removes the column from the index
-- instead of dropping the index, which here would leave a UNIQUE KEY on turn_id alone -- a
-- constraint nobody intended, and one that would stop a turn ever holding a second row.
ALTER TABLE story_entry DROP INDEX IF EXISTS unique_turn_order;

ALTER TABLE story_entry DROP COLUMN IF EXISTS order_in_turn;
