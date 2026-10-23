# Config Files Roadmap & Context Pointers

This project uses context-specific SQL files to manage all user-facing strings.

### INSTRUCTIONS FOR THE AGENT:
1. Use the Roadmap below to identify which file contains the strings relevant to the request.
2. When adding features, first look for common keys that can be reused, but creating unique keys for discreet processes is okay.
3. All user-facing text must be in the config table and approved by the user before finalizing. No hard-coded fallback text.
4. Do NOT guess key names; refer to the "Key Manifest" to verify if a key exists in a specific file.

---
### 📂 SQL Context Roadmap

**Total Unique Entries: ~917** (counts are approximate pending sync-config run; +30 as of
2026-09-24's panel-rework/Ground Rules/Teen-or-Lower-Only work)
1. **config_system.sql** (~91 keys): Core UI, Statuses, system config values. All help page content moved to config_help.sql.
2. **config_help.sql** (116 keys): All help page content. Twelve pages, defined by `PAGE_DEFS` in `faq.js` and addressed by stable id, not number. In reading order: `overview`, `create-general`, `create-join-metadata`, `find-join`, `writing-your-entry`, `reading-editing`, `your-stories`, `managing-a-story`, `writer-commands`, `admin-server-setup`, `admin-story-setup`, `admin-commands`. `/story help` opens the contents menu over all twelve, `/mystory help` jumps to `writer-commands`, `/storyadmin help` to `admin-server-setup`. Also holds the contents-menu intro and the FAQ forum sync status messages. `[hubInviteUrl]` and `[hubSupportChannelId]` are substituted into the intro and into every page body, in `buildPage` — so any help key may carry either, and `txtHelpWritingThreadFeatures` and `txtHelpOverviewFaqIntro` do. `txtHelpOverviewFaqIntro` is the one key rendered only in the Hub FAQ forum, prepended to the Overview post via the page's `faqIntroKey`, because the support channel it mentions exists in no other server. Single source of truth — all help embeds built in `faq.js`. **Key names are historical:** the digit in a key is the page it was created for, not where it renders — after the 2026-10-01 split and reorder, `Help1` keys sit on pages 1 and 4, `Help2` on 5 and 6, and `Help8` on 10, 11 and 12. Keys added since are named for their page instead (`txtHelpOverview*`, `txtHelpFindJoinTitle`, `txtHelpWritingTitle`, `lblHelpWritingThreadFeatures`).
3. **config_story.sql** (~120 keys): /story add, /story list, /story join, /story manage display, /story edit UI, /story close/timeleft.
4. **config_turn.sql** (~145 keys): Writing entries, Reminders, Thread titles, finalize/skip confirmations, story status embed labels.
5. **config_mystory.sql** (~68 keys): /mystory dashboard, Pause/Leave logic, catchup display, list embed (view toggles, per-view titles, turn status, stats), manage panel. Help keys moved to config_help.sql.
6. **config_storyadmin.sql** (~231 keys): Server setup (now two permission tiers), Admin skips/overrides, manage-user actions, turn admin actions. Help and FAQ keys moved to config_help.sql.
7. **config_metadata.sql** (~107 keys): AO3 Ratings, Tags, Warnings, tag submission, Ground Rules.
8. **config_other.sql** (11 keys): Residual cross-cutting error messages and placeholders, plus the shared dirty-state "unsaved changes" warning used by any panel that stages edits behind a Save button (`/story manage`, `/storyadmin setup`).
9. **config_onboarding.sql** (4 keys): DM reminder sequence sent to guild owners who install the bot but never complete `/storyadmin setup` (day 1/7/14/30, see `job-runner.js`'s `onboardingDay*` job types).

---
### 📋 Key Manifest

**FILE: config_system.sql**
SETUP-ONLY KEYS (written programmatically by `syncPrivacyPolicy()` in `privacy-policy.js`, never by sync): cfgPrivacyPolicyMessageId (seeded once via migration 022 with the ID of the already-pinned #rules message; held current afterward by the deploy-time hub post-sync step editing it in place)
KEYS: txtYes, txtNo, txtOn, txtOff, txtNone, txtPublic, txtPrivate, txtOpen, txtClosed, txtActive, txtPaused, txtDelayed, txtNotSet, txtInfinity, txtUnknownWriter, txtPause, txtResume, txtHrs, txtHoursLC, txtHoursUC, txtWritersLC, txtWritersUC, txtQuickLC, txtQuickUC, txtNormalLC, txtNormalUC, txtSlowTC, txtSlowLC, txtNA, txtSlowModeDesc, txtNormalModeWelcome, txtNormalModeWelcomeNoMedia, txtQuickModeTurnStart, txtHoursDelay, txtNormalModeWrite, txtNotYourTurn, btnSubmit, btnDiscard, txtActionFailed, txtNoActiveTurn, btnCancel, txtActionCancelled, txtActionSessionExpired, txtNotActiveWriter, txtNoConfirmedEntries, txtNoActiveStoriesToPause, txtPauseSuccess, txtPauseDM, txtResumeSuccess, txtNotPaused, txtActiveStories, txtPausedStories, txtNoStoriesFound, txtQuickModeValidation, txtNotificationValidation, txtQuickModePlaceholder, btnPrev, btnNext, btnFilter, txtQuickJoinPlaceholder, txtQuickJoinDesc, txtNormalModeDesc, txtQuickModeDesc, txtPrivateOffDesc, txtPrivateOnDesc, txtNormalModeImageHelp, cfgLanguageCode, cfgEntryTimeoutMinutes, cfgValidationErrorDismissSeconds, cfgExportImageMaxBytes, cfgExportImageTotalBytes, cfgExportImageResizeWidth, errProcessingRequest, btnSubmitTag, btnSaveSettings, btnSubmitTagRead, cfgHubServerId, cfgHubInviteUrl, cfgHubFaqChannelId, cfgHubLogChannelId, cfgHubRulesChannelId, cfgFaqThreadOverview, cfgFaqThreadWriterCmds, cfgFaqThreadStoryCreation, cfgFaqThreadManaging, cfgFaqThreadAdminCmds, txtSectionBreakLine, lblPageJumpPlaceholder, lblPageJumpOption, lblPageJumpOptionTurn, lblEntryFooter

**FILE: config_onboarding.sql**
KEYS: txtOnboardingDay1, txtOnboardingDay7, txtOnboardingDay14, txtOnboardingDay30Removal

**FILE: config_help.sql**
KEYS (regenerated from the file 2026-10-02): txtHelpTocTitle, txtHelpTocIntro, txtHelpPageGone, txtHelpTocFooter, txtHelpOverviewHowItWorks, txtHelpOverviewWriting, txtHelpOverviewReading, txtHelpFindJoinTitle, txtHelpWritingTitle, txtHelpOverviewFaqIntro, lblHelpWritingThreadFeatures, txtHelpWritingThreadFeatures, txtHelp1Title, txtHelp1FindJoin, lblHelp1JoiningOptions, lblHelp1TurnThreadPrivacy, txtHelp1TurnThreadPrivacy, lblHelp1Notifications, txtHelp1Notifications, lblHelp1PenName, txtHelp1PenName, txtHelp2Title, lblHelp2Dashboard, txtHelp2Dashboard, lblHelp2ManageParticipation, txtHelp2ManageParticipation, lblHelp2WriteNormal, txtHelp2WriteNormal, lblHelp2WriteQuick, txtHelp2WriteQuick, lblHelp2WriteSlow, txtHelp2WriteSlow, txtHelp3Title, lblHelp3StoryTitle, txtHelp3StoryTitle, lblHelp3StoryMode, txtHelp3StoryMode, lblHelp3WriterOrder, txtHelp3WriterOrder, lblHelp3TurnLength, txtHelp3TurnLength, lblHelp3TimeoutReminder, txtHelp3TimeoutReminder, lblHelp3TurnPrivacy, txtHelp3TurnPrivacy, lblHelp3ShowAuthors, txtHelp3ShowAuthors, lblHelp3MaxWriters, txtHelp3MaxWriters, lblHelp3DelayStart, txtHelp3DelayStart, txtHelp4Title, lblHelp4CreatorOptions, lblHelp4PenName, txtHelp4PenName, lblHelp4HideMyThreads, txtHelp4HideMyThreads, lblHelp4Notifications, txtHelp4Notifications, lblHelp4GroundRules, txtHelp4GroundRules, lblHelp4Metadata, txtHelp4Metadata, txtHelp5Title, lblHelp5WhoCanUse, txtHelp5WhoCanUse, lblHelp5WhatEdit, txtHelp5WhatEdit, lblHelp5Closing, txtHelp5Closing, lblHelp5AdminControls, txtHelp5AdminControls, txtHelp6Title, lblHelp6Read, txtHelp6Read, lblHelp6Export, txtHelp6Export, lblHelp6Edit, txtHelp6Edit, lblHelp6EditPages, txtHelp6EditPages, txtHelp7Title, txtHelp7Footer, lblHelp7StoryCommands, txtHelp7StoryCommands, lblHelp7Dashboard, txtHelp7Dashboard, lblHelp7CreatorCommands, txtHelp7CreatorCommands, txtHelp8Title, txtHelp8Footer, lblHelp8Setup, txtHelp8Setup, lblHelp8SetupChannels, txtHelp8SetupChannels, lblHelp8SetupPermissions, txtHelp8SetupPermissions, txtHelp9Title, lblHelp8GroundRules, txtHelp8GroundRules, lblHelp8RatingsFilter, txtHelp8RatingsFilter, lblHelp8SetupRoundup, txtHelp8SetupRoundup, lblHelp8HubAnnouncements, txtHelp8HubAnnouncements, txtHelp10Title, lblHelp8ManageStory, txtHelp8ManageStory, lblHelp8ManageUser, txtHelp8ManageUser, lblHelp8Delete, txtHelp8Delete, lblHelp8Sweep, txtHelp8Sweep, txtHelpFaqSyncSuccess, txtHelpFaqSyncNoThreads, txtHelpFaqSyncPartial
ADDED 2026-10-22 (editing revamp): lblHelp6Export, txtHelp6Export -- the story-level exports had
no help section at all, so the three export buttons on `/story read` were undocumented. Renders
between Reading a Story and Exporting an Entry on the reading-editing page, because the plain-text
export is the route into editing a long entry. Same pass: txtHelp6Read, txtHelp6Edit and
txtHelp6EditPages replaced with LeeAnn's rewrites, and txtHelp5AdminControls gained a Manage
Entries block between the Manage Turns and Manage Users blocks. Emoji per
reference/help_style_guide.md.
REMOVED 2026-10-01 (help reorder): lblHelp1FindJoin, lblHelp2WritingYourTurn — both were section
headings whose text became the title of the page split out around them, so keeping them rendered
the page title twice. The wording survives as txtHelpFindJoinTitle and txtHelpWritingTitle.
REMOVED 2026-10-02 (Thread Features): lblHelp2WriteTranslations, txtHelp2WriteTranslations,
lblHelp2SectionBreak, txtHelp2SectionBreak — LeeAnn condensed Inline Translations and Section
Break into one section, because both describe markup that works the same way in every mode and
neither was long enough to earn a heading. Their content, rewritten and joined by double-spaced
paragraphs and markdown preservation, is now lblHelpWritingThreadFeatures and
txtHelpWritingThreadFeatures. sync-config never deletes, so all four survive as inert rows in
guilds already deployed — nothing reads them.

**FILE: config_story.sql**
REMOVED IN v3.0.0: btnSetMaxWriters, btnSetTurnLength, btnSetTimeout, btnSetDelayHours, btnSetDelayWriters, btnSetPenName (individual setting buttons replaced by grouped modal openers)
REMOVED IN v3.x: lblHideTurnThreads, txtHideThreadsOffDesc, txtHideThreadsOnDesc, lblHideToggle, btnAddHideToggle (renamed to turnPrivacy wording; toggle buttons replaced by Story Info modal)
REMOVED 2026-08-22 (panel rework plan, Part 1c): txtManageSaveWarning (always-on save reminder,
replaced by the dirty-state-only lblUnsavedChangesTitle/txtUnsavedChangesBody pair — see
config_other.sql; that pair also replaced /storyadmin setup's txtSetupModalSaveWarning on
2026-08-26, see config_storyadmin.sql)
RETIRED KEYS (no longer fetched, 2026-09-03): lblJoinPrivacySelect, lblJoinNotifSelect — these
were a mistaken dual-key split; the modal now reuses the panel's own lblJoinPrivacy/
lblJoinNotifications directly (bracketed emoji, trimmed on the panel via trimTrailingEmoji same
as every other field) instead of carrying a second, drift-prone key.
REMOVED 2026-09-24: txtPanelTabHelper ("Click to Display:", the caption above the tab-toggle
row) — LeeAnn: "'Display XXX' is really not telling me this is a tab of other options." Dropped
rather than reworded; three color-coded buttons read as tabs without a caption. Same pass:
btnPanelTabSettings/btnPanelTabMetadata reworded from "Display Settings"/"Display Metadata" to
"Story Settings"/"Metadata", and the Settings tab split in two — new btnPanelTabStoryInfo
("Story Info") carries Title/Summary + the Info cluster, btnPanelTabSettings now carries only
the Settings cluster + Join Settings. See docs/plans/PLAN-panel-rework-and-ground-rules.md.
ADDED (edit panel, Unreleased): btnEditAddPage appends an empty page to an entry and opens it,
so growing an entry no longer means saving and reopening to force a re-chunk. txtEditModalPageHint
is the per-page guidance inside the edit modal, carried as a LabelBuilder description rather than a
TextInputBuilder placeholder — a placeholder only renders over an empty field and the modal always
pre-fills one, so the hint it replaced was never visible. lblEditEmbedTitle, txtEditEmbedFooter and
lblEditModalTitle were inline template literals in story/edit.js and story/read.js; wording is
unchanged from what shipped. All three use {?...?} optional blocks so the page suffix drops out on a
single-page entry. CHANGED 2026-10-22: btnEditAddPage renders only on an entry's last page, so
txtEditModalPageHint's closing sentence is now an optional block whose [add_label] token (substituted
from btnEditAddPage) is supplied only there -- the wording is unchanged, it just stops pointing at a
button that is not on screen. story/read.js renders the same panel and modal and so reads the same keys via
edit.js's exported EDIT_PANEL_CONFIG_KEYS. See docs/plans/PLAN-copyedit-round-trip.md.
ADDED (single-turn file round trip, Unreleased): the fifteen btnEdit{Export,Import}File /
txtEditImport* keys drive the download-and-upload pair on the edit panel. Declared as
EDIT_FILE_CONFIG_KEYS in story/_editFileRoundTrip.js and spread into EDIT_PANEL_CONFIG_KEYS,
because the two buttons are on every edit panel however it was opened. They were briefly kept out
of that list, which left the panel reached from /story read's Edit button without them -- LeeAnn,
2026-10-22: "the Edit interface should not be rendered differently if accessed from different
places." buildEditMessage no longer takes an option for it, so the panel cannot drift by caller
again.
LeeAnn's wording throughout, approved 2026-10-22, txtEditImportConfirmTitle included -- a
question ("Replace this entry's content?") like the bot's other action confirms, rather than a
repeat of the modal title above it. txtEditImportModalHint was removed on her call: the modal's only text is now
lblEditImportFile ("Attach edited text file") on the field itself, since the export message
already says to keep the first line and txtEditImportError quotes it back if the wrong file
turns up. txtEditImportConflict names the Save button through a [save_label] token fed from
btnAdminConfigSave, the pattern txtUnsavedChangesBody already uses, so the sentence cannot end
up pointing at a button label that changed. txtEditImportError is deliberately one message for
both "that file is another entry's" and "that file has no turn line": the first line is wrong
either way. The confirm's own button reuses btnAdminConfigSave rather than adding a key that
says Save again, and there is no Cancel -- the flow is ephemeral throughout.
See docs/plans/PLAN-copyedit-round-trip.md.

KEYS: lblStoryTitle, lblQuickMode, lblTurnLength, lblTimeoutReminder, txtTimeoutReminderDesc, lblTurnPrivacy, lblNoHours, txtAddValidationDelayHours, lblNoWriters, lblMaxWriters, txtMaxWritersDesc, btnJoinStory, txtAlreadyJoined, txtStoryJoinFail, txtMoreWritersDelay, txtStoryCreated, txtMyStoriesTitle, txtAllStories, txtJoinableStories, txtMyStories, txtStoriesPageTitle, txtStoriesPageDesc, txtMemberStatusCanJoin, txtMemberStatusCanNotJoin, txtMemberStatusJoined, txtStoryListFailed, lblStoryStatus, lblStoryTurn, lblStoryWriters, lblStoryMode, lblStoryCreator, txtModeQuick, txtModeNormal, txtModeSlow, txtTurnWaiting, txtTurnOverdue, txtTurnTimeLeft, txtTurnUnknown, lblJoinPenName, txtJoinEmbedDesc, txtJoinPenNameNotSet, btnJoinSetPenName, btnJoinConfirm, txtJoinSuccess, txtJoinStoryFull, txtJoinNotAllowed, txtJoinStoryClosed, txtJoinFormFailed, txtJoinProcessFailed, txtJoinPrivacyPlaceholder, txtJoinNotificationPlaceholder, txtJoinPenNamePlaceholder, txtCreateStoryTitle, txtStoryAddIntro, txtStoryTitlePrompt, txtTurnPrivacyPublicDesc, txtTurnPrivacyPrivateDesc, txtStoryAddSessionExpired, btnSetTitle, btnAddTitleAndSummary, btnAddStoryInfo, btnAddSettings, btnAddMetadata, btnAddTags, btnAddMySettings, btnCreateStory, btnPanelTabStoryInfo, btnPanelTabSettings, btnPanelTabMetadata, txtStoryManagementLabel, lblModeToggle, lblPrivateToggle, lblDelayStart, txtDelayHint, lblWriterOrder, lblShowAuthors, txtShowAuthorsOnDesc, txtShowAuthorsOffDesc, txtOrderRandom, txtOrderRoundRobin, txtOrderFixed, txtOrderRandomDesc, txtOrderRoundRobinDesc, txtOrderFixedDesc, lblJoinNotifications, txtJoinNotificationsDesc, lblJoinPrivacy, txtJoinPrivacyDesc, txtAddValidationTitleEmpty, txtAddValidationTitleRequired, txtListFilterPrompt, txtStoryAddSectionBreakSettings, txtStoryAddSectionBreakMeta, txtStoryAddSectionBreakJoin, txtStoryAddSectionBreakTags, txtStoryCloseSuccess, lblJoinSetPenNameModalTitle, lblTimeleftStory, lblTimeleftCurrentWriter, lblTimeleftTurnEnds, lblTimeleftUpNext, txtTimeleftAuthorsHidden, lblEditPageSplitNotice, txtEditPageSplitInstructions, btnEditPrev, btnEditNext, btnEditOpen, btnEditHistory, btnEditAddPage, btnEditNextEntry, lblEditEntryContent, txtEditModalPageHint, lblEditEmbedTitle, txtEditEmbedFooter, lblEditModalTitle, txtEditRestoreWarningMulti, txtEditRestoreWarningSingle, btnEditHistNewer, btnEditHistPrevPage, btnEditRestore, btnEditHistNextPage, btnEditHistOlder, btnEditBackToEntry, btnEditBackToList, txtEditRestoreConfirmMulti, txtEditRestoreConfirmTitle, btnEditRestoreConfirm, btnEditRestoreCancel, lblEditMyEntryOption, txtEditMyEntriesSelect, txtEditMyEntriesNone, lblKeepYourPrivate, txtStoryAlreadyClosed, txtStoryFeedJoinAnnouncement, txtStoryFeedJoinAnnouncementNoTurn, txtStoryFeedJoinAnnouncementSlow, txtStoryFeedNowActive, txtStoryFeedNowActiveSlow, txtPrivacyValidation, txtManageStoryStatusActive, txtManageStoryStatusPaused, txtManageJoinOpen, txtManageJoinClosed, lblManageSetTitleField, txtManageMaxWritersPlaceholder, txtManageTagsPlaceholder, txtStoryFeedDepartedWriterAlert, btnEditExportFile, txtEditExportFileInstructions, btnEditImportFile, txtEditImportModalTitle, lblEditImportFile, txtEditImportConfirmTitle, txtEditImportConfirm, txtEditImportConflict, txtEditImportSuccess, txtEditImportNoChange, txtEditImportTooLarge, txtEditImportError

ADDED (plain-text editing export, Unreleased): btnExportForEditing plus the five txtExportText*
keys back story/_exportText.js, a second export format that writes story_entry.content verbatim
rather than rendering it. txtExportTextLegend is the format spec the file carries for its reader
(and for an agent being handed the file) - note it is config while the delimiter it describes is
fixed in code, so an edit here can describe the format wrongly without breaking the parser.
txtExportTextHeader and txtExportTextLegend are multi-line and use \n escapes, which
sync-config.js converts on load. txtExportTextHeader's [authors] token is wrapped in a
{?...?} optional block, so the Writers line disappears on a story with show_authors off
rather than leaking names into a file any writer can download off the close announcement. The entry delimiter is deliberately NOT a config key: the
importer parses it, so a guild rewording it would break import rather than translate it. Status
words reuse the existing txtOpen/txtClosed. See docs/plans/PLAN-copyedit-round-trip.md.

**FILE: config_turn.sql**
REMOVED IN v3.x: txtHideTurnThreadsValidation, txtHideTurnThreadsPlaceholder (stale — text input replaced by Story Info modal radio group)
ADDED (edit history as an event log, Unreleased): txtEditHistoryVersionTitle and
txtEditHistoryEditedBy are the existing version page's title and footer, moved out of inline
template literals in story/_editHistory.js at their shipped wording. The four txtEditHistoryChange*
and txtEditHistory{WriterChanged,Moved} keys render the new non-content rows of story_entry_edit
(migration 027): a reorder or a writer change has no text to show, so the page shows what changed,
who changed it, and a disabled Restore button. Read via edit.js's EDIT_PANEL_CONFIG_KEYS.
See docs/plans/PLAN-copyedit-round-trip.md.

KEYS: txtDelayStoryStart, txtAndOr, txtStoryCreatorAdd, txtMustBeNo, txtStoryThreadTitle, txtTurnThreadTitle, txtTurnResumed, btnFinalizeEntry, btnSkipTurn, btnViewLastEntry, txtStoryActive, txtThreadCreationFailed, txtDMFailed, lblWriteEntry, txtWriteWarning, txtWritePlaceholder, txtStoryNotActive, txtPendingEntryExists, txtStoryNotFound, txtStoryWrongGuild, txtWriteFormFailed, txtEntryProcessFailed, txtPreviewTitle, txtPreviewDescription, txtPreviewExpires, lblYourEntry, lblEntryContinued, lblEntryStats, txtEntryStatsTemplate, txtEntrySubmitted, txtEntryDiscarded, txtDMReminder, txtRecoveryInstructions, txtEmptyEntry, txtEntryFinalized, txtSkipSuccess, txtFailedtoFinalize, txtWriterStatusPaused, txtStoryNotFoundOrClosed, txtTurnThreadResumed, txtStoryThreadTurnStart, txtStoryThreadTurnStartSlow, txtStoryThreadTurnSkip, txtStoryThreadTurnTimeout, txtStoryThreadWriterJoin, txtStoryThreadWriterRemove, txtStoryThreadCreatorTip, btnFinalizeConfirm, btnSkipConfirm, btnSkipCancel, txtEditEntryNotFound, txtEditEntryEmpty, txtEditNotAuthorized, txtEditSessionExpired, txtEditSuccess, txtEditRestoreSuccess, txtEditHistoryNotFound, btnRepostEntry, txtRepostSuccess, txtRepostThreadNotFound, btnRequestMoreTime, txtRequestMoreTimePost, txtRequestMoreTimeUsed, txtRequestMoreTimeAlreadyUsed, txtRequestMoreTimeNotYourTurn, txtTimeleftNoActiveTurn, txtTimeleftSlowMode, txtDMTurnStartQuick, txtMentionTurnStartQuick, txtDMTurnStartNormal, txtMentionTurnStartNormal, txtDMTurnStartSlow, txtMentionTurnStartSlow, txtDMTurnReminderQuick, txtMentionTurnReminderQuick, txtDMTurnReminderNormal, txtMentionTurnReminderNormal, txtDMTurnReminderSlow, txtMentionTurnReminderSlow, txtWriteTurnEnded, txtWriteAlreadySubmitted, txtMediaPostLabel, txtPingWriters, txtPingWritersSent, txtStoryFeedTurnStart, txtTimeoutReminderValidation, txtManageValidationSlowReminder, txtTurnLengthPlaceholder, txtTimeoutReminderPlaceholder, txtTimeoutReminderSlowPlaceholder, lblTimeoutReminderSlow, txtTimeoutReminderSlowDesc, txtFinalizeConfirm, txtFinalizeConfirmDesc, lblFinalizePreviewEntry, txtFinalizeImageReview, txtSkipConfirmNoContent, txtSkipConfirmHasContent, txtReadEntryNotFound, txtReadSessionExpired, txtStatusLegendCreator, txtStatusLegendCurrentTurn, txtStatusLegendNextUp, txtStatusLegendPaused, txtStatusNoActiveTurn, txtStatusNextManual, txtStatusNextFixed, txtStatusNextRoundRobin, txtStatusNextRandom, txtStatusReminderSuffix, txtStatusReminderSuffixSlow, txtStatusSlowModeNoTimer, txtStatusNoEntries, txtStatusEntryStats, lblStatusTags, lblStatusStatus, lblStatusMode, lblStatusWriterOrder, lblStatusTurnLength, lblStatusWriters, lblStatusShowAuthors, lblStatusCurrentTurn, lblStatusNextWriter, lblStatusEntries, lblStatusWriterList, txtStatusWriterListMore, lblStatusInactiveHeading, lblStatusClosed, txtThreadScheduledDelete, btnDeleteNow, txtPendingDeletion, txtSkipConfirmHasContentKeep, btnSkipDelete, btnSkipKeep, txtEntrySubmittedProcessing, txtSlowModeWelcome, txtSlowModeWelcomeNoMedia, txtEditHistoryVersionTitle, txtEditHistoryEditedBy, txtEditHistoryChangeTitle, txtEditHistoryChangeBy, txtEditHistoryWriterChanged, txtEditHistoryMoved

**FILE: config_mystory.sql**
REMOVED 2026-10-01 (Pass/Skip sweep): txtPassSuccess — dead key, read by no .js file and a
word-for-word duplicate of txtMyPassSuccess.
KEYS: lblYourPenName, txtYourPenNameDesc, txtMyStoryNone, txtMyTurnQuick, txtMyTurnNormal, txtOthersTurn, txtMyTurnHistory, txtMyTurnNoHistory, txtCatchupNoEntries, txtCatchupSessionExpired, txtMyStoryManageTitle, lblMyStoryManagePenName, lblMyStoryManageNotif, lblMyStoryManagePrivacy, txtMyStoryManageSaved, btnMyStoryManageSave, txtLeaveConfirm, txtLeaveConfirmMyTurn, txtLeaveConfirmLastWriter, txtLeftStorySuccess, txtPassSuccess, txtPenNamePlaceholder, txtMyListTitle, txtMyListNone, btnMyStoryManagePause, btnMyStoryManageResume, btnMyStoryManagePass, btnMyStoryManageLeave, lblMyStoryManageStatus, txtMyStoryManagePausedStatus, txtMyStoryManageActiveStatus, txtMyPassConfirm, txtMyPauseConfirm, txtMyResumeSuccess, txtMyPauseSuccess, txtMyPassSuccess, btnLeaveStory, btnMyPassConfirm, btnMyPauseConfirm, lblMyNotifications, txtMyListPausedSuffix, txtCatchupTurnHeader, txtCatchupIntro, txtCatchupIntroNoTurns, txtCatchupNavHeader, txtMyStoryManagePanelDesc, btnMyListViewActive, btnMyListViewPaused, btnMyListViewClosed, btnMyListViewJoinable, txtMyListTitleActive, txtMyListTitlePaused, txtMyListTitleClosed, txtMyListTitleJoinable, txtMyListNoneActive, txtMyListNonePaused, txtMyListNoneClosed, txtMyListNoneJoinable, txtMyListMyTurn, txtMyListOthersTurn, txtMyListNoActiveTurn, txtMyListStats, txtMyListNoEntries
RETIRED KEYS (no longer fetched): txtMyListJoined, txtMyListMyStats, txtMyListNoTurns, txtMyListStoryTotal

**FILE: config_storyadmin.sql**
SETUP-ONLY KEYS (written programmatically by handleSetupSave, never by sync): cfgStoryFeedChannelId, cfgMediaChannelId, cfgAdminRoleName, cfgGuildRegisteredAt (ISO timestamp of first setup, INSERT IGNORE — never overwritten), cfgChangelogEnabled, cfgHubAnnouncementsChannelId (system-level guild_id=1, never overwritten), cfgRatingsFilter (written by handleSetupSave, staged like cfgChangelogEnabled), cfgGroundRules (written directly by the Ground Rules authoring flow in commands/_storyadminSetupGroundRules.js, bypassing handleSetupSave entirely — see that file's header comment)

ADDED 2026-09-24 (panel-rework plan Part 2, two-tier setup split): two-tier setup panel
(commands/_storyadminSetup.js split into _storyadminSetup.js, _storyadminSetupSave.js,
_storyadminSetupFieldModals.js, _storyadminSetupGroundRules.js), Ground Rules server vocabulary
authoring + story-level selection, the Ratings Filter (`cfgRatingsFilter`, renamed from "Teen
or Lower Only" 2026-10-04 -- label only, key unchanged). New keys listed below and
in config_metadata.sql's KEYS line.

REMOVED IN v3.x: lblManageJoinStatus (replaced by btnManageJoinsOpen / btnManageJoinsClose)
REMOVED 2026-08-26: txtSetupModalSaveWarning (always-on save reminder, replaced by the
dirty-state-only lblUnsavedChangesTitle/txtUnsavedChangesBody pair shared with /story manage —
see config_other.sql). txtSetupBotPermsFix reworded same day for plainer, less technical
phrasing — both changes prompted by a real incident: an admin missed the always-on warning, hit
the setup-required block on /story add, recovered and completed setup correctly, but appears to
have uninstalled shortly after seeing the bot-permissions warning on the save confirmation.
REWORDED 2026-09-24: txtSetupModalTitleMedia ("Media/Image Channel" → "Story Media Channel"),
txtSetupModalTitleRestrictedFeed ("Restricted Feed Channel" → "Restricted Story Feed Channel"),
txtSetupModalTitleRestrictedMedia ("Restricted Media Channel" → "Restricted Story Media Channel")
for consistency with the "Story Admin" naming convention. txtSetupEmbedDescMedia and
txtSetupEmbedDescRestrictedMedia reworded to drop bot-permission wording in favor of a single
shared note (see next). txtSetupEmbedDescRestrictedMedia also now states its fallback (unset →
Story Media Channel), matching what resolveMediaChannelId() in story/_metadata.js already does.
REMOVED 2026-10-04: btnManageUserClose (the /storyadmin user panel's own Close button, dropped when that panel moved to the shared Components V2 builder — the panel is ephemeral, so Discord's own Dismiss already does it, which is why Cancel came off the other panels. NOTE: sync_config only INSERTs missing and UPDATEs changed keys, never DELETEs, so already-deployed guilds keep an inert btnManageUserClose row.)
ADDED 2026-09-24: txtSetupChannelsPermissionNote — one shared note above all four channel fields
("If any of these channels are set as private, the Round Robin Storybot role must be added under
Advanced Permissions"), replacing per-field permission wording. LeeAnn: the bot's invite already
grants it every permission it needs server-wide (see docs/reference/HOSTING.md's Bot
invite/install link section); a private channel can still block that access unless the bot's role
is explicitly added back to it, which is the thing admins actually forget, not "granting
permissions" from scratch.
ADDED (Change Order / Change Writer, Unreleased): the seven
txtManageEntriesChangeOrder*/lblManageEntriesChangeOrderTurn/btnManageEntriesChangeOrder keys and
the six Change Writer keys drive the two new buttons on the Manage Entries edit panel. Both say
"turn", not "entry", for the numbered thing (LeeAnn, 2026-10-22), and neither is called Reassign:
btnTurnReassign already means "Reassign to Previous" in Manage Turns.
txtManageEntriesChangeWriterLatest is appended only on the story's most recent turn, where
changing the writer also moves the rotation pointer.
See docs/plans/PLAN-copyedit-round-trip.md.

ADDED (whole-story import, Unreleased): btnManageEntriesImport plus the txtImportStory* set
drive the edited-story import on the Manage Entries picker -- the modal, the per-turn
confirmation, its five note fragments, and the error report. Read via story/_importStory.js's
IMPORT_STORY_CONFIG_KEYS; btnManageEntriesImport is also in _manageEntriesList.js's picker keys,
since that is where the button renders.

The modal has no label or nothing-changed string of its own: it reads lblEditImportFile and
txtEditImportNoChange from the single-entry round trip, because LeeAnn had already approved that
text there ("use the text from the single import", 2026-10-22), and it has no instructions line
for the same reason the entry modal lost its own.

The txtImportStoryError* set is one report rather than one refusal per problem -- a header line
(hers verbatim) and a bullet per kind, each naming every turn or writer of that kind, because the
editor fixes them all in the word processor and uploads again. The bullet wording avoids is/are so
one item and twenty read the same. txtImportStoryErrorUnreadable is outside the report: the upload
itself never arrived or could not be fetched, so there is nothing in it to list. Approved
All of it approved 2026-10-22, the bullet wording included.
See docs/plans/PLAN-copyedit-round-trip.md.

KEYS: txtManageTurnLengthLiveTurnNote, txtSetupChannelsPermissionNote, btnSetupGroundRules, txtSetupModalTitleGroundRules, txtSetupEmbedDescGroundRules, txtSetupGroundRulesModalDesc, lblSetupRatingsFilter, txtSetupEmbedDescRatingsFilter, cfgRatingsFilter, cfgGroundRules, txtReopenStory, txtReopenSuccess, txtStoryCloseConfirm, btnCloseConfirm, txtStoryClosedPublic, txtStoryFeedClosed, txtAdminHelpTitle, txtAdminHelpFooter, txtAdminHelpSkip, txtAdminHelpExtend, txtAdminHelpManageUser, txtAdminHelpNext, txtAdminHelpReassign, txtAdminHelpDelete, txtAdminHelpSetup, txtSetupPanelTitle, txtSetupRequiredAdmin, txtSetupRequiredUser, txtSetupNoPermission, txtSetupFeedChannelInvalid, txtSetupMediaChannelInvalid, txtSetupBotPermsFix, btnSetupChannels, btnSetupRoundup, btnSetupRole, btnSetupSave, txtSetupModalTitleChannels, txtSetupModalTitleRoundup, txtSetupChannelsModalDesc, txtSetupRoundupModalDesc, txtSetupEmbedDescFeed, txtSetupEmbedDescMedia, txtSetupEmbedDescAdminRole, txtSetupEmbedDescRestrictedFeed, txtSetupEmbedDescRestrictedMedia, txtSetupEmbedDescRoundupChannel, txtSetupEmbedDescRoundupDay, txtSetupEmbedDescRoundupHour, txtSetupModalTitleFeed, txtSetupModalTitleMedia, txtSetupModalTitleRole, txtSetupModalTitleRestrictedFeed, txtSetupModalTitleRestrictedMedia, txtSetupModalTitleRoundupChannel, txtSetupModalTitleRoundupDay, txtSetupModalTitleRoundupHour, lblSetupModalFieldRole, txtSetupModalPlaceholderRole, txtAdminOnly, txtAdminNoActiveTurn, txtAdminSkipSuccess, txtAdminExtendSuccess, txtAdminKickNotWriter, txtAdminKickSuccess, txtAdminPauseUserSuccess, txtAdminUnpauseUserSuccess, txtAdminUnpauseNotPaused, txtAdminPenNameSuccess, txtAdminMUPauseConfirmDesc, txtAdminMUUnpauseConfirmDesc, txtAdminMURemoveConfirmDesc, txtAdminMUActiveTurnWarning, txtAdminMULastWriterWarning, txtManageUserPanelTitle, lblManageUserStatus, lblManageUserPenName, lblManageUserNotif, lblManageUserPrivacy, btnManageUserClose, txtAdminPauseSuccess, txtAdminAlreadyPaused, txtAdminAlreadyActive, txtAdminResumeSuccess, txtAdminDeleteConfirm, txtAdminDeleteSuccess, txtAdminDeleteEntryAlreadyDeleted, txtAdminDeleteEntrySuccess, txtAdminRestoreEntryNotDeleted, txtAdminRestoreEntrySuccess, txtAdminConfigTitle, txtAdminConfigSaved, btnAdminConfigSave, lblAllowLateJoins, lblOpenToWriters, lblSummary, btnSetSummary, lblTags, btnSetTags, txtManageNotAuthorized, txtManageValidationTurnLength, txtManageValidationTimeout, txtManageValidationMaxWriters, txtAdminNextSuccess, txtAdminNextAlreadyCurrent, txtAdminReassignSuccess, txtAdminReassignNoPreviousWriter, txtAdminHelpRemove, txtSetupRoundupDayInvalid, txtSetupRoundupHourInvalid, cfgWeeklyRoundupEnabled, cfgWeeklyRoundupDay, cfgWeeklyRoundupHour, cfgWeeklyRoundupChannelId, cfgWeeklyRoundupColor, txtRoundupDay0, txtRoundupDay1, txtRoundupDay2, txtRoundupDay3, txtRoundupDay4, txtRoundupDay5, txtRoundupDay6, txtWeeklyRoundupTitle, txtRoundupNoActiveStories, txtRoundupStoryLine, txtRoundupActivity, txtRoundupOverflow, lblRoundupActiveStories, lblRoundupActivity, lblRoundupWriters, txtAdminMUSaved, btnTurnSkip, btnTurnExtend, btnTurnNext, btnTurnReassign, btnTurnDeleteEntry, btnTurnRestoreEntry, txtTurnActionsNoTurn, txtManageEmbedTitle, txtManageEmbedTitleMetadata, lblManageStoryTitle, lblManageStoryStatus, btnManageJoinsOpen, btnManageJoinsClose, txtManageSectionBreakMeta, txtManageSetTitleModalTitle, txtManageSetTitlePlaceholder, btnManageTurns, btnManageEntries, btnManageUsers, txtManageUsersPickModalTitle, lblManageUsersPickSelect, txtManageUsersNoWriters, txtManageEntriesDesc, txtManageTurnsDesc, txtReviewTagsDesc, txtManageUsersDesc, txtChangeStoryStatusLabel, txtManageTurnsPanelTitle, txtManageTurnsNoTurn, txtManageTurnsActiveTurn, txtManageEntriesSelectEntry, txtManageEntriesNoEntries, lblManageEntriesEntryOption, btnManageEntriesDelete, btnManageEntriesRestore, btnManageEntriesBack, txtStoryCloseNotAuthorized, lblAdminHelpSkip, lblAdminHelpExtend, lblAdminHelpManageUser, lblAdminHelpNext, lblAdminHelpReassign, lblAdminHelpDelete, lblAdminHelpSetup, lblAdminHelpRemove, txtSetupRoundupDayInvalid, txtSetupRoundupHourInvalid, btnAdminMUPause, btnAdminMUUnpause, btnAdminMURemove, btnAdminMUPenName, btnConfirmDelete, btnAdminMUSave, lblAdminMUNotif, lblAdminMUPrivacy, btnAdminMUToggleNotif, btnAdminMUTogglePrivacy, txtTurnSkipConfirm, txtTurnExtendModalTitle, lblTurnExtendHours, txtTurnExtendPlaceholder, txtTurnNextModalTitle, lblTurnNextUser, txtTurnNextPlaceholder, txtTurnReassignConfirm, txtTurnDeleteEntryModalTitle, lblTurnDeleteEntryTurn, txtTurnDeleteEntryPlaceholder, txtTurnRestoreEntryModalTitle, lblTurnRestoreEntryId, txtTurnRestoreEntryPlaceholder, txtTurnNextSelectWrite, cfgRestrictedFeedChannelId, cfgRestrictedMediaChannelId, txtSetupRestrictedChannelInvalid, txtSetupRestrictedMediaInvalid, txtManageEntryDeleteSuccess, txtManageEntryRestoreSuccess, txtManageEntryAlreadyDeleted, txtManageEntryAlreadyConfirmed, txtManageUserPanelSaveNote, txtNotifDM, txtNotifMention, btnManageUserSwitchMention, btnManageUserSwitchDM, btnManageUserMakePublic, btnManageUserMakePrivate, txtAdminMUPauseConfirmTitle, txtAdminMUUnpauseConfirmTitle, txtAdminMURemoveConfirmTitle, txtAdminRemoveAutoClose, txtAdminMUPenNamePlaceholder, txtTurnExtendInvalidHours, txtTurnDeleteEntryInvalidNumber, txtTurnRestoreEntryInvalidId, txtTurnNextSelectPlaceholder, txtTurnDeleteEntryConfirmTitle, txtTurnDeleteEntryConfirmNote, btnTurnDeleteEntryConfirm, txtManageEntriesMoreEntries, txtManageEntriesEntryPlaceholder, txtManageEntriesDeletedFlag, txtSetupAgeRestrictNote, txtSetupNoMediaNote, txtSetupNoRoleNote, txtSetupRoundupDisabledNote, txtSetupSupportInvite, lblSetupChangelog, txtSetupEmbedDescChangelog, txtHubAnnouncementTitle, txtHubAnnouncementFooter, txtHubAnnouncementOptOut, lblAdminFaqSetup, txtAdminFaqSetup, lblAdminFaqUserPanel, txtAdminFaqUserPanel, lblAdminFaqDelete, txtAdminFaqDelete, txtAdminFaqFooter, txtFaqSyncSuccess, txtFaqSyncNoThreads, txtFaqSyncPartial, txtAdminSweepSuccess, txtAdminSweepNoneFound, btnManageEntriesChangeOrder, txtManageEntriesChangeOrderModalTitle, lblManageEntriesChangeOrderTurn, txtManageEntriesChangeOrderPlaceholder, txtManageEntriesChangeOrderSuccess, txtManageEntriesChangeOrderInvalid, txtManageEntriesChangeOrderNoChange, btnManageEntriesChangeWriter, txtManageEntriesChangeWriterSelect, txtManageEntriesChangeWriterPlaceholder, txtManageEntriesChangeWriterSuccess, txtManageEntriesChangeWriterSame, txtManageEntriesChangeWriterLatest, btnManageEntriesImport, txtImportStoryModalTitle, txtImportStoryConfirmTitle, txtImportStoryConfirm, txtImportStoryRow, txtImportStoryRowRemoved, txtImportStoryNoteMoved, txtImportStoryNoteWriter, txtImportStoryNoteRemoved, txtImportStoryNoteRestored, txtImportStoryNoteConflict, txtImportStoryUnchangedCount, txtImportStoryOverflow, btnImportStoryConfirm, txtImportStorySuccess, txtImportStoryErrorHeader, txtImportStoryErrorNoTurnLines, txtImportStoryErrorUnknownId, txtImportStoryErrorDuplicateId, txtImportStoryErrorUnknownWriter, txtImportStoryErrorEmptyTurn, txtImportStoryErrorTooLong, txtImportStoryErrorUnreadable

**FILE: config_metadata.sql**
REMOVED IN v3.0.0: btnSetMetadata (metadata panel button replaced by modal openers in story add/manage)
ADDED 2026-10-04: cfgGroundRulesColor — the reader-facing Ground Rules embed's border, as
'#RRGGBB' (same form as cfgWeeklyRoundupColor). Read by buildGroundRulesEmbed() in
story/_groundRules.js for all three of its sites. Missing or unparseable logs a high-priority
error and leaves the border unset, rather than throwing — setColor(NaN) would take the whole
status post down.
ADDED 2026-09-24 (panel-rework plan Part 2): Ground Rules — lblMetaGroundRules,
txtGroundRulesDefaultVocabulary (the six approved default rules, verbatim, do not reword —
see docs/plans/PLAN-panel-rework-and-ground-rules.md Part 2), txtGroundRulesErrCount,
txtGroundRulesErrRule, txtGroundRulesReasonLabelMissing, txtGroundRulesReasonLabelTooLong,
txtGroundRulesReasonDescTooLong, txtGroundRulesConfirmTitle, txtGroundRulesConfirmBody,
lblGroundRulesAdded, lblGroundRulesRemoved, lblGroundRulesRenamed, txtGroundRulesRemovedUsageNote,
txtGroundRulesRenamedNote, btnGroundRulesConfirm, btnGroundRulesCancel, txtGroundRulesNoneConfigured,
txtGroundRulesChangedNotice, txtGroundRulesChangedNoticeNone. Also: lblRatingChangeThreadWarning,
txtRatingChangeThreadWarning, txtRatingChangeConfirmTitle, txtRatingChangeConfirmBody,
btnRatingChangeConfirm, btnRatingChangeRevert, txtMetaApplied were already present (built
2026-05-06, orphaned by the eefc881 UX v3 rewrite) and are live again as of this date — restored
rating-change confirmation flow, see docs/changelogs/INTERNAL.md's Unreleased entry.
KEYS: txtExportAO3Instructions, btnExportPostPublicly, txtExportPostedPublicly, btnExportNoBreaks, btnExportWithBreaks, btnExportForEditing, txtExportTextInstructions, txtExportTextNoEntries, txtExportTextHeader, txtExportTextLegend, txtExportCompletedLabel, txtExportUpdatedLabel, txtExportModeQuick, txtExportModeSlow, txtExportModeNormal, txtExportLblDynamic, txtExportLblRating, txtExportLblWarnings, txtExportLblRelationship, txtExportLblAdditionalRelationships, txtExportLblCharacters, txtExportLblTags, txtExportLblStarted, txtExportLblWriters, txtExportLblExported, txtExportNoteBody, txtExportStatsLine, txtExportImageUnavailable, lblFandom, lblAdditionalTags, txtRatingBadgeNR, txtRatingBadgeG, txtRatingBadgeT, txtRatingBadgeM, txtRatingBadgeE, txtRatingNR, txtRatingG, txtRatingT, txtRatingM, txtRatingE, optWarnAllClear, optWarnViolence, optWarnCharacterDeath, optWarnOther, optWarnNonCon, optWarnMinors, optWarnUnspecified, optDynamicGeneral, optDynamicFF, optDynamicFM, optDynamicMM, optDynamicPoly, optDynamicOther, lblRatingChangeThreadWarning, txtMetaApplied, txtRatingChangeThreadWarning, txtRatingChangeConfirmTitle, txtRatingChangeConfirmBody, btnRatingChangeConfirm, btnRatingChangeRevert, txtStoryThreadMigratedOut, txtStoryThreadMigratedIn, txtRestrictedStoryNotHere, txtTagSubmitModalTitle, txtTagSubmitPlaceholder, txtTagSubmitSuccess, txtTagSubmitNotWriter, txtTagSubmitDuplicate, txtTagPendingTitle, txtTagNoPending, btnTagApprove, btnTagReject, txtTagApproved, txtTagRejected, txtTagNotCreator, txtTagReviewSessionExpired, btnReviewTags, txtSelectionStaged, btnViewTags, btnEditTags, txtTagSubmitModalTitleRead, txtTagVoteCount, txtTagVoteNote, txtTagSubmitPosted, txtTagSubmitNoThread, txtTagViewNone, lblMetaDynamic, lblMetaRating, txtRatingDesc, lblMetaWarnings, lblMetaFandom, lblMetaMainRelationship, lblMetaOtherRelationships, lblMetaCharacters, lblMetaTags, lblMetaSummary, txtMetaMainRelationshipPlaceholder, txtMetaFandomPlaceholder, txtMetaPanelTitle, txtMetaSaveSuccess, lblTagSubmitText, lblMetaSceneBreakDivider, txtSceneBreakDividerDesc, txtMetaSceneBreakDividerPlaceholder


**FILE: config_other.sql**
KEYS: txtValidationErrors, txtFormOpenError, txtFormProcessError, txtAdditionalOptionsError, txtStoryCreationError, txtDelayHoursPlaceholder, txtDelayWritersPlaceholder, txtKeepPrivatePlaceholder, lblTurnActions, lblUnsavedChangesTitle, txtUnsavedChangesBody
