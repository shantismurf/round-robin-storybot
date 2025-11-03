-- Sample config entries for testing the story system
-- Insert default English config values for system (guild_id = 1)

INSERT INTO config (config_key, config_value, language_code, guild_id) VALUES

-- Field Labels
('lblStoryTitle', 'Story Title:', 'en', 1),
('lblQuickMode', 'Quick Mode?:', 'en', 1),
('lblTurnLength', 'Turn Length (hours):', 'en', 1),
('lblTimeoutReminder', 'Timeout Reminder (percent of turn length):', 'en', 1),
('lblHideTurnThreads', 'Hide Turn Threads?', 'en', 1),
('lblNoHours', 'By # of Hours (if applicable):', 'en', 1),
('lblNoWriters', '# of Writers (if applicable):', 'en', 1),
('lblYourAO3Name', 'Your AO3 name (if blank, discord display name will be used):', 'en', 1),
('lblKeepYourPrivate', 'Keep your turn threads private?:', 'en', 1),

-- Text Messages
('txtDelayStoryStart', 'Delay Story Start? (leave blank to start immediately):', 'en', 1),
('txtAndOr', 'and/or', 'en', 1),
('txtStoryCreatorAdd', 'You''ll be added as the first writer in the story. Please provide:', 'en', 1),
('txtMustBeNo', '[Field label text] must be a number.', 'en', 1),
('txtStoryThreadTitle', 'Story ID: [story_id] - [inputStoryTitle] - [story_status]', 'en', 1),
('txtTurnThreadTitle', 'Story ID: [story_id] - Turn [storyTurnNumber] - [user display name] - Ends [turnEndTime]', 'en', 1),
('txtDMTurnStart', '🎭 **Your turn has started!** You can now write your part of the story.', 'en', 1),
('txtMentionTurnStart', '🎭 **Your turn has started!** You can now write your part of the story.', 'en', 1),
('txtAlreadyJoined', 'You have already joined this story!', 'en', 1),
('txtStoryJoinFail', 'You were not added to the story. Please contact an administrator.', 'en', 1),
('txtStoryActive', 'Your story is now active!', 'en', 1),
('txtMoreWritersDelay', 'This story will begin when X more writer(s) join!', 'en', 1),
('txtHoursDelay', 'This story will begin in X hours!', 'en', 1),

-- Story Status Text
('txtClosed', 'Closed', 'en', 1),
('txtActive', 'Active', 'en', 1), 
('txtPaused', 'Paused', 'en', 1),

-- Error Messages
('txtThreadCreationFailed', 'Failed to create story thread. Please contact the administrator.', 'en', 1),
('txtStoryCreated', 'Story created successfully!', 'en', 1),
('txtDMFailed', 'Could not send direct message. Check your privacy settings.', 'en', 1),

-- System Configuration
('cfgLanguageCode', 'en', 'en', 1),
('cfgStoryFeedChannelId', '1234567890123456789', 'en', 1); -- Replace with actual channel ID