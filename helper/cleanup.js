/**
 * cleanup.js
 * Deletes config keys from the DB that no longer exist in any config_files SQL file.
 * Safe to run multiple times — only deletes keys explicitly listed below.
 * A listed key that is still declared in a config file is skipped and named, not deleted.
 *
 * Usage: from project root, run: node helper/cleanup.js
 */

import { DB, loadConfig, formattedDate } from '../utilities.js';
import { readConfigFileEntries, findKeysInConfigFiles } from '../sync-config.js';

const ORPHAN_KEYS = [
'lblHideTurnThreads',
'txtHideThreadsOffDesc',
'txtHideThreadsOnDesc',
'lblHideToggle',
'btnAddHideToggle',
'txtHideTurnThreadsValidation',
'txtHideTurnThreadsPlaceholder',
'lblHelp3HideThreads',
'txtHelp3HideThreads',
'lblManageJoinStatus',
'txtDMTurnStart',
'txtMentionTurnStart',
'btnSetTurnLength',
'btnSetTimeout',
'btnSetPenName',
'btnSetDelayHours',
'btnSetDelayWriters',
'btnSetMaxWriters',
'txtDMTurnReminder',
'txtMentionTurnReminder',
'cfgWeeklyRoundupThumbnail',
'btnSetMetadata',
'btnSetupFeed',
'btnSetupMedia',
'btnSetupRestrictedFeed',
'btnSetupRestrictedMedia',
'btnSetupRoundupChannel',
'btnSetupRoundupDay',
'btnSetupRoundupHour',
'txtMyListJoined',
'txtMyListMyStats',
'txtMyListNoTurns',
'txtMyListStoryTotal',
'lblRating',
'lblWarnings',
'lblMainPairing',
'lblOtherRelationships',
'lblCharacters',
'lblDynamic',
// Added 2026-11-27, checked against the code: nothing reads these.
'btnManageUserClose',
'txtSetupModalSaveWarning',
'txtManageEntriesSelectWriter',
'txtManageEntriesFilterModal',
'lblManageEntriesFilterField',
'txtManageEntriesFilterPlaceholder',
'txtManageEntriesNoWriters',
'txtManageEntriesNoMatch',
'txtManageEntriesPreviewTitle',
'txtManageEntriesPreviewFooter',
'txtEditRestoreConfirmSingle',
'txtManageUserPanelDesc',
'txtManageEntriesMoreWriters',
'txtManageEntriesWriterPlaceholder',
'txtManageEntriesContinued',
'lblStatusClosed',
'txtManageWarningSelectInstructions',
'lblHelp2WritingYourTurn',
'lblHelp2WriteTranslations',
'txtHelp2WriteTranslations',
'txtExportUpdatedLabel',
'txtExportLblStarted',
'txtManageSaveWarning',
'lblManageUnsavedChangesTitle',
'txtManageUnsavedChangesBody',
'txtPanelTabHelper',
'lblHelp2SectionBreak',
'txtHelp2SectionBreak'
];

async function main() {
  const config = loadConfig();
  const db = new DB(config.db);
  const connection = await db.connect();

  try {
    const stillInFiles = findKeysInConfigFiles(ORPHAN_KEYS, readConfigFileEntries());
    for (const [key, file] of stillInFiles) {
      console.log(`${formattedDate()}: Skipping ${key}: it is still declared in db/config_files/${file}`);
    }
    const keysToDelete = ORPHAN_KEYS.filter(k => !stillInFiles.has(k));
    if (keysToDelete.length === 0) {
      console.log(`${formattedDate()}: Every listed key is still in a config file — nothing to delete.`);
      return;
    }

    const placeholders = keysToDelete.map(() => '?').join(',');
    const [existing] = await connection.execute(
      `SELECT config_key, guild_id FROM config WHERE config_key IN (${placeholders})`,
      keysToDelete
    );

    if (existing.length === 0) {
      console.log(`${formattedDate()}: No orphan keys found in DB — nothing to delete.`);
      return;
    }

    console.log(`${formattedDate()}: Found ${existing.length} orphan key(s) to delete:`);
    for (const row of existing) {
      console.log(`  - ${row.config_key} (guild ${row.guild_id})`);
    }

    const [result] = await connection.execute(
      `DELETE FROM config WHERE config_key IN (${placeholders})`,
      keysToDelete
    );
    console.log(`${formattedDate()}: Deleted ${result.affectedRows} row(s).`);
  } finally {
    await db.disconnect();
  }
}

main().catch(err => {
  console.error(`${formattedDate()}: Cleanup failed:`, err);
  process.exit(1);
});
