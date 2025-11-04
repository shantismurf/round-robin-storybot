import { SlashCommandBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, StringSelectMenuBuilder, ComponentType, EmbedBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { getConfigValue, sanitizeModalInput, formattedDate, replaceTemplateVariables } from '../utilities.js';
import { CreateStory } from '../storybot.js';

const data = new SlashCommandBuilder()
  .setName('story')
  .setDescription('Manage round-robin stories')
  .addSubcommand(subcommand =>
    subcommand
      .setName('add')
      .setDescription('Create a new round-robin story')
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('list')
      .setDescription('Browse available stories')
      .addStringOption(option =>
        option.setName('filter')
          .setDescription('Filter stories by type')
          .setRequired(false)
          .addChoices(
            { name: 'All Stories', value: 'all' },
            { name: 'Joinable Stories', value: 'joinable' },
            { name: 'My Stories', value: 'mine' },
            { name: 'Active Stories', value: 'active' },
            { name: 'Paused Stories', value: 'paused' }
          ))
      .addIntegerOption(option =>
        option.setName('page')
          .setDescription('Page number')
          .setRequired(false)
          .setMinValue(1))
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('write')
      .setDescription('Submit your entry for a story (quick mode only)')
      .addIntegerOption(option =>
        option.setName('story_id')
          .setDescription('Story ID where you want to submit')
          .setRequired(true))
  );

async function execute(interaction) {
  const subcommand = interaction.options.getSubcommand();
  
  if (subcommand === 'add') {
    await handleAddStory(interaction);
  } else if (subcommand === 'list') {
    await handleListStories(interaction);
  } else if (subcommand === 'write') {
    await handleWrite(interaction);
  }
}

async function handleAddStory(interaction) {
  try {
    const guildId = interaction.guild.id;
    
    // Get all config values for modal labels
    const lblStoryTitle = await getConfigValue('lblStoryTitle', guildId);
    const lblQuickMode = await getConfigValue('lblQuickMode', guildId);
    const lblTurnLength = await getConfigValue('lblTurnLength', guildId);
    const lblTimeoutReminder = await getConfigValue('lblTimeoutReminder', guildId);
    const lblHideTurnThreads = await getConfigValue('lblHideTurnThreads', guildId);
    const txtDelayStoryStart = await getConfigValue('txtDelayStoryStart', guildId);
    const lblNoHours = await getConfigValue('lblNoHours', guildId);
    const txtAndOr = await getConfigValue('txtAndOr', guildId);
    const lblNoWriters = await getConfigValue('lblNoWriters', guildId);
    const txtStoryCreatorAdd = await getConfigValue('txtStoryCreatorAdd', guildId);
    const lblYourAO3Name = await getConfigValue('lblYourAO3Name', guildId);
    const lblKeepYourPrivate = await getConfigValue('lblKeepYourPrivate', guildId);

    // Create modal
    const modal = new ModalBuilder()
      .setCustomId('story_add_modal')
      .setTitle('Create New Story');

    // Story Title - Required text input
    const storyTitleInput = new TextInputBuilder()
      .setCustomId('story_title')
      .setLabel(lblStoryTitle)
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(500);

    // Quick Mode - Select Menu (converted to text input for modal)
    const quickModeInput = new TextInputBuilder()
      .setCustomId('quick_mode')
      .setLabel(lblQuickMode)
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setValue('off')
      .setPlaceholder('Enter: off or on');

    // Turn Length - Required text input with default
    const turnLengthInput = new TextInputBuilder()
      .setCustomId('turn_length')
      .setLabel(lblTurnLength)
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setValue('24')
      .setPlaceholder('Enter number of hours');

    // Timeout Reminder - Select Menu (converted to text input for modal)
    const timeoutReminderInput = new TextInputBuilder()
      .setCustomId('timeout_reminder')
      .setLabel(lblTimeoutReminder)
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setValue('50')
      .setPlaceholder('Enter: 0, 25, 50, or 75');

    // Create second modal for additional fields
    const hideTurnThreadsInput = new TextInputBuilder()
      .setCustomId('hide_turn_threads')
      .setLabel(lblHideTurnThreads)
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setValue('off')
      .setPlaceholder('Enter: off or on');

    // Add fields to modal (Discord limits to 5 components per modal)
    const row1 = new ActionRowBuilder().addComponents(storyTitleInput);
    const row2 = new ActionRowBuilder().addComponents(quickModeInput);
    const row3 = new ActionRowBuilder().addComponents(turnLengthInput);
    const row4 = new ActionRowBuilder().addComponents(timeoutReminderInput);
    const row5 = new ActionRowBuilder().addComponents(hideTurnThreadsInput);

    modal.addComponents(row1, row2, row3, row4, row5);

    await interaction.showModal(modal);

  } catch (error) {
    console.error(`${formattedDate()}: [Guild ${guildId}] Error creating story modal:`, error);
    await interaction.reply({
      content: 'Failed to open story creation form. Please try again.',
      ephemeral: true
    });
  }
}

// Handle modal submission
async function handleModalSubmit(interaction) {
  if (interaction.customId === 'story_add_modal') {
    await handleAddStoryModal(interaction);
  } else if (interaction.customId.startsWith('story_write_')) {
    await handleWriteModalSubmit(interaction);
  }
}

// Handle story add modal (renamed for clarity)
async function handleAddStoryModal(interaction) {
  try {
    const guildId = interaction.guild.id;
    
    // Get form values and sanitize
    const storyTitle = sanitizeModalInput(interaction.fields.getTextInputValue('story_title'), 500);
    const quickModeRaw = sanitizeModalInput(interaction.fields.getTextInputValue('quick_mode'), 10);
    const turnLengthRaw = sanitizeModalInput(interaction.fields.getTextInputValue('turn_length'), 10);
    const timeoutReminderRaw = sanitizeModalInput(interaction.fields.getTextInputValue('timeout_reminder'), 10);
    const hideTurnThreadsRaw = sanitizeModalInput(interaction.fields.getTextInputValue('hide_turn_threads'), 10);

    // Get error message template
    const txtMustBeNo = await getConfigValue('txtMustBeNo', guildId);

    // Validate inputs
    const errors = [];

    // Validate quick mode
    const quickMode = quickModeRaw.toLowerCase();
    if (!['off', 'on'].includes(quickMode)) {
      errors.push(`Quick Mode must be "off" or "on".`);
    }

    // Validate turn length (must be numeric)
    const turnLength = parseInt(turnLengthRaw);
    if (isNaN(turnLength) || turnLength < 1) {
      const lblTurnLength = await getConfigValue('lblTurnLength', guildId);
      errors.push(replaceTemplateVariables(txtMustBeNo, { 'Field label text': lblTurnLength }));
    }

    // Validate timeout reminder (must be 0, 25, 50, or 75)
    const timeoutReminder = parseInt(timeoutReminderRaw);
    if (![0, 25, 50, 75].includes(timeoutReminder)) {
      errors.push(`Timeout Reminder must be 0, 25, 50, or 75.`);
    }

    // Validate hide turn threads
    const hideTurnThreads = hideTurnThreadsRaw.toLowerCase();
    if (!['off', 'on'].includes(hideTurnThreads)) {
      errors.push(`Hide Turn Threads must be "off" or "on".`);
    }

    if (errors.length > 0) {
      await interaction.reply({
        content: `**Validation Errors:**\n${errors.join('\n')}`,
        ephemeral: true
      });
      return;
    }

    // Show second modal for additional fields
    await showSecondModal(interaction, {
      storyTitle,
      quickMode: quickMode === 'on' ? 1 : 0,
      turnLength,
      timeoutReminder,
      hideTurnThreads: hideTurnThreads === 'on' ? 1 : 0
    });

  } catch (error) {
    const guildId = interaction.guild.id;
    console.error(`${formattedDate()}: [Guild ${guildId}] Error processing story modal:`, error);
    await interaction.reply({
      content: 'Failed to process form. Please try again.',
      ephemeral: true
    });
  }
}

// Second modal for delay and writer options
async function showSecondModal(interaction, storyData) {
  try {
    const guildId = interaction.guild.id;
    
    // Get config values for second modal
    const txtDelayStoryStart = await getConfigValue('txtDelayStoryStart', guildId);
    const lblNoHours = await getConfigValue('lblNoHours', guildId);
    const lblNoWriters = await getConfigValue('lblNoWriters', guildId);
    const txtStoryCreatorAdd = await getConfigValue('txtStoryCreatorAdd', guildId);
    const lblYourAO3Name = await getConfigValue('lblYourAO3Name', guildId);
    const lblKeepYourPrivate = await getConfigValue('lblKeepYourPrivate', guildId);

    const secondModal = new ModalBuilder()
      .setCustomId(`story_add_modal_2_${JSON.stringify(storyData)}`)
      .setTitle('Story Settings & Writer Info');

    // Delay hours input
    const delayHoursInput = new TextInputBuilder()
      .setCustomId('delay_hours')
      .setLabel(lblNoHours)
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setPlaceholder('Enter number of hours (optional)');

    // Delay writers input  
    const delayWritersInput = new TextInputBuilder()
      .setCustomId('delay_writers')
      .setLabel(lblNoWriters)
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setPlaceholder('Enter number of writers (optional)');

    // AO3 name input
    const ao3NameInput = new TextInputBuilder()
      .setCustomId('ao3_name')
      .setLabel(lblYourAO3Name)
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setPlaceholder('Your AO3 username (optional)');

    // Private threads input
    const keepPrivateInput = new TextInputBuilder()
      .setCustomId('keep_private')
      .setLabel(lblKeepYourPrivate)
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setValue('no')
      .setPlaceholder('Enter: yes or no');

    // Add to modal
    const row1 = new ActionRowBuilder().addComponents(delayHoursInput);
    const row2 = new ActionRowBuilder().addComponents(delayWritersInput);
    const row3 = new ActionRowBuilder().addComponents(ao3NameInput);
    const row4 = new ActionRowBuilder().addComponents(keepPrivateInput);

    secondModal.addComponents(row1, row2, row3, row4);

    await interaction.showModal(secondModal);

  } catch (error) {
    console.error(`${formattedDate()}: [Guild ${guildId}] Error showing second modal:`, error);
    await interaction.followUp({
      content: 'Failed to show additional options form.',
      ephemeral: true
    });
  }
}

// Handle second modal submission
async function handleSecondModalSubmit(interaction) {
  if (!interaction.customId.startsWith('story_add_modal_2_')) return;

  try {
    // Extract first modal data from customId
    const firstModalData = JSON.parse(interaction.customId.replace('story_add_modal_2_', ''));
    const guildId = interaction.guild.id;

    // Get second modal values
    const delayHoursRaw = sanitizeModalInput(interaction.fields.getTextInputValue('delay_hours') || '0', 10);
    const delayWritersRaw = sanitizeModalInput(interaction.fields.getTextInputValue('delay_writers') || '0', 10);
    const ao3Name = sanitizeModalInput(interaction.fields.getTextInputValue('ao3_name'), 255);
    const keepPrivateRaw = sanitizeModalInput(interaction.fields.getTextInputValue('keep_private'), 10);

    // Get error message
    const txtMustBeNo = await getConfigValue('txtMustBeNo', guildId);

    // Validate second modal inputs
    const errors = [];

    // Validate delay hours
    const delayHours = parseInt(delayHoursRaw) || 0;
    if (delayHoursRaw && (isNaN(delayHours) || delayHours < 0)) {
      const lblNoHours = await getConfigValue('lblNoHours', guildId);
      errors.push(replaceTemplateVariables(txtMustBeNo, { 'Field label text': lblNoHours }));
    }

    // Validate delay writers
    const delayWriters = parseInt(delayWritersRaw) || 0;
    if (delayWritersRaw && (isNaN(delayWriters) || delayWriters < 0)) {
      const lblNoWriters = await getConfigValue('lblNoWriters', guildId);
      errors.push(replaceTemplateVariables(txtMustBeNo, { 'Field label text': lblNoWriters }));
    }

    // Validate keep private
    const keepPrivate = keepPrivateRaw.toLowerCase();
    if (!['yes', 'no'].includes(keepPrivate)) {
      errors.push(`Keep Private must be "yes" or "no".`);
    }

    if (errors.length > 0) {
      await interaction.reply({
        content: `**Validation Errors:**\n${errors.join('\n')}`,
        ephemeral: true
      });
      return;
    }

    // Acknowledge the interaction
    await interaction.deferReply({ ephemeral: true });

    // Combine all data
    const storyInput = {
      ...firstModalData,
      delayHours: delayHours || null,
      delayWriters: delayWriters || null,
      ao3Name: ao3Name || null,
      keepPrivate: keepPrivate === 'yes' ? 1 : 0
    };

    // Pass to CreateStory function
    const result = await CreateStory(interaction, storyInput);

    if (result.success) {
      await interaction.editReply({
        content: result.message
      });
    } else {
      await interaction.editReply({
        content: result.error
      });
    }

  } catch (error) {
    console.error(`${formattedDate()}: [Guild ${guildId}] Error processing second story modal:`, error);
    await interaction.editReply({
      content: 'Failed to create story. Please try again.'
    });
  }
}

/**
 * Handle /story write command
 */
async function handleWrite(interaction) {
  try {
    const guildId = interaction.guild.id;
    const storyId = interaction.options.getInteger('story_id');
    
    // Validate story access and get story info
    const storyInfo = await validateStoryAccess(storyId, guildId);
    if (!storyInfo.success) {
      await interaction.reply({ 
        content: storyInfo.error, 
        ephemeral: true 
      });
      return;
    }
    
    // Validate active writer
    const writerInfo = await validateActiveWriter(interaction.user.id, storyId);
    if (!writerInfo.success) {
      await interaction.reply({ 
        content: writerInfo.error, 
        ephemeral: true 
      });
      return;
    }
    
    // Check if story is quick mode
    if (!storyInfo.story.quick_mode) {
      const txtNormalModeWrite = await getConfigValue('txtNormalModeWrite', guildId);
      await interaction.reply({ 
        content: txtNormalModeWrite, 
        ephemeral: true 
      });
      return;
    }
    
    // Get configurable text
    const lblWriteEntry = await getConfigValue('lblWriteEntry', guildId);
    const txtWriteWarning = await getConfigValue('txtWriteWarning', guildId);
    const txtWritePlaceholder = await getConfigValue('txtWritePlaceholder', guildId);
    
    // Create modal
    const modal = new ModalBuilder()
      .setCustomId(`story_write_${storyId}`)
      .setTitle(`✍️ ${storyInfo.story.title}`);

    const entryInput = new TextInputBuilder()
      .setCustomId('entry_content')
      .setLabel(lblWriteEntry)
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder(`⚠️ ${txtWriteWarning}\n\n${txtWritePlaceholder}`)
      .setMaxLength(4000)
      .setMinLength(10)
      .setRequired(true);

    const row = new ActionRowBuilder().addComponents(entryInput);
    modal.addComponents(row);

    await interaction.showModal(modal);

  } catch (error) {
    console.error(`${formattedDate()}: [Guild ${interaction.guild.id}] Error in handleWrite:`, error);
    const txtWriteFormFailed = await getConfigValue('txtWriteFormFailed', interaction.guild.id);
    await interaction.reply({
      content: txtWriteFormFailed,
      ephemeral: true
    });
  }
}

/**
 * Handle write modal submission
 */
async function handleWriteModalSubmit(interaction) {
  try {
    const guildId = interaction.guild.id;
    const storyId = interaction.customId.split('_')[2];
    const content = sanitizeModalInput(interaction.fields.getTextInputValue('entry_content'), 4000);
    
    await interaction.deferReply({ ephemeral: true });
    
    // Check for existing pending entry
    const connection = await getDBConnection();
    try {
      const [pendingEntry] = await connection.execute(`
        SELECT story_entry_id FROM story_entry se
        JOIN turn t ON se.turn_id = t.turn_id
        JOIN story_writer sw ON t.story_writer_id = sw.story_writer_id
        WHERE sw.story_id = ? AND sw.discord_user_id = ? 
        AND se.entry_status = 'pending'
      `, [storyId, interaction.user.id]);
      
      if (pendingEntry.length > 0) {
        // Update existing pending entry
        await connection.execute(`
          UPDATE story_entry SET content = ?, created_at = NOW() 
          WHERE story_entry_id = ?
        `, [content, pendingEntry[0].story_entry_id]);
        var entryId = pendingEntry[0].story_entry_id;
      } else {
        // Create new pending entry
        const [turnInfo] = await connection.execute(`
          SELECT t.turn_id FROM turn t
          JOIN story_writer sw ON t.story_writer_id = sw.story_writer_id
          WHERE sw.story_id = ? AND sw.discord_user_id = ? AND t.turn_status = 1
        `, [storyId, interaction.user.id]);
        
        if (turnInfo.length === 0) {
          throw new Error('No active turn found');
        }
        
        const [result] = await connection.execute(`
          INSERT INTO story_entry (turn_id, content, entry_status, order_in_turn)
          VALUES (?, ?, 'pending', 1)
        `, [turnInfo[0].turn_id, content]);
        
        var entryId = result.insertId;
      }
    } finally {
      connection.release();
    }
    
    // Get timeout and create embed
    const timeoutMinutes = parseInt(await getConfigValue('cfgEntryTimeoutMinutes', guildId)) || 10;
    const expiresAt = new Date(Date.now() + (timeoutMinutes * 60 * 1000));
    const discordTimestamp = `<t:${Math.floor(expiresAt.getTime() / 1000)}:R>`;
    
    // Create preview embed
    const embed = await createPreviewEmbed(content, guildId, discordTimestamp);
    
    // Create confirmation buttons
    const btnSubmit = await getConfigValue('btnSubmit', guildId);
    const btnDiscard = await getConfigValue('btnDiscard', guildId);
    
    const confirmRow = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(`confirm_entry_${entryId}`)
          .setLabel(btnSubmit)
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`discard_entry_${entryId}`)
          .setLabel(btnDiscard)
          .setStyle(ButtonStyle.Danger)
      );
      
    await interaction.editReply({
      embeds: [embed],
      components: [confirmRow]
    });
    
    // Send DM reminder
    try {
      const txtDMReminder = await getConfigValue('txtDMReminder', guildId);
      const txtRecoveryInstructions = await getConfigValue('txtRecoveryInstructions', guildId);
      
      const user = await interaction.client.users.fetch(interaction.user.id);
      await user.send(`${txtDMReminder}\n\n${txtRecoveryInstructions}\n\n⏰ Expires: ${discordTimestamp}`);
    } catch (error) {
      console.log(`${formattedDate()}: [Guild ${guildId}] Could not send DM reminder to user ${interaction.user.id}`);
    }

  } catch (error) {
    console.error(`${formattedDate()}: [Guild ${interaction.guild.id}] Error in handleWriteModalSubmit:`, error);
    const txtEntryProcessFailed = await getConfigValue('txtEntryProcessFailed', interaction.guild.id);
    await interaction.editReply({
      content: txtEntryProcessFailed
    });
  }
}

