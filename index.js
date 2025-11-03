import { Client, GatewayIntentBits, EmbedBuilder, Collection, Events } from 'discord.js';
import { StoryBot } from './storybot.js';
import { loadConfig, formattedDate } from './utilities.js';
import fs from 'fs';

async function main() {
  const config = loadConfig();
  // create Discord client here (index.js owns the client)
  const client = new Client({ intents: [
    GatewayIntentBits.Guilds, 
    GatewayIntentBits.GuildMessages, 
    GatewayIntentBits.MessageContent] });
  // instantiate story engine
  const bot = new StoryBot(config);
  // Listen for publish events from StoryBot and post using the Discord client
  bot.on('publish', async (botContent) => {
    try {
      const channel = await client.channels.fetch(botContent.channelId);
      const embeds = (botContent.embeds || []).map(data => new EmbedBuilder()
        .setTitle(data.title || '')
        .setAuthor({ name: data.author || '' })
        .setDescription(data.description || '')
        .setFooter({ text: data.footer || '' })
      );
      await channel.send({ botContent: botContent.content || null, embeds, files: botContent.files });
    } catch (err) {
      console.error(`${formattedDate()}: Failed to publish botContent:`, err, botContent);
    }
  });
  // Create initiate slash commands
  client.commands = new Collection();
  async function loadCommands(dir) {
    try {
      const files = await fs.promises.readdir(dir);
      for (const file of files) {
        const filePath = `${dir}/${file}`;
        const stat = await fs.promises.stat(filePath);
        if (stat.isDirectory()) {
          await loadCommands(filePath);
        } else if (file.endsWith('.js')) {
          const command = await import(filePath);
          if (command.default && command.default.data) {
            console.log(`Loaded command: ${command.default.data.name}`);
            client.commands.set(command.default.data.name, command.default);
          } else {
            console.log(`Skipping file ${filePath} as it doesn't export a command`);
          }
        }
      }
    } catch (error) {
      console.error(`${formattedDate()}: Error loading commands:`, error);
    }
  }
  client.once('ready', async () => {
    console.log(`Discord client ready as ${client.user.tag}`);
    await bot.start();
    await loadCommands('./commands');
  });
  // Listen for slash commands and modal interactions
  client.on(Events.InteractionCreate, async interaction => {
    try {
      if (interaction.isChatInputCommand()) {
        console.log(`${formattedDate()}: ${interaction.user.username} in #${interaction.channel.name} triggered ${interaction.commandName}.`);
        const command = interaction.client.commands.get(interaction.commandName);
        if (command) {
          await command.execute(interaction);
        }
      } else if (interaction.isModalSubmit()) {
        console.log(`${formattedDate()}: ${interaction.user.username} submitted modal ${interaction.customId}`);
        
        // Handle story modal submissions
        if (interaction.customId === 'story_add_modal') {
          const storyCommand = interaction.client.commands.get('story');
          if (storyCommand && storyCommand.handleModalSubmit) {
            await storyCommand.handleModalSubmit(interaction);
          }
        } else if (interaction.customId.startsWith('story_add_modal_2_')) {
          const storyCommand = interaction.client.commands.get('story');
          if (storyCommand && storyCommand.handleSecondModalSubmit) {
            await storyCommand.handleSecondModalSubmit(interaction);
          }
        }
      }
    } catch (error) {
      const guildId = interaction?.guild?.id || 'unknown';
      console.error(`${formattedDate()}: [Guild ${guildId}] Error handling interaction:`, error);
      
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: 'An error occurred while processing your request.',
          ephemeral: true
        }).catch(console.error);
      } else if (interaction.deferred) {
        await interaction.editReply({
          content: 'An error occurred while processing your request.'
        }).catch(console.error);
      }
    }
  });
  await client.login(config.token);
}

main().catch(err => {
  console.error(`${formattedDate()}: Fatal error starting StoryBot:`, err);
  process.exit(1);
});
