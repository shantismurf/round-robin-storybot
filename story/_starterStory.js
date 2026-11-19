/**
 * The starter story: one story the bot creates on a server's first /storyadmin setup save, so a
 * new admin sees a real story in motion instead of having to make a dummy one.
 *
 * A made-up stranger creates it and writes Turn 1, the admin who ran setup joins and gets Turn 2,
 * then the stranger leaves. Slow mode with reminders off, so nothing nags the admin. All the
 * text is config, written by LeeAnn (config_onboarding.sql). See docs/plans/PLAN-starter-story.md.
 *
 * Never duplicated: a per-server config row, cfgStarterStoryId, is claimed before anything is
 * created. It holds the story id once made, or 'pending' when a first attempt could not run, so
 * the next setup save tries again. An admin who deletes the story never gets it back, and
 * servers set up before this shipped have no row and are never given one.
 */
import { getConfigValue, log } from '../utilities.js';
import { CreateStory } from '../storybot.js';
import { STORY_MODE } from '../constants.js';
import { STORY_DEFAULTS } from './_storyDefaults.js';
import { parseGroundRulesText, effectiveGroundRulesText, slugifyGroundRuleLabel } from './_groundRules.js';

export const STARTER_STORY_CONFIG_KEYS = [
  'txtStarterStoryTitle', 'txtStarterStorySummary', 'txtStarterStoryAuthor', 'txtStarterStoryEntry',
  'cfgStarterStoryGroundRules', 'txtGroundRulesDefaultVocabulary',
];

const MARKER_KEY = 'cfgStarterStoryId';
// Internal states of the marker row, never shown to anyone.
export const STARTER_MARKER = Object.freeze({ PENDING: 'pending', CREATING: 'creating' });

/**
 * Which of the wanted Ground Rules (comma-separated slugs, from cfgStarterStoryGroundRules) the
 * server still has. An admin can rename or remove rules in setup, so a wanted rule that is gone
 * is skipped rather than stored as a slug that resolves to nothing.
 */
