import { SlashCommandBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, StringSelectMenuBuilder, ComponentType } from 'discord.js';
import { getConfigValue, sanitizeModalInput, formattedDate } from '../utilities.js';
import { CreateStory } from '../storybot.js';

const data = new SlashCommandBuilder()
  .setName('story')
  .setDescription('Manage round-robin stories')
  .addSubcommand(subcommand =>
    subcommand
      .setName('add')
      .setDescription('Create a new round-robin story')
  );

async function execute(interaction) {
  if (interaction.options.getSubcommand() === 'add') {
    await handleAddStory(interaction);
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
  if (interaction.customId !== 'story_add_modal') return;

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
      errors.push(txtMustBeNo.replace('[Field label text]', await getConfigValue('lblTurnLength', guildId)));
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
      errors.push(txtMustBeNo.replace('[Field label text]', await getConfigValue('lblNoHours', guildId)));
    }

    // Validate delay writers
    const delayWriters = parseInt(delayWritersRaw) || 0;
    if (delayWritersRaw && (isNaN(delayWriters) || delayWriters < 0)) {
      errors.push(txtMustBeNo.replace('[Field label text]', await getConfigValue('lblNoWriters', guildId)));
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

export default {
  data,
  execute,
  handleModalSubmit,
  handleSecondModalSubmit
};