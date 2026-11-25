-- Migration 028: each entry stores its own word count.
--
-- Totals were counted from every entry's full text on every view (the status post on every
-- refresh), or estimated in SQL by counting spaces where a view covers many stories, so the same
-- story could show different numbers in different places. Now the count is written once, when
-- the text is saved, by story/_entryContent.js, and every total is a SUM of this column.
-- See docs/plans/PLAN-stored-word-counts.md.
--
-- NULL means not counted yet. The counting rules (AO3's, in story/_wordCount.js) live in
-- JavaScript, which this SQL-only runner cannot call, so existing rows are filled in by
-- backfillEntryWordCounts() once the bot has logged in to Discord. It runs on every start and
-- does nothing once no NULL rows are left.
--
-- NOTE no semicolons inside these comments. The migration runner splits the file on the
-- statement separator before it strips comment text.

ALTER TABLE story_entry
  ADD COLUMN IF NOT EXISTS word_count INT NULL;