/**
 * Validate if story exists and belongs to guild
 */
async function validateStoryAccess(storyId, guildId) {
  const connection = await getDBConnection();
  
  try {
    const [storyInfo] = await connection.execute(`
      SELECT * FROM story WHERE story_id = ?
    `, [storyId]);
    
    if (storyInfo.length === 0) {
      const txtStoryNotFound = await getConfigValue('txtStoryNotFound', guildId);
      return { success: false, error: txtStoryNotFound };
    }
    
    const story = storyInfo[0];
    
    if (story.guild_id !== guildId) {
      const txtStoryWrongGuild = await getConfigValue('txtStoryWrongGuild', guildId);
      return { success: false, error: txtStoryWrongGuild };
    }
    
    if (story.story_status !== 1) {
      const txtStoryNotActive = await getConfigValue('txtStoryNotActive', guildId);
      return { success: false, error: txtStoryNotActive };
    }
    
    return { success: true, story };
    
  } finally {
    connection.release();
  }
}

/**
 * Validate if user is the active writer for a story
 */
async function validateActiveWriter(userId, storyId) {
  const connection = await getDBConnection();
  
  try {
    const [writerInfo] = await connection.execute(`
      SELECT sw.discord_user_id as current_writer
      FROM turn t
      JOIN story_writer sw ON t.story_writer_id = sw.story_writer_id
      WHERE sw.story_id = ? AND t.turn_status = 1
    `, [storyId]);
    
    if (writerInfo.length === 0 || writerInfo[0].current_writer !== userId) {
      // Get guild_id for config lookup - we need this for error messages
      const [storyInfo] = await connection.execute(`
        SELECT guild_id FROM story WHERE story_id = ?
      `, [storyId]);
      
      const guildId = storyInfo[0]?.guild_id;
      const txtNotYourTurn = await getConfigValue('txtNotYourTurn', guildId);
      return { success: false, error: txtNotYourTurn };
    }
    
    return { success: true };
    
  } finally {
    connection.release();
  }
}

/**
 * Create entry preview embed
 */
async function createPreviewEmbed(content, guildId, discordTimestamp) {
  const txtPreviewTitle = await getConfigValue('txtPreviewTitle', guildId);
  const txtPreviewDescription = await getConfigValue('txtPreviewDescription', guildId);
  const txtPreviewExpires = await getConfigValue('txtPreviewExpires', guildId);
  const lblYourEntry = await getConfigValue('lblYourEntry', guildId);
  const lblEntryContinued = await getConfigValue('lblEntryContinued', guildId);
  const lblEntryStats = await getConfigValue('lblEntryStats', guildId);
  const txtEntryStatsTemplate = await getConfigValue('txtEntryStatsTemplate', guildId);
  
  const embed = new EmbedBuilder()
    .setTitle(txtPreviewTitle)
    .setDescription(txtPreviewDescription)
    .setColor(0xffd700)
    .setFooter({ text: replaceTemplateVariables(txtPreviewExpires, { timestamp: discordTimestamp }) });
    
  // Handle long content by splitting into multiple fields
  const maxFieldLength = 1024;
  if (content.length <= maxFieldLength) {
    embed.addFields({
      name: lblYourEntry,
      value: content,
      inline: false
    });
  } else {
    let remainingContent = content;
    let fieldCount = 1;
    
    while (remainingContent.length > 0) {
      const fieldContent = remainingContent.length > maxFieldLength 
        ? remainingContent.substring(0, maxFieldLength)
        : remainingContent;
        
      const fieldName = fieldCount === 1 
        ? lblYourEntry 
        : replaceTemplateVariables(lblEntryContinued, { count: fieldCount });
        
      embed.addFields({
        name: fieldName,
        value: fieldContent,
        inline: false
      });
      
      remainingContent = remainingContent.substring(maxFieldLength);
      fieldCount++;
    }
  }
  
  // Add stats
  const wordCount = content.split(/\s+/).filter(word => word.length > 0).length;
  const statsText = replaceTemplateVariables(txtEntryStatsTemplate, {
    char_count: content.length,
    word_count: wordCount
  });
    
  embed.addFields({
    name: lblEntryStats,
    value: statsText,
    inline: true
  });
  
  return embed;
}

