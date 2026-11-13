import { EmbedBuilder } from 'discord.js';
import { getConfigValue, isGuildConfigured, log } from './utilities.js';

// Discord's hard caps for one message: the description of a single embed, and the
// combined total across every embed in the message. A broadcast is one shot to every
// server, so going over has to be caught before anything is sent, not after.
const EMBED_DESCRIPTION_LIMIT = 4096;
const EMBED_MESSAGE_TOTAL_LIMIT = 6000;

// Edit this before arming a broadcast, then flip BROADCAST_ARMED below to true.
// A line holding only ===== splits the announcement into separate embeds in the same post
// (the Hub Announcement Counter puts one there). Every backtick must be escaped as \` here,
// since this is a template literal: an unescaped one stops the bot from booting.
export const ANNOUNCEMENT = `# 📢 Round Robin Storybot - Changelog v3.2.1 → v3.10.0
### July–November 2026

It's been a long time between posts, so this one covers a lot! In addition to all this, we moved to a new host so all data is encrypted and the platform will be easier to manage. Thanks for writing with us!

## 💫 New Features
> - **Ground Rules** — Servers can now define a list of tone and conduct rules, and story creators pick which ones apply to their story. They display in the story's pinned status post and when writers join, so they know what they're agreeing to. The story thread also gets a post if the story's rules are changed. Each server defines up to ten rules in their own style, edited in \`/storyadmin setup\`, and they are set in the story's Metadata.
> 
> - **Ratings Filter** — A server-level setting limits story ratings to NR, G, and T ratings. Turn it on and the rating picker simply stops offering M and E. Existing stories revert to NR only when they are edited.

## 🌟 Major Additions
> - **Edit via Text File** — Export a full story as plain text from \`/story read\`, edit it, and import the .txt file back from Manage Entries in \`/story manage\`. Export and import can be done for individual entries from \`/story edit\`. 
> - **Change Turn Order and Writer** — Also via export, or turn edit, admins and story creators have control over who wrote a turn and its order in the story. You can access them via buttons on \`/story manage\`. In a full-story import file, move the block to reorder the story, or change the writer name to re-credit that turn. Deleting a block removes the turn. View changes in the entry's History.
> - **Add Page** — A new button on edit appears on the last page of an entry, so you can add past the pages it already has.
> - **Improved Editing Workflow** — Edit while reading a story, and the 'Edit Next Entry' button correctly advances.
> 
> - **Help System Rebuild and Interface Improvement** — Help pages were expanded, reordered and reworded extensively. Navigation buttons with a select menu let you read straight through without going back to the menu each time. As always, help files are also compiled in the FAQ forum on the Round Robin Hub Server.
> 
> - **Major Rework to All Control Panels** — The control panels to add and manage a story, set up the server, or manage users have been rebuilt. Content is split into tabs, with an indicator that tells you when you have unsaved changes, and many interface improvements throughout.
> - **Management Subpanels** — Manage Entries, Turns, and Users have their own improved subpanels from the \`/story manage\` panel.
> - **Admin Options Split by Permission** — \`/storyadmin setup\` now has two tabs: setting channels and roles appears to those with Manage Server rights; Ground Rules, Weekly Roundup, Hub Announcements and Ratings Filter are reachable by anyone with your server's Story Admin role.

## ✨ Minor Additions
> - **Join Button on New Story Post** — When a story is created, the announcement itself now has a Join button. Previously the only one was inside the story thread.
> - **Welcome Message on New Servers** — Running help or setup on a server that hasn't been configured now better explains what an admin needs to do.
> - **Word Count when Reading** — Shown in the footer of each entry.
=====
## 🛠️ Improvements
> - **Mentions in Entries Not Linked** — A user or channel mention in an entry is stored as text rather than a live Discord link, so entries read correctly everywhere.
> - **Clearer Validation Messages** — Turn length and delay start now clarify what inputs they accept.
> 
> - **HTML Export Embeds Images** — Images in story exports are embedded instead of linked to Discord URLs that expire. Images still need to be hosted elsewhere to display on external sites.
> - **External Image Links** — You can now embed an image using a secure url to any file ending in .png, .jpg, .gif or .webp, not only Discord attachments.
> - **Better Inline Images** — When an entry is posted to the story thread, or previewed before finalization, images show inline in the text, each in its own post, instead of a link that expired after a day. Also, \`/story read\` now displays images at the bottom of the pages where they appear in the text.

## 🐛 Bug Fixes
> - Saving an edit on long entries no longer loses paragraph breaks where the pages join! (This was a long-standing bug!)
> - The announcement for the writer of the next turn now shows after the just-completed entry text is fully posted.
> - A brief database hiccup caused a crash-loop on boot; it now retries.
> - All story Metadata fields are capped so they won't break the pinned status post.
> - The new writer join message had the wrong deadline when the turn had been extended or the story turn length edited.
> - Storybot commands used to appear as executable in DMs, but were never functional outside a server, so they've been removed.
> - Processes now re-check rather than trusting a cache, so if the bot is removed from a server it no longer fails.
> - Media channel image posts now show accurate story and turn numbers.
> - The delete and restore confirmation in Manage Entries is more clear.

## 👀 Coming Soon
> - Improvements to the organization of stories (chapters and series) are in development!

# ⚠️ New Bot Install ⚠️ 
> **Due to administrative issues, the Round Robin Storybot must be reinvited to all servers using this link:**
> 
> https://discord.com/oauth2/authorize?client_id=1570551318202949743&permissions=2252195219237888&scope=bot%20applications.commands
> 
> All existing data will be intact, we just need to switch over to a new app ID. If your story channels are private, open \`/storyadmin setup\` and press Save once after reinstall.
> 
> **Current installs will stop working on <t:1795190400:F>**`;

