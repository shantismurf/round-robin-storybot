-- Context: Other/Uncategorized
-- Keys remaining here are cross-cutting error messages not specific to any single command.
INSERT INTO config (config_key, config_value, language_code, guild_id) VALUES
('txtValidationErrors', '**Validation Errors:**', 'en', 1),
('txtFormOpenError', 'Failed to open story creation form. Please try again.', 'en', 1),
('txtFormProcessError', 'Failed to process form. Please try again.', 'en', 1),
('txtAdditionalOptionsError', 'Failed to show additional options form.', 'en', 1),
('txtStoryCreationError', 'Failed to create story. Please try again.', 'en', 1),
('txtDelayHoursPlaceholder', 'Enter number of hours (optional)', 'en', 1),
('txtDelayWritersPlaceholder', 'Enter number of writers (optional)', 'en', 1),
('txtKeepPrivatePlaceholder', 'Enter: yes or no', 'en', 1),
('lblTurnActions', 'Turn Actions', 'en', 1),
-- Shared dirty-state "unsaved changes" warning — any panel that stages edits behind a Save
-- button (story/manage.js, commands/_storyadminSetup.js) shows this only when something is
-- actually staged, via [save_label] substituted to that panel's own Save button label.
('lblUnsavedChangesTitle', '⚠️ Unsaved Changes', 'en', 1),
('txtUnsavedChangesBody', 'You have changes that haven''t been saved yet. Click **[save_label]** below to keep them.', 'en', 1),
-- Mention-resolution placeholders (docs/plans/PLAN-mention-display-text.md) — shown inline in a
-- story entry's actual saved content whenever a @user/#channel/@role mention can't be resolved
-- to a real name at write time (deleted, left the server, cache miss, or hidden by Discord's
-- channel-obfuscation change). This IS what readers see from then on, everywhere the entry is
-- shown — not a rare-path error message.
('txtExportPlaceholderUser', '@unknown', 'en', 1),
('txtExportPlaceholderChannel', '#unknown', 'en', 1),
('txtExportPlaceholderRole', '@unknown', 'en', 1);