/**
 * Handle /story list command
 */
async function handleListStories(interaction) {
  try {
    const guildId = interaction.guild.id;
    const filter = interaction.options.getString('filter') || 'all';
    const page = interaction.options.getInteger('page') || 1;
    const itemsPerPage = 5;

    await interaction.deferReply({ ephemeral: true });

    const stories = await getStoriesPaginated(guildId, filter, page, itemsPerPage, interaction.user.id);

    if (stories.data.length === 0) {
      const txtNoStoriesFound = await getConfigValue('txtNoStoriesFound', guildId);
      const filterTitle = await getFilterTitle(filter, guildId);
      await interaction.editReply({
        content: replaceTemplateVariables(txtNoStoriesFound, { filter_name: filterTitle })
      });
      return;
    }

    // Get configurable text for embed
    const txtStoriesPageTitle = await getConfigValue('txtStoriesPageTitle', guildId);
    const txtStoriesPageDesc = await getConfigValue('txtStoriesPageDesc', guildId);
    const filterTitle = await getFilterTitle(filter, guildId);
    
    const embed = new EmbedBuilder()
      .setTitle(replaceTemplateVariables(txtStoriesPageTitle, {
        filter_title: filterTitle,
        page: page,
        total_pages: stories.totalPages
      }))
      .setDescription(replaceTemplateVariables(txtStoriesPageDesc, {
        showing: stories.data.length,
        total: stories.totalCount
      }))
      .setColor(0x3498db)
      .setTimestamp();

    // Add story fields
    for (const story of stories.data) {
      const statusIcon = getStatusIcon(story.story_status);
      const joinStatus = story.can_join 
        ? await getConfigValue('txtCanJoin', guildId)
        : await getConfigValue('txtCannotJoin', guildId);
      const currentTurn = await getCurrentTurnInfo(story, guildId);
      
      // Get configurable labels
      const lblStoryStatus = await getConfigValue('lblStoryStatus', guildId);
      const lblStoryTurn = await getConfigValue('lblStoryTurn', guildId);
      const lblStoryWriters = await getConfigValue('lblStoryWriters', guildId);
      const lblStoryMode = await getConfigValue('lblStoryMode', guildId);
      const lblStoryCreator = await getConfigValue('lblStoryCreator', guildId);
      const modeText = story.quick_mode 
        ? await getConfigValue('txtModeQuick', guildId)
        : await getConfigValue('txtModeNormal', guildId);
      
      embed.addFields({
        name: `${statusIcon} "${story.title}" (#${story.story_id})`,
        value: `├ ${lblStoryStatus} ${getStatusText(story.story_status, guildId)} • ${lblStoryTurn} ${currentTurn}
                ├ ${lblStoryWriters} ${story.writer_count}/${story.max_writers || '∞'} • ${lblStoryMode} ${modeText}
                └ ${lblStoryCreator} <@${story.creator_id}> • ${joinStatus}`,
        inline: false
      });
    }

    // Create navigation buttons
    const components = [];
    
    // Navigation row
    const navRow = new ActionRowBuilder();
    
    if (stories.totalPages > 1) {
      navRow.addComponents(
        new ButtonBuilder()
          .setCustomId(`story_list_${filter}_${page - 1}`)
          .setLabel('◀️ Prev')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(page === 1),
        new ButtonBuilder()
          .setCustomId(`story_list_${filter}_${page + 1}`)
          .setLabel('Next ▶️')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(page === stories.totalPages)
      );
    }
    
    navRow.addComponents(
      new ButtonBuilder()
        .setCustomId('story_filter')
        .setLabel('🔍 Filter')
        .setStyle(ButtonStyle.Secondary)
    );
    
    components.push(navRow);

    // Quick join menu if there are joinable stories
    const joinableStories = stories.data.filter(s => s.can_join);
    if (joinableStories.length > 0) {
      const joinRow = new ActionRowBuilder()
        .addComponents(
          new StringSelectMenuBuilder()
            .setCustomId('story_quick_join')
            .setPlaceholder('Quick join a story...')
            .addOptions(joinableStories.map(s => ({
              label: `${s.title} (#${s.story_id})`,
              value: s.story_id.toString(),
              description: `${s.writer_count}/${s.max_writers || '∞'} writers • ${s.quick_mode ? 'Quick' : 'Normal'} mode`
            })))
        );
      components.push(joinRow);
    }

    await interaction.editReply({
      embeds: [embed],
      components
    });

  } catch (error) {
    console.error(`${formattedDate()}: [Guild ${interaction.guild.id}] Error in handleListStories:`, error);
    const txtStoryListFailed = await getConfigValue('txtStoryListFailed', interaction.guild.id);
    await interaction.editReply({
      content: txtStoryListFailed,
    });
  }
}