// Manual arm/disarm switch — the host has no way to run one-off scripts, so this
// is how a broadcast gets triggered: edit ANNOUNCEMENT above, flip this to true,
// push to main, restart the bot. Flip it back to false afterward. Unlike the FAQ
// and privacy-policy hub posts (idempotent edits-in-place), a broadcast is a
// one-shot send to every configured server's feed channel — deploy.js runs this
// step on every restart, so leaving this armed would resend on the next deploy too.
export const BROADCAST_ARMED = true;

// Sends ANNOUNCEMENT to the hub's announcements channel and every configured guild's
// story feed channel (skipping guilds that opted out via cfgChangelogEnabled), with the
// txtHubAnnouncementOptOut notice as a final embed. The announcement is cut at each =====
// line into one embed per part (see splitAnnouncement). Logs the character count and refuses
// to send at all if the message would exceed Discord's limits, since a broadcast cannot be
// taken back once sent. dryRun logs what would be sent without actually sending — used by
// the manual helper/broadcast.js script; the deploy-triggered path (see deploy.js) always
// sends for real. Both paths log the character count.
// Cuts the announcement at every line that holds only ===== (surrounding spaces allowed),
// trimming each part and dropping empty ones, so a stray separator can't send a blank embed.
// Exported for the unit test.
export function splitAnnouncement(text) {
  return text.split(/^[ \t]*=====[ \t]*$/m).map(part => part.trim()).filter(part => part.length > 0);
}