export function pickStarterGroundRules(wantedCsv, vocabularyRules) {
  const wanted = (wantedCsv ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const have = new Set(vocabularyRules.map((r) => slugifyGroundRuleLabel(r.label)));
  return {
    picked: wanted.filter((slug) => have.has(slug)),
    missing: wanted.filter((slug) => !have.has(slug)),
  };
}

/** The CreateStory input for the starter story: the /story add defaults, slow mode, no reminders. */
export function buildStarterStoryInput(cfg, groundRuleSlugs, penName) {
  return {
    storyTitle: cfg.txtStarterStoryTitle,
    mode: STORY_MODE.SLOW,
    hideTurnThreads: STORY_DEFAULTS.storyTurnPrivacy,
    turnLength: STORY_DEFAULTS.turnLength,
    timeoutReminder: 0,
    penName,
    keepPrivate: STORY_DEFAULTS.keepPrivate,
    notificationPrefs: STORY_DEFAULTS.notifications ? 'dm' : 'mention',
    delayHours: null,
    delayWriters: null,
    orderType: STORY_DEFAULTS.orderType,
    showAuthors: STORY_DEFAULTS.showAuthors,
    maxWriters: STORY_DEFAULTS.maxWriters,
    rating: STORY_DEFAULTS.rating,
    summary: cfg.txtStarterStorySummary || null,
    groundRules: groundRuleSlugs.length ? groundRuleSlugs.join(',') : null,
  };
}

/**
 * Claims the right to create this server's starter story. On a first setup the marker row is
 * inserted. On any later save the only claim is a 'pending' row left by a first attempt that
 * could not run. Either way the claim is one atomic statement, so a double-click cannot create
 * two stories. Returns true when the caller owns the claim.
 */
export async function claimStarterStory(connection, guildId, isFirstSetup) {
  if (isFirstSetup) {
    const [inserted] = await connection.execute(
      `INSERT IGNORE INTO config (config_key, config_value, language_code, guild_id) VALUES (?, ?, 'en', ?)`,
      [MARKER_KEY, STARTER_MARKER.CREATING, guildId]
    );
    if (inserted.affectedRows === 1) return true;
  }
  const [updated] = await connection.execute(
    `UPDATE config SET config_value = ? WHERE config_key = ? AND guild_id = ? AND config_value = ?`,
    [STARTER_MARKER.CREATING, MARKER_KEY, guildId, STARTER_MARKER.PENDING]
  );
  return updated.affectedRows === 1;
}

async function setMarker(connection, guildId, value) {
  await connection.execute(
    `UPDATE config SET config_value = ? WHERE config_key = ? AND guild_id = ?`,
    [String(value), MARKER_KEY, guildId]
  );
}

/**
 * Called from handleSetupSave once the setup summary has been sent. Never throws: setup is
 * already saved, and a starter story that fails is logged (and retried on the next save) rather
 * than turned into a setup error.
 */
export async function maybeCreateStarterStory(connection, interaction, { isFirstSetup, feedPermsOk }) {
  const guildId = interaction.guild.id;
  const guildName = interaction.guild.name;
  try {
    const claimed = await claimStarterStory(connection, guildId, isFirstSetup);
    if (!claimed) {
      log(`maybeCreateStarterStory: no starter story for guild ${guildId} (first setup: ${isFirstSetup}, no pending attempt)`, { show: false, guildName });
      return;
    }

    if (!feedPermsOk) {
      await setMarker(connection, guildId, STARTER_MARKER.PENDING);
      log(`maybeCreateStarterStory: starter story not created for guild ${guildId} by ${interaction.user.tag}: bot is missing permissions on the feed channel. Marked pending for the next setup save.`, { show: true, guildName });
      return;
    }

    const cfg = await getConfigValue(connection, STARTER_STORY_CONFIG_KEYS, guildId);
    const missingKeys = STARTER_STORY_CONFIG_KEYS.filter((k) => cfg[k] === k);
    if (missingKeys.length) {
      await setMarker(connection, guildId, STARTER_MARKER.PENDING);
      log(`maybeCreateStarterStory failed for guild ${guildId}: config not found: ${missingKeys.join(', ')}. Marked pending.`, { show: true, guildName });
      return;
    }

    const storedRules = await getConfigValue(connection, 'cfgGroundRules', guildId);
    const vocabulary = parseGroundRulesText(effectiveGroundRulesText(storedRules, cfg.txtGroundRulesDefaultVocabulary));
    const { picked, missing } = pickStarterGroundRules(cfg.cfgStarterStoryGroundRules, vocabulary);
    if (missing.length) {
      log(`maybeCreateStarterStory: Ground Rules not in guild ${guildId}'s rules, skipped: ${missing.join(', ')}`, { show: true, guildName });
    }

    const penName = interaction.member?.displayName || interaction.user.displayName || interaction.user.username;
    const storyInput = buildStarterStoryInput(cfg, picked, penName);
    const result = await CreateStory(connection, interaction, storyInput, {
      starter: { strangerName: cfg.txtStarterStoryAuthor, entryText: cfg.txtStarterStoryEntry },
    });

    if (!result.success) {
      await setMarker(connection, guildId, STARTER_MARKER.PENDING);
      log(`maybeCreateStarterStory failed for guild ${guildId} by ${interaction.user.tag}: CreateStory returned an error. Marked pending.`, { show: true, guildName });
      return;
    }

    await setMarker(connection, guildId, result.storyId);
    log(`maybeCreateStarterStory: starter story ${result.storyId} created for guild ${guildId}, Turn 2 to ${interaction.user.tag}`, { show: true, guildName });
  } catch (error) {
    await setMarker(connection, guildId, STARTER_MARKER.PENDING).catch(() => {});
    log(`maybeCreateStarterStory failed for guild ${guildId} by ${interaction.user?.tag}: ${error?.stack ?? error}`, { show: true, guildName });
  }
}