/**
 * Handle button interactions for story list
 */
async function handleButtonInteraction(interaction) {
  if (interaction.customId.startsWith('story_list_')) {
    await handleListNavigation(interaction);
  } else if (interaction.customId.startsWith('confirm_entry_') || interaction.customId.startsWith('discard_entry_')) {
    await handleEntryConfirmation(interaction);
  }
}

/**
 * Handle list navigation buttons
 */
async function handleListNavigation(interaction) {
  const [, , filter, pageStr] = interaction.customId.split('_');
  const page = parseInt(pageStr);
  
  // Update the message with new page
  const guildId = interaction.guild.id;
  const itemsPerPage = 5;
  
  await interaction.deferUpdate();
  
  const stories = await getStoriesPaginated(guildId, filter, page, itemsPerPage, interaction.user.id);
  
  // Get configurable text for embed
  const txtStoriesPageTitle = await getConfigValue('txtStoriesPageTitle', guildId);
  const txtStoriesPageDesc = await getConfigValue('txtStoriesPageDesc', guildId);
  const filterTitle = await getFilterTitle(filter, guildId);
  
  const embed = new EmbedBuilder()
    .setTitle(replaceTemplateVariables(txtStoriesPageTitle, {
      filter_title: filterTitle,
      page: page,
      total_pages: stories.totalPages
    }))
    .setDescription(replaceTemplateVariables(txtStoriesPageDesc, {
      showing: stories.data.length,
      total: stories.totalCount
    }))
    .setColor(0x3498db)
    .setTimestamp();

  for (const story of stories.data) {
    const statusIcon = getStatusIcon(story.story_status);
    const joinStatus = story.can_join 
      ? await getConfigValue('txtCanJoin', guildId)
      : await getConfigValue('txtCannotJoin', guildId);
    const currentTurn = await getCurrentTurnInfo(story, guildId);
    
    // Get configurable labels
    const lblStoryStatus = await getConfigValue('lblStoryStatus', guildId);
    const lblStoryTurn = await getConfigValue('lblStoryTurn', guildId);
    const lblStoryWriters = await getConfigValue('lblStoryWriters', guildId);
    const lblStoryMode = await getConfigValue('lblStoryMode', guildId);
    const lblStoryCreator = await getConfigValue('lblStoryCreator', guildId);
    const modeText = story.quick_mode 
      ? await getConfigValue('txtModeQuick', guildId)
      : await getConfigValue('txtModeNormal', guildId);
    
    embed.addFields({
      name: `${statusIcon} "${story.title}" (#${story.story_id})`,
      value: `├ ${lblStoryStatus} ${await getStatusText(story.story_status, guildId)} • ${lblStoryTurn} ${currentTurn}
              ├ ${lblStoryWriters} ${story.writer_count}/${story.max_writers || '∞'} • ${lblStoryMode} ${modeText}
              └ ${lblStoryCreator} <@${story.creator_id}> • ${joinStatus}`,
      inline: false
    });
  }

  // Update navigation buttons
  const navRow = new ActionRowBuilder();
  
  if (stories.totalPages > 1) {
    navRow.addComponents(
      new ButtonBuilder()
        .setCustomId(`story_list_${filter}_${page - 1}`)
        .setLabel('◀️ Prev')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page === 1),
      new ButtonBuilder()
        .setCustomId(`story_list_${filter}_${page + 1}`)
        .setLabel('Next ▶️')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page === stories.totalPages)
    );
  }
  
  navRow.addComponents(
    new ButtonBuilder()
      .setCustomId('story_filter')
      .setLabel('🔍 Filter')
      .setStyle(ButtonStyle.Secondary)
  );

  await interaction.editReply({
    embeds: [embed],
    components: [navRow]
  });
}

