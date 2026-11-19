/**
 * Default settings for a new story, shared by the /story add panel and the starter story that
 * the first /storyadmin setup save creates (story/_starterStory.js), so the two cannot drift.
 * Keys are the /story add panel's own state names.
 *
 * Round Robin (2) became the default turn order on 2026-11-19 (LeeAnn). It was Random (1).
 */
import { STORY_MODE } from '../constants.js';

export const STORY_DEFAULTS = Object.freeze({
  storyMode: STORY_MODE.NORMAL,
  storyTurnPrivacy: 0,
  turnLength: 24,
  timeoutReminder: 50,
  keepPrivate: 0,
  notifications: 1,
  delayHours: null,
  delayWriters: null,
  orderType: 2,
  showAuthors: 1,
  maxWriters: null,
  rating: 'NR',
});
