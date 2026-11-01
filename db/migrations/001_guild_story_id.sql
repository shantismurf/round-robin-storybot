-- Add guild_story_id column to story table and backfill per-guild sequential IDs

ALTER TABLE story ADD COLUMN IF NOT EXISTS guild_story_id INT UNSIGNED NOT NULL DEFAULT 0 AFTER story_id;

-- Backfill: assign sequential IDs per guild in story_id order. Safe to re-run -- it only updates
-- rows still at 0.
--
-- The semicolon this comment used to contain made the migration unrunnable on a fresh install:
-- the runner splits the file on the statement separator before it strips comment text, so
-- "only updates rows where 0)" ended up glued to the front of the UPDATE below. Every existing
-- database has 001 stamped as applied, so nothing ever hit it. Fixed 2026-10-22.
UPDATE story s
JOIN (
  SELECT story_id, ROW_NUMBER() OVER (PARTITION BY guild_id ORDER BY story_id ASC) AS rn
  FROM story
) t ON s.story_id = t.story_id
SET s.guild_story_id = t.rn
WHERE s.guild_story_id = 0;

-- Add unique constraint if it doesn't exist
ALTER TABLE story ADD CONSTRAINT IF NOT EXISTS uq_guild_story UNIQUE (guild_id, guild_story_id);
