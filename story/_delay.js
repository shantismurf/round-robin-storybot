import { getConfigValue, log, replaceTemplateVariables } from '../utilities.js';
import { STORY_STATUS, WRITER_STATUS } from '../constants.js';

/**
 * Checks whether a delayed story's activation conditions are met and activates it.
 * Called from StoryJoin (on writer join) and job-runner (on hour-delay expiry).
 */
export async function checkStoryDelay(connection, storyId) {
  log(`checkStoryDelay: entry storyId=${storyId}`, { show: false });
  try {
    const [storyRows] = await connection.execute(
      `SELECT story_status, story_delay_hours, story_delay_users, created_at, turn_length_hours, guild_id
       FROM story WHERE story_id = ?`,
      [storyId]
    );

    if (storyRows.length === 0) {
      return { madeActive: false };
    }

    const story = storyRows[0];
    let shouldActivate = false;
    let writerDelayMessage = '';
    let hourDelayMessage = '';

    // Check writer count delay
    if (story.story_delay_users && story.story_status !== STORY_STATUS.ACTIVE) {
      const [writerCount] = await connection.execute(
        `SELECT COUNT(*) as count FROM story_writer WHERE story_id = ? AND sw_status = ?`,
        [storyId, WRITER_STATUS.ACTIVE]
      );

      const currentWriters = writerCount[0].count;

      if (currentWriters >= story.story_delay_users) {
        shouldActivate = true;
      } else {
        const needed = story.story_delay_users - currentWriters;
        const txtMoreWritersDelay = await getConfigValue(connection, 'txtMoreWritersDelay', story.guild_id);
        writerDelayMessage = txtMoreWritersDelay.replace('X', needed);
      }
    }

    // Check hour delay
    if (story.story_delay_hours && story.story_status !== STORY_STATUS.ACTIVE) {
      const delayEndTime = new Date(story.created_at.getTime() + (story.story_delay_hours * 60 * 60 * 1000));

      if (Date.now() >= delayEndTime.getTime()) {
        shouldActivate = true;
      } else {
        const hoursLeft = Math.ceil((delayEndTime.getTime() - Date.now()) / (1000 * 60 * 60));
        const txtHoursDelay = await getConfigValue(connection, 'txtHoursDelay', story.guild_id);
        hourDelayMessage = txtHoursDelay.replace('X', hoursLeft);
      }
    }

    // Activate story if conditions met
    if (shouldActivate && story.story_status === STORY_STATUS.DELAYED) {
      await connection.execute(
        `UPDATE story SET story_status = ? WHERE story_id = ?`,
        [STORY_STATUS.ACTIVE, storyId]
      );
      return { madeActive: true };
    }

    return {
      madeActive: false,
      writerDelayMessage,
      hourDelayMessage
    };

  } catch (error) {
    log(`checkStoryDelay failed for story ${storyId}: ${error}`, { show: true });
    return { madeActive: false };
  }
}

/**
 * When a delayed story will start, as the text that follows "Delayed" in the status post's Status
 * box: a relative countdown for an hour delay, the writer target for a writer delay, and both
 * joined with "or" when both are set, since whichever is met first starts the story. Returns ''
 * when there is nothing left to count down to, so the box falls back to a bare "Delayed".
 *
 * The hour countdown is a Discord <t:...:R> timestamp, which renders as "in 21 hours" and ticks
 * down on the reader's side without the post being edited. The writer count refreshes because a
 * join already redraws the status post. Pure, so the status post and its test share one copy.
 *
 * cfg needs txtStatusDelayedStarts, txtStatusDelayWriters and txtOr.
 */
export function formatDelayStatus(story, joinedCount, statusLabel, cfg, now = Date.now()) {
  const conditions = [];
  if (story.story_delay_hours > 0 && story.created_at) {
    const startMs = new Date(story.created_at).getTime() + story.story_delay_hours * 60 * 60 * 1000;
    if (startMs > now) conditions.push(`<t:${Math.floor(startMs / 1000)}:R>`);
  }
  if (story.story_delay_users > 0 && joinedCount < story.story_delay_users) {
    conditions.push(replaceTemplateVariables(cfg.txtStatusDelayWriters, { target: story.story_delay_users, joined: joinedCount }));
  }
  if (!conditions.length) return statusLabel;
  return replaceTemplateVariables(cfg.txtStatusDelayedStarts, { status: statusLabel, conditions: conditions.join(` ${cfg.txtOr} `) });
}
