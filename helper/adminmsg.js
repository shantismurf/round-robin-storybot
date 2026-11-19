import { Client, GatewayIntentBits } from 'discord.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
// --config <file> picks another config, e.g. --config config.old.json to log in as the old bot
// after the 2026-11-20 switch (its token stays valid until 2026-11-22). Default: config.json.
const configArg = process.argv.indexOf('--config');
const configFile = configArg !== -1 ? process.argv[configArg + 1] : 'config.json';
const config = JSON.parse(readFileSync(resolve(__dirname, configFile), 'utf8'));

const USER_IDS = [
/*redacted*/
];

const MESSAGE = `Hi! This is Shantismurf, the developer of Round Robin StoryBot, sending you a one-time direct message through the bot.

The bot is moving to a new Discord application, and the copy on your server stops working on <t:1795190400:F>. To keep your stories going, please reinvite the bot with this link:
https://discord.com/oauth2/authorize?client_id=1570551318202949743&permissions=2252195219237888&scope=bot%20applications.commands

Nothing is lost. Your stories, entries, writers and settings will all be there when the new bot arrives. After you add it, open \`/storyadmin setup\` and press Save once so it picks up its channel permissions. Then you can remove the old bot.

If you have questions, or anything doesn't look right, come find me in the [Round Robin Storybot Hub](https://discord.gg/hKH9G5XFpJ). Sorry for the bother, and thanks for writing with us!

~Shantismurf`;

const SEND = process.argv.includes('--send');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('clientReady', async () => {
  console.log(`Logged in as ${client.user.tag}`);

  if (SEND) {
    // One DM per person, even if they own several servers
    for (const userId of [...new Set(USER_IDS)]) {
      try {
        const user = await client.users.fetch(userId);
        await user.send(MESSAGE);
        console.log(`✅ Sent to ${user.tag} (${userId})`);
      } catch (err) {
        console.log(`❌ Failed for ${userId}: ${err.message}`);
      }
      await new Promise(r => setTimeout(r, 1000));
    }
    console.log('Done.');
  } else {
    console.log('\n--- Current message ---\n');
    console.log(MESSAGE);
    const guilds = [...client.guilds.cache.values()];
    console.log(`\n--- Server owners, ${guilds.length} servers (USER_IDS format) ---\n`);
    for (const guild of guilds) {
      const owner = await guild.fetchOwner().catch(() => null);
      const id = owner?.user?.id ?? 'unknown';
      const username = owner?.user?.username ?? 'unknown';
      console.log(`'${id}', // ${username} (${guild.name}, ${guild.id})`);
    }
    console.log('');
  }

  client.destroy();
});

client.login(config.token);