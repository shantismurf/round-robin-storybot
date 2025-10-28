import { Client, GatewayIntentBits, EmbedBuilder } from 'discord.js';
import { StoryBot } from './storybot.js';
import { loadConfig } from './utilities.js';
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
      console.error('Failed to publish botContent', err, botContent);
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
      console.error(error);
    }
  }
  client.once('ready', async () => {
    console.log(`Discord client ready as ${client.user.tag}`);
    await bot.start();
    await loadCommands('./commands');
  });
  // Listen for slash commands
  client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isChatInputCommand()) return;
    console.log(`${formattedDate()}: ${interaction.user.username} in #${interaction.channel.name} triggered ${interaction.commandName}.`);
    try {;
      const command = interaction.client.commands.get(interaction.commandName);
      await command.execute(interaction);
    } catch (e) {
      console.log(e);
    }
  });
  await client.login(config.token);
}

main().catch(err => {
  console.error('Fatal error starting StoryBot:', err);
  process.exit(1);
});