/**
 * Handle entry confirmation/discard
 */
async function handleEntryConfirmation(interaction) {
  const [action, , entryId] = interaction.customId.split('_');
  
  try {
    await interaction.deferUpdate();
    
    if (action === 'confirm') {
      await confirmEntry(entryId, interaction);
    } else if (action === 'discard') {
      await discardEntry(entryId, interaction);
    }
    
  } catch (error) {
    console.error(`${formattedDate()}: [Guild ${interaction.guild.id}] Error in handleEntryConfirmation:`, error);
    const txtActionFailed = await getConfigValue('txtActionFailed', interaction.guild.id);
    await interaction.editReply({
      content: txtActionFailed,
      components: []
    });
  }
}

/**
 * Confirm and finalize entry
 */
async function confirmEntry(entryId, interaction) {
  const connection = await getDBConnection();
  
  try {
    await connection.beginTransaction();
    
    // Update entry status to confirmed
    await connection.execute(`
      UPDATE story_entry SET entry_status = 'confirmed' WHERE story_entry_id = ?
    `, [entryId]);
    
    // Get story info for turn advancement
    const [entryInfo] = await connection.execute(`
      SELECT se.turn_id, sw.story_id, sw.discord_user_id
      FROM story_entry se
      JOIN turn t ON se.turn_id = t.turn_id  
      JOIN story_writer sw ON t.story_writer_id = sw.story_writer_id
      WHERE se.story_entry_id = ?
    `, [entryId]);
    
    if (entryInfo.length === 0) {
      throw new Error(`${formattedDate()}: [Guild ${interaction.guild.id}] Entry not found for ID ${entryId}`);
    }
    
    const { turn_id, story_id } = entryInfo[0];
    
    // End current turn
    await connection.execute(`
      UPDATE turn SET turn_status = 0, ended_at = NOW() WHERE turn_id = ?
    `, [turn_id]);
    
    // Advance to next writer (this will be implemented in storybot.js)
    // await NextTurn(connection, interaction, nextWriterId);
    
    await connection.commit();
    
    const txtEntrySubmitted = await getConfigValue('txtEntrySubmitted', interaction.guild.id);
    await interaction.editReply({
      content: txtEntrySubmitted,
      embeds: [],
      components: []
    });
    
  } catch (error) {
    await connection.rollback();
    console.error(`${formattedDate()}: [Guild ${interaction.guild.id}] Error in confirmEntry:`, error);
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * Discard pending entry
 */
async function discardEntry(entryId, interaction) {
  const connection = await getDBConnection();
  
  try {
    await connection.execute(`
      UPDATE story_entry SET entry_status = 'discarded' WHERE story_entry_id = ?
    `, [entryId]);
    
    const txtEntryDiscarded = await getConfigValue('txtEntryDiscarded', interaction.guild.id);
    await interaction.editReply({
      content: txtEntryDiscarded,
      embeds: [],
      components: []
    });
    
  } catch (error) {
    console.error(`${formattedDate()}: [Guild ${interaction.guild.id}] Error in discardEntry:`, error);
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * Handle select menu interactions
 */
async function handleSelectMenuInteraction(interaction) {
  if (interaction.customId === 'story_quick_join') {
    const storyId = interaction.values[0];
    
    await interaction.deferReply({ ephemeral: true });
    
    // Here we would call the join story function
    await interaction.editReply({
      content: `🎭 **Joining story #${storyId}**\n\n*Join functionality will be implemented next!*`
    });
  }
}

/**
 * Get paginated stories from database
 */
async function getStoriesPaginated(guildId, filter, page, itemsPerPage, userId) {
  const connection = await getDBConnection();
  
  try {
    let whereClause = 'WHERE s.guild_id = ?';
    let params = [guildId];
    
    // Apply filters
    switch (filter) {
      case 'joinable':
        whereClause += ' AND s.story_status IN (1, 2) AND s.allow_late_joins = 1 AND (s.max_writers IS NULL OR writer_count < s.max_writers)';
        whereClause += ' AND s.story_id NOT IN (SELECT DISTINCT story_id FROM story_writer WHERE discord_user_id = ? AND sw_status = 1)';
        params.push(userId);
        break;
      case 'mine':
        whereClause += ' AND s.story_id IN (SELECT DISTINCT story_id FROM story_writer WHERE discord_user_id = ? AND sw_status = 1)';
        params.push(userId);
        break;
      case 'active':
        whereClause += ' AND s.story_status = 1';
        break;
      case 'paused':
        whereClause += ' AND s.story_status = 2';
        break;
      case 'all':
      default:
        whereClause += ' AND s.story_status IN (1, 2)';
        break;
    }
    
    // Get total count
    const [countResult] = await connection.execute(`
      SELECT COUNT(*) as total FROM (
        SELECT s.story_id 
        FROM story s
        LEFT JOIN story_writer sw ON s.story_id = sw.story_id AND sw.sw_status = 1
        GROUP BY s.story_id
        ${whereClause}
      ) as filtered_stories
    `, params);
    
    const totalCount = countResult[0].total;
    const totalPages = Math.ceil(totalCount / itemsPerPage);
    const offset = (page - 1) * itemsPerPage;
    
    // Get paginated results
    const [stories] = await connection.execute(`
      SELECT 
        s.*,
        COUNT(sw.story_writer_id) as writer_count,
        (SELECT discord_user_id FROM story_writer WHERE story_id = s.story_id ORDER BY joined_at ASC LIMIT 1) as creator_id,
        CASE 
          WHEN s.story_status IN (1, 2) 
           AND s.allow_late_joins = 1 
           AND (s.max_writers IS NULL OR COUNT(sw.story_writer_id) < s.max_writers)
           AND s.story_id NOT IN (SELECT DISTINCT story_id FROM story_writer WHERE discord_user_id = ? AND sw_status = 1)
          THEN 1 
          ELSE 0 
        END as can_join
      FROM story s
      LEFT JOIN story_writer sw ON s.story_id = sw.story_id AND sw.sw_status = 1
      GROUP BY s.story_id
      ${whereClause}
      ORDER BY s.updated_at DESC
      LIMIT ? OFFSET ?
    `, [...params, userId, itemsPerPage, offset]);
    
    return {
      data: stories,
      totalCount,
      totalPages,
      currentPage: page
    };
    
  } finally {
    connection.release();
  }
}

/**
 * Helper functions for story display
 */
async function getFilterTitle(filter, guildId) {
  const configKeys = {
    all: 'txtAllStories',
    joinable: 'txtJoinableStories',
    mine: 'txtMyStories',
    active: 'txtActiveStories',
    paused: 'txtPausedStories'
  };
  
  const configKey = configKeys[filter] || 'txtAllStories';
  return await getConfigValue(configKey, guildId);
}

function getStatusIcon(status) {
  const icons = {
    1: '🟢', // Active
    2: '⏸️', // Paused
    3: '🏁'  // Closed
  };
  return icons[status] || '❓';
}

async function getStatusText(status, guildId) {
  const configKeys = {
    1: 'txtActive',
    2: 'txtPaused', 
    3: 'txtClosed'
  };
  
  const configKey = configKeys[status];
  if (configKey) {
    return await getConfigValue(configKey, guildId);
  }
  return 'Unknown';
}

async function getCurrentTurnInfo(story, guildId) {
  if (story.story_status === 2) return await getConfigValue('txtPaused', guildId);
  if (story.story_status === 3) return await getConfigValue('txtClosed', guildId);
  
  // For active stories, get current turn info
  const connection = await getDBConnection();
  
  try {
    const [turnInfo] = await connection.execute(`
      SELECT sw.discord_display_name, t.started_at, s.turn_length_hours
      FROM turn t
      JOIN story_writer sw ON t.story_writer_id = sw.story_writer_id
      JOIN story s ON sw.story_id = s.story_id
      WHERE sw.story_id = ? AND t.turn_status = 1
      ORDER BY t.started_at DESC LIMIT 1
    `, [story.story_id]);
    
    if (turnInfo.length === 0) {
      return await getConfigValue('txtTurnWaiting', guildId);
    }
    
    const turn = turnInfo[0];
    const endTime = new Date(turn.started_at.getTime() + (turn.turn_length_hours * 60 * 60 * 1000));
    const timeLeft = endTime.getTime() - Date.now();
    
    if (timeLeft <= 0) {
      const txtTurnOverdue = await getConfigValue('txtTurnOverdue', guildId);
      return replaceTemplateVariables(txtTurnOverdue, { writer_name: turn.discord_display_name });
    }
    
    const hoursLeft = Math.ceil(timeLeft / (1000 * 60 * 60));
    const txtTurnTimeLeft = await getConfigValue('txtTurnTimeLeft', guildId);
    return replaceTemplateVariables(txtTurnTimeLeft, {
      writer_name: turn.discord_display_name,
      hours: hoursLeft
    });
    
  } catch (error) {
    return await getConfigValue('txtTurnUnknown', guildId);
  } finally {
    connection.release();
  }
}

async function getDBConnection() {
  const { DB } = await import('../utilities.js');
  const config = await import('../config.json', { assert: { type: 'json' } });
  const db = new DB(config.default.db);
  await db.connect();
  return db.connection;
}

export default {
  data,
  execute,
  handleModalSubmit,
  handleSecondModalSubmit,
  handleButtonInteraction,
  handleSelectMenuInteraction
};