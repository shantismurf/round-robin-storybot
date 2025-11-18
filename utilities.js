import fs from 'fs';
import path from 'path';
import mysql from 'mysql2/promise';

export function loadConfig() {
  const cfgPath = path.resolve(process.cwd(), 'config.json');
  if (!fs.existsSync(cfgPath)) {
    console.error(`${formattedDate()}: Missing config.json. Copy config.example.json and fill values.`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
}
export function formattedDate() {
    let now = new Date();
    now = now.toISOString().replace(/\.\d+Z$/, '')
    now = now.replace('T', ' ');
    return now;
}
export class DB {
  constructor(dbConfig) {
    this.dbConfig = dbConfig;
    this.connection = null;
  }
  
  async connect() {
    try {
      this.connection = await mysql.createConnection({
        host: this.dbConfig.host,
        port: this.dbConfig.port,
        user: this.dbConfig.user,
        password: this.dbConfig.password,
        database: this.dbConfig.database
      });
      console.log('Database connected successfully');
      return this.connection;
    } catch (error) {
      console.error(`${formattedDate()}: Database connection failed:`, error.message);
      throw error;
    }
  }
  
  async disconnect() {
    if (this.connection) {
      try {
        await this.connection.end();
        this.connection = null;
        console.log('Database disconnected successfully');
      } catch (error) {
        console.error(`${formattedDate()}: Database disconnection failed:`, error.message);
        throw error;
      }
    }
  }
} 

// Sanitize input for Discord embed fields
export function sanitize(input, maxLength = 1021) {
    input = (!input ? '' : input);
    input = input
        .replace(/&quot;|&#34;/g, '\"')
        .replace(/&amp;|&#38;/g, '&')
        .replace(/&apos;|&#39;/g, '\'')
        .replace(/&nbsp;/g, ' ');
    //Special characters such as asterisks (*), underscores (_), and tildes (~) 
    //that are to be displayed must be escaped with the \ character.
    input = input
        .replace(/[\*]/g, '\\*')
        .replace(/[\_]/g, '\\_')
        .replace(/[\~]/g, '\\~');
    //replace common html tags with markdown
    input = input
        .replace(/<p[^>]*>/gi, '')
        .replace(/<\/p>/gi, '\n\n')
        .replace(/<s>/gi, '~~')
        .replace(/<\/s>/gi, '~~')
        .replace(/<i>/gi, '*')
        .replace(/<\/i>/gi, '*')
        .replace(/<b>/gi, '**')
        .replace(/<\/b>/gi, '**')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]*>/gi, '')
        .replace(/\n\n\n/gi, '\n\n'); //remove excess new lines
    if (input.length > maxLength) {  //limit values to maxLength or 1024(1021+3) characters
        input = input.substring(0, maxLength) + '...';
    }
    return input;
}
export function sanitizeModalInput(input, maxLength = 1024) {
    if (!input) return '';
    return input
        .trim()                                    // Remove leading/trailing whitespace
        .replace(/[\u200B-\u200D\uFEFF]/g, '')    // Remove zero-width chars
        .replace(/\s+/g, ' ')                     // Normalize whitespace
        .substring(0, maxLength);                 // Flexible length limit
}

export async function getConfigValue(connection,connection, key, guildID = 1) {
  try { // Get language code for this guild (system default is 'en')
    let languageCode = 'en';
    if (guildID !== 1) {
      const [langRows] = await connection.execute(
        'SELECT config_value FROM config WHERE config_key = ? AND guild_id = ?',
        ['cfgLanguageCode', guildID]
      );
      languageCode = langRows[0]?.config_value || 'en';
    }
    let [configRows] = await connection.execute(
      'SELECT config_value FROM config WHERE config_key = ? AND guild_id = ?',
      [key, guildID]
    );
    let configValue = configRows[0]?.config_value;
    // Fall back to system defaults for current language if no custom value present
    if (!configValue) {
      [configRows] = await connection.execute(
        'SELECT config_value FROM config WHERE config_key = ? AND language_code = ? AND guild_id = 1',
        [key, languageCode]
      );
      configValue = configRows[0]?.config_value;
    }
    return configValue || key;
  } catch (error) {
    console.error(`${formattedDate()}: [Guild ${guildID}] Config lookup failed for key '${key}':`, error);
    return key;
  }
}

export async function sendUserMessage(connection, interaction, storyWriterId, cfgMessageKey) {
  // Get writer and story info
  const [writerInfo] = await connection.execute(
    `SELECT sw.discord_user_id, s.guild_id 
     FROM story_writer sw 
     JOIN story s ON sw.story_id = s.story_id 
     WHERE sw.story_writer_id = ?`,
    [storyWriterId]
  );
  const { discord_user_id, guild_id } = writerInfo[0];
  
  // Get messages from config, use dm key name to get mention key name
  const dmMessage = await getConfigValue(connection,cfgMessageKey, guild_id);
  const mentionKey = cfgMessageKey.replace('txtDM', 'txtMention'); // txtDMTurnStart -> txtMentionTurnStart
  const mentionMessage = await getConfigValue(connection,mentionKey, guild_id);
  
  try {
    const user = await interaction.client.users.fetch(discord_user_id);
    await user.send(dmMessage);
    return `${formattedDate()}: [Guild ${guild_id}] ` + cfgMessageKey + ' DM sent successfully';
  } catch (dmError) {
    const storyFeedChannelId = await getConfigValue(connection,'cfgStoryFeedChannelId', guild_id);
    const channel = await interaction.guild.channels.fetch(storyFeedChannelId);
    await channel.send(`<@${discord_user_id}> ${mentionMessage}`);
    return `${formattedDate()}: [Guild ${guild_id}] ` + cfgMessageKey + ' Mention sent in channel';
  }
}

export function replaceTemplateVariables(template, keyValueMap) {
  let result = template;
  for (const [key, value] of Object.entries(keyValueMap)) {
    result = result.replaceAll(`[${key}]`, value);
  }
  return result;
}

/**
 * Creates a Discord thread with appropriate permissions
 * @param {Object} interaction - Discord interaction object
 * @param {string} guildID - Guild ID
 * @param {Object} keyValueMap - Configuration object containing:
 *   - titleTemplateKey: Config key for thread title template
 *   - threadType: ChannelType.PublicThread or ChannelType.PrivateThread
 *   - reason: Reason for audit log
 *   - targetUserId: (optional) User ID for thread permissions
 *   - Any template variables for title replacement (story_id, etc.)
 * @returns {Object} Created Discord thread
 */
export async function createThread(interaction, guildID, keyValueMap) {
  // Set up thread configuration
  const { titleTemplateKey, threadType, reason, targetUserId } = keyValueMap;
  const storyFeedChannelId = await getConfigValue(connection,'cfgStoryFeedChannelId', guildID);
  const channel = await interaction.guild.channels.fetch(storyFeedChannelId);
  
  if (!channel) {
    throw new Error(`${formattedDate()}: [Guild ${guildID}] Story feed channel not found`);
  }
  
  // Get admin role (used for both public and private thread permissions)
  const adminRoleName = await getConfigValue(connection,'cfgAdminRoleName', guildID);
  const adminRole = interaction.guild.roles.cache.find(r => r.name === adminRoleName);
  
  if (!adminRole) {
    console.error(`${formattedDate()}: [Guild ${guildID}] Admin role '${adminRoleName}' not found - skipping admin permissions`);
  }
  
  // Get and build thread title
  const titleTemplate = await getConfigValue(connection,titleTemplateKey, guildID);
  const threadTitle = replaceTemplateVariables(titleTemplate, keyValueMap);
  
  // Create thread
  const thread = await channel.threads.create({
    name: threadTitle,
    type: threadType,
    reason: reason
  });
  
  // Set permissions if needed
  if (threadType === ChannelType.PublicThread && targetUserId) {
    // Public thread with restricted permissions
    await thread.permissionOverwrites.create(interaction.guild.roles.everyone, {
      SendMessages: false,
      AddReactions: true,
      ViewChannel: true
    });
    
    await thread.permissionOverwrites.create(targetUserId, {
      SendMessages: true,
      ViewChannel: true
    });
    
    if (adminRole) {
      await thread.permissionOverwrites.create(adminRole.id, {
        SendMessages: true,
        ManageMessages: true,
        ViewChannel: true
      });
    }
  } else if (threadType === ChannelType.PrivateThread && targetUserId) {
    // Private thread - add target user and admin
    await thread.members.add(targetUserId);
    if (adminRole) {
      // Add each admin user individually (Discord limitation for private threads)
      for (const member of adminRole.members.values()) {
        try {
          await thread.members.add(member.id);
        } catch (error) {
          console.error(`${formattedDate()}: [Guild ${guildID}] Failed to add admin ${member.displayName} to private thread:`, error);
        }
      }
    }
  }
  
  return thread;
}