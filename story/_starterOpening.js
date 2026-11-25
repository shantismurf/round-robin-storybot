/**
 * The starter story's opening, written straight to the DB inside CreateStory's transaction.
 * Kept apart from story/_starterStory.js because storybot.js imports this and _starterStory.js
 * imports storybot.js, and a module cycle between them is not worth having.
 *
 * See docs/plans/PLAN-starter-story.md.
 */
import { TURN_STATUS, ENTRY_STATUS } from '../constants.js';
import { nextEntryOrder } from './_entryOrder.js';
import { insertEntry } from './_entryContent.js';

/**
 * Adds the made-up stranger as the story's first writer and writes its opening entry as Turn 1,
 * already ended. Discord has no made-up users, so the stranger's row uses the bot's own user id
 * under the stranger's name. Returns the stranger's story_writer_id.
 *
 * The turn is written ended rather than started through NextTurn, because a started turn would
 * open a turn thread and send a your-turn notice to the bot's own account.
 */
export async function seedStarterOpening(txn, storyId, botUserId, { strangerName, entryText }) {
  const [writerResult] = await txn.execute(
    `INSERT INTO story_writer (story_id, discord_user_id, discord_display_name, pen_name, turn_privacy, notification_prefs, writer_order)
     VALUES (?, ?, ?, ?, 0, 'mention', 1)`,
    [storyId, botUserId, strangerName, strangerName]
  );
  const writerId = writerResult.insertId;

  const [turnResult] = await txn.execute(
    `INSERT INTO turn (story_writer_id, started_at, ended_at, turn_status) VALUES (?, NOW(), NOW(), ?)`,
    [writerId, TURN_STATUS.ENDED]
  );

  const entryOrder = await nextEntryOrder(txn, storyId);
  await insertEntry(txn, { turnId: turnResult.insertId, content: entryText, status: ENTRY_STATUS.CONFIRMED, entryOrder });

  return writerId;
}