export async function sendBroadcast(client, connection, { dryRun = false } = {}) {
  const [hubServerId, hubAnnouncementsChannelId, announcementTitle, announcementFooter, announcementOptOut] = await Promise.all([
    getConfigValue(connection, 'cfgHubServerId', 1),
    getConfigValue(connection, 'cfgHubAnnouncementsChannelId', 1),
    getConfigValue(connection, 'txtHubAnnouncementTitle', 1),
    getConfigValue(connection, 'txtHubAnnouncementFooter', 1),
    getConfigValue(connection, 'txtHubAnnouncementOptOut', 1),
  ]);

  // The opt-out notice rides along as a second embed on every broadcast. getConfigValue
  // returns the key name when a key has no row at all, so treat that as missing rather
  // than posting a raw config key into every server's feed.
  const hasOptOut = announcementOptOut !== 'txtHubAnnouncementOptOut';
  if (!hasOptOut) {
    log('sendBroadcast: txtHubAnnouncementOptOut not configured — sending without the opt-out notice', { show: true, hub: true });
  }

  // Length guard. The host offers no way to preview a broadcast, so this is the only
  // place an oversized announcement can be caught. Discord measures the resolved string,
  // so an escaped backtick in ANNOUNCEMENT costs one character here, not two. Each part is
  // its own embed description, so each must fit EMBED_DESCRIPTION_LIMIT, and the title,
  // every part, the footer and the opt-out notice together must fit EMBED_MESSAGE_TOTAL_LIMIT.
  const parts = splitAnnouncement(ANNOUNCEMENT);
  const partLengths = parts.map(part => part.length);
  const longestPart = Math.max(0, ...partLengths);
  const optOutChars = hasOptOut ? announcementOptOut.length : 0;
  const bodyChars = partLengths.reduce((sum, n) => sum + n, 0);
  const totalChars = bodyChars + announcementTitle.length + announcementFooter.length + optOutChars;
  log(`sendBroadcast: announcement in ${parts.length} embed(s) of ${partLengths.join(' + ')} characters (each at most ${EMBED_DESCRIPTION_LIMIT}), ${totalChars} of ${EMBED_MESSAGE_TOTAL_LIMIT} across the whole message`, { show: true });

  if (parts.length === 0 || longestPart > EMBED_DESCRIPTION_LIMIT || totalChars > EMBED_MESSAGE_TOTAL_LIMIT) {
    log(`sendBroadcast failed: announcement can't be sent intact — ${parts.length} part(s) of ${partLengths.join(' + ') || 0} characters (each at most ${EMBED_DESCRIPTION_LIMIT}), whole message ${totalChars}/${EMBED_MESSAGE_TOTAL_LIMIT}. Edit ANNOUNCEMENT in broadcast.js and redeploy. Nothing was sent.`, { show: true, hub: true });
    return { sent: 0, skipped: 0 };
  }

  // The title goes on the first embed and the footer on the last announcement embed, so the
  // parts read as one post. The opt-out notice follows as its own embed, so its markdown
  // renders (footer text does not).
  const embeds = parts.map((part, i) => {
    const embed = new EmbedBuilder().setDescription(part).setColor(0xe91e63);
    if (i === 0) embed.setTitle(announcementTitle);
    if (i === parts.length - 1) embed.setFooter({ text: announcementFooter });
    return embed;
  });
  if (hasOptOut) {
    embeds.push(new EmbedBuilder().setDescription(announcementOptOut).setColor(0xe91e63));
  }

  // Post to the hub server's own announcements channel first — unlike the old
  // trigger, this message never originates there, so it won't show up unless
  // we send it explicitly.
  if (dryRun) {
    console.log(`[dry run] would send to hub announcements channel ${hubAnnouncementsChannelId}`);
  } else {
    try {
      const hubChannel = await client.channels.fetch(hubAnnouncementsChannelId);
      await hubChannel.send({ embeds });
      log(`sendBroadcast: sent to hub announcements channel (${hubAnnouncementsChannelId})`, { show: true });
    } catch (err) {
      log(`sendBroadcast: failed to send to hub announcements channel: ${err?.stack ?? err}`, { show: true });
    }
  }

  let sent = 0;
  let skipped = 0;
  for (const guild of client.guilds.cache.values()) {
    try {
      if (guild.id === hubServerId) { skipped++; continue; }
      if (!await isGuildConfigured(connection, guild.id)) { skipped++; continue; }
      const changelogEnabled = await getConfigValue(connection, 'cfgChangelogEnabled', guild.id);
      if (changelogEnabled === '0') { skipped++; continue; }
      const feedChannelId = await getConfigValue(connection, 'cfgStoryFeedChannelId', guild.id);

      if (dryRun) {
        console.log(`[dry run] would send to ${guild.name} (${guild.id}) — channel ${feedChannelId}`);
        sent++;
        continue;
      }

      const channel = await guild.channels.fetch(feedChannelId);
      if (!channel) { skipped++; continue; }
      await channel.send({ embeds });
      log(`sendBroadcast: sent to ${guild.name} (${guild.id})`, { show: true, guildName: guild.name });
      sent++;
    } catch (err) {
      if (err?.code === 'GuildChannelUnowned') {
        log(`sendBroadcast: skipped ${guild.name} (${guild.id}) — configured feed channel does not belong to this guild`, { show: true, guildName: guild.name });
      } else {
        log(`sendBroadcast: failed for ${guild.name} (${guild.id}): ${err?.stack ?? err}`, { show: true, guildName: guild.name });
      }
      skipped++;
    }
  }

  log(`sendBroadcast: complete — ${dryRun ? 'would send' : 'sent'} ${sent}, skipped ${skipped}`, { show: true });
  return { sent, skipped };
}
