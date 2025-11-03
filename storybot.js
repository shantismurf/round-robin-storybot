import { EventEmitter } from 'events';
import { DB, getConfigValue, formattedDate } from './utilities.js';
import { ChannelType, PermissionFlagsBits } from 'discord.js';

/**
 * StoryBot.js contains story engine logic and emits 'publish' events when it
 * wants something posted to Discord. index.js owns the Discord client and
 * listens for those events to perform posting.
 */
export class StoryBot extends EventEmitter {
  constructor(config) {
    super();
    this.config = config || {};
    this.db = new DB(config.db);
  }

  async start() {
    // initialize DB connections, schedulers, etc. (no Discord login here)
    await this.db.connect();
    console.log('StoryBot engine initialized');
  }

  async stop() {
    // stop internal timers/workers and DB
    await this.db.disconnect();
  }

  /**
   * Compose a simple publish payload and emit it. Payload is a plain object
   * so the caller (index.js) can convert to discord.js EmbedBuilder.
   */
  emitPublish(channelID, { title, author, description, footer, content, files } = {}) {
    const embedData = { title, author, description, footer };
    this.emit('publish', { channelId: channelID, content: content || null, embeds: [embedData], files: files || [] });
  }
}

/**
 * CreateStory function with explicit transaction handling
 */
export async function CreateStory(interaction, storyInput) {
  const connection = await getDBConnection();
  await connection.beginTransaction();
  
  try {
    const guild_id = interaction.guild.id;
    
    // Step 1: Insert story record
    const storyStatus = (storyInput.delayHours || storyInput.delayWriters) ? 2 : 1; // 2 = paused, 1 = active
    
    const [storyResult] = await connection.execute(
      `INSERT INTO story (guild_id, title, story_status, quick_mode, turn_length_hours, 
       timeout_reminder_percent, story_turn_privacy, story_delay_hours, story_delay_users) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        guild_id,
        storyInput.storyTitle,
        storyStatus,
        storyInput.quickMode,
        storyInput.turnLength,
        storyInput.timeoutReminder,
        storyInput.hideTurnThreads,
        storyInput.delayHours,
        storyInput.delayWriters
      ]
    );
    
    const storyId = storyResult.insertId;
    
    // Step 2: Create delay job if needed
    if (storyInput.delayHours) {
      const delayTime = new Date(Date.now() + (storyInput.delayHours * 60 * 60 * 1000));
      await connection.execute(
        `INSERT INTO job (job_type, payload, run_at, job_status) VALUES (?, ?, ?, ?)`,
        ['checkStoryDelay', JSON.stringify({ storyId }), delayTime, 0]
      );
    }
    
    // Step 3: Get story feed channel and create story thread
    const storyFeedChannelId = await getConfigValue('cfgStoryFeedChannelId', guild_id);
    const channel = await interaction.guild.channels.fetch(storyFeedChannelId);
    
    if (!channel) {
      throw new Error('Story feed channel not found');
    }
    
    // Get thread title template and replace variables
    const threadTitleTemplate = await getConfigValue('txtStoryThreadTitle', guild_id);
    const statusText = storyStatus === 1 
      ? await getConfigValue('txtActive', guild_id)
      : await getConfigValue('txtPaused', guild_id);
    
    const threadTitle = threadTitleTemplate
      .replace('[story_id]', storyId)
      .replace('[inputStoryTitle]', storyInput.storyTitle)
      .replace('[story_status]', statusText);
    
    const storyThread = await channel.threads.create({
      name: threadTitle,
      type: ChannelType.PublicThread,
      reason: `Story thread for story ID ${storyId}`
    });
    
    // Step 4: Update story with thread ID
    await connection.execute(
      `UPDATE story SET story_thread_id = ? WHERE story_id = ?`,
      [storyThread.id, storyId]
    );
    
    // Step 5: Add creator as first writer
    const writerResult = await StoryJoin(connection, interaction, storyInput, storyId);
    
    if (!writerResult.success) {
      throw new Error(writerResult.error);
    }
    
    // Commit transaction
    await connection.commit();
    
    return {
      success: true,
      message: `✅ **Story "${storyInput.storyTitle}" created successfully!**\n${writerResult.confirmationMessage}`
    };
    
  } catch (error) {
    // Rollback transaction on any error
    await connection.rollback();
    console.error(`${formattedDate()}: [Guild ${guild_id}] CreateStory failed:`, error);
    
    const txtThreadCreationFailed = await getConfigValue('txtThreadCreationFailed', interaction.guild.id);
    return {
      success: false,
      error: txtThreadCreationFailed
    };
  } finally {
    connection.release();
  }
}

/**
 * StoryJoin function - adds a writer to a story
 */
export async function StoryJoin(connection, interaction, storyInput, storyId) {
  try {
    const guild_id = interaction.guild.id;
    const userId = interaction.user.id;
    const displayName = interaction.member.displayName || interaction.user.displayName || interaction.user.username;
    const ao3Name = storyInput.ao3Name || displayName;
    
    // Check if user already joined this story
    const [existingWriter] = await connection.execute(
      `SELECT story_writer_id FROM story_writer WHERE story_id = ? AND discord_user_id = ?`,
      [storyId, userId]
    );
    
    if (existingWriter.length > 0) {
      const txtAlreadyJoined = await getConfigValue('txtAlreadyJoined', guild_id);
      return {
        success: false,
        error: txtAlreadyJoined
      };
    }
    
    // Insert story_writer record
    const [writerResult] = await connection.execute(
      `INSERT INTO story_writer (story_id, discord_user_id, discord_display_name, AO3_name, turn_privacy) 
       VALUES (?, ?, ?, ?, ?)`,
      [storyId, userId, displayName, ao3Name, storyInput.keepPrivate]
    );
    
    const storyWriterId = writerResult.insertId;
    
    // Check story delay status
    const delayResult = await checkStoryDelay(connection, storyId);
    
    let confirmationMessage = '';
    let shouldStartTurn = false;
    
    if (delayResult.madeActive) {
      // Story became active, start turn
      shouldStartTurn = true;
      const txtStoryActive = await getConfigValue('txtStoryActive', guild_id);
      confirmationMessage += `\n${txtStoryActive}`;
    } else if (delayResult.writerDelayMessage) {
      confirmationMessage += `\n${delayResult.writerDelayMessage}`;
    } else if (delayResult.hourDelayMessage) {
      confirmationMessage += `\n${delayResult.hourDelayMessage}`;
    }
    
    if (shouldStartTurn) {
      const turnResult = await NextTurn(connection, interaction, storyWriterId);
      if (turnResult.dmMessage) {
        confirmationMessage += `\n${turnResult.dmMessage}`;
      }
    }
    
    return {
      success: true,
      confirmationMessage,
      storyWriterId
    };
    
  } catch (error) {
    console.error(`${formattedDate()}: [Guild ${guild_id}] StoryJoin failed:`, error);
    const txtStoryJoinFail = await getConfigValue('txtStoryJoinFail', interaction.guild.id);
    return {
      success: false,
      error: txtStoryJoinFail
    };
  }
}

/**
 * checkStoryDelay function - checks if story should be activated
 */
export async function checkStoryDelay(connection, storyId) {
  try {
    // Get story details
    const [storyRows] = await connection.execute(
      `SELECT story_status, story_delay_hours, story_delay_users, created_at, turn_length_hours, guild_id 
       FROM story WHERE story_id = ?`,
      [storyId]
    );
    
    if (storyRows.length === 0) {
      return { madeActive: false };
    }
    
    const story = storyRows[0];
    let shouldActivate = false;
    let writerDelayMessage = '';
    let hourDelayMessage = '';
    
    // Check writer count delay
    if (story.story_delay_users && story.story_status === 2) {
      const [writerCount] = await connection.execute(
        `SELECT COUNT(*) as count FROM story_writer WHERE story_id = ? AND sw_status = 1`,
        [storyId]
      );
      
      const currentWriters = writerCount[0].count;
      
      if (currentWriters >= story.story_delay_users) {
        shouldActivate = true;
      } else {
        const needed = story.story_delay_users - currentWriters;
        const txtMoreWritersDelay = await getConfigValue('txtMoreWritersDelay', story.guild_id);
        writerDelayMessage = txtMoreWritersDelay.replace('X', needed);
      }
    }
    
    // Check hour delay
    if (story.story_delay_hours && story.story_status === 2) {
      const delayEndTime = new Date(story.created_at.getTime() + (story.story_delay_hours * 60 * 60 * 1000));
      
      if (Date.now() >= delayEndTime.getTime()) {
        shouldActivate = true;
      } else {
        const hoursLeft = Math.ceil((delayEndTime.getTime() - Date.now()) / (1000 * 60 * 60));
        const txtHoursDelay = await getConfigValue('txtHoursDelay', story.guild_id);
        hourDelayMessage = txtHoursDelay.replace('X', hoursLeft);
      }
    }
    
    // Activate story if conditions met
    if (shouldActivate && story.story_status === 2) {
      await connection.execute(
        `UPDATE story SET story_status = 1 WHERE story_id = ?`,
        [storyId]
      );
      
      // Pick next writer and start turn
      const nextWriterId = await PickNextWriter(connection, storyId);
      if (nextWriterId) {
        // This will be handled by the calling function
      }
      
      return { madeActive: true };
    }
    
    return {
      madeActive: false,
      writerDelayMessage,
      hourDelayMessage
    };
    
  } catch (error) {
    console.error(`${formattedDate()}: [Guild ${story?.guild_id || 'unknown'}] checkStoryDelay failed for story ${storyId}:`, error);
    return { madeActive: false };
  }
}

/**
 * PickNextWriter function - selects next writer based on story order type
 */
export async function PickNextWriter(connection, storyId) {
  // Get current active writer ID
  const [activeTurn] = await connection.execute(
    `SELECT sw.story_writer_id FROM turn t
     JOIN story_writer sw ON t.story_writer_id = sw.story_writer_id  
     WHERE sw.story_id = ? AND t.turn_status = 1
     ORDER BY t.started_at DESC LIMIT 1`,
    [storyId]
  );
  const currentWriterId = activeTurn.length > 0 ? activeTurn[0].story_writer_id : null;
  
  // Get story order type
  const [storyData] = await connection.execute(
    `SELECT story_order_type FROM story WHERE story_id = ?`,
    [storyId]
  );
  const { story_order_type } = storyData[0];
  
  let orderClause;
  switch (story_order_type) {
    case 1: // Random
    default:
      orderClause = '';
      break;
    case 2: // Round-robin by join time
      orderClause = 'ORDER BY joined_at';
      break;
    case 3: // Fixed order
      orderClause = 'ORDER BY writer_order';
      break;
  }
  const [writers] = await connection.execute(
    `SELECT story_writer_id FROM story_writer 
     WHERE story_id = ? AND sw_status = 1 ${orderClause}`,
    [storyId]
  );
  if (!currentWriterId) {
    // No active turn - default to first writer
    return writers[0].story_writer_id;
  }

  // Random selection (exclude current writer)
  if (story_order_type === 1) {
    const randomWriters = currentWriterId 
      ? writers.filter(w => w.story_writer_id !== currentWriterId)
      : writers;
    return randomWriters[Math.floor(Math.random() * randomWriters.length)].story_writer_id;
  }

  // Sequential selection (same for both round-robin and fixed)
  const currentIndex = writers.findIndex(w => w.story_writer_id === currentWriterId);
  const nextIndex = (currentIndex + 1) % writers.length;
  return writers[nextIndex].story_writer_id;
}

/**
 * NextTurn function - creates a new turn for a story
 */
export async function NextTurn(connection, interaction, storyWriterId) {
  try {
    const guild_id = interaction.guild.id;
    
    // Get story and writer info
    const [writerInfo] = await connection.execute(
      `SELECT sw.story_id, sw.discord_user_id, sw.discord_display_name, sw.turn_privacy,
              s.quick_mode, s.turn_length_hours, s.story_thread_id 
       FROM story_writer sw 
       JOIN story s ON sw.story_id = s.story_id 
       WHERE sw.story_writer_id = ?`,
      [storyWriterId]
    );
    
    if (writerInfo.length === 0) {
      throw new Error('Writer not found');
    }
    
    const writer = writerInfo[0];
    
    // Insert turn record
    const [turnResult] = await connection.execute(
      `INSERT INTO turn (story_writer_id, started_at, turn_status) VALUES (?, NOW(), 1)`,
      [storyWriterId]
    );
    
    const turnId = turnResult.insertId;
    
    let threadId = null;
    let dmMessage = '';
    
    // Create private thread if normal mode
    if (!writer.quick_mode) {
      const storyFeedChannelId = await getConfigValue('cfgStoryFeedChannelId', guild_id);
      const channel = await interaction.guild.channels.fetch(storyFeedChannelId);
      
      // Get turn number
      const turnNumber = await getTurnNumber(connection, writer.story_id);
      
      // Get turn end time
      const turnEndTime = turnEndTimeFunction(turnId, writer.turn_length_hours);
      const discordTimestamp = `<t:${Math.floor(turnEndTime.getTime() / 1000)}:F>`;
      
      // Create thread title
      const threadTitleTemplate = await getConfigValue('txtTurnThreadTitle', guild_id);
      const threadTitle = threadTitleTemplate
        .replace('[story_id]', writer.story_id)
        .replace('[storyTurnNumber]', turnNumber)
        .replace('[user display name]', writer.discord_display_name)
        .replace('[turnEndTime]', discordTimestamp);
      
      // Create thread based on privacy setting
      const thread = await channel.threads.create({
        name: threadTitle,
        type: writer.turn_privacy ? ChannelType.PrivateThread : ChannelType.PublicThread,
        reason: `Turn thread for story ${writer.story_id}`
      });
      
      threadId = thread.id;
      
      // Set permissions
      if (writer.turn_privacy) {
        // Private thread - add admin role
        const adminRole = interaction.guild.roles.cache.find(r => r.name === 'Round Robin Admin');
        if (adminRole) {
          await thread.members.add(interaction.user.id);
          // Add admin users individually (Discord limitation)
        }
      } else {
        // Public thread - set permission overwrites
        await thread.permissionOverwrites.create(interaction.guild.roles.everyone, {
          SendMessages: false,
          AddReactions: true,
          ViewChannel: true
        });
        
        await thread.permissionOverwrites.create(interaction.user.id, {
          SendMessages: true,
          ViewChannel: true
        });
        
        const adminRole = interaction.guild.roles.cache.find(r => r.name === 'Round Robin Admin');
        if (adminRole) {
          await thread.permissionOverwrites.create(adminRole.id, {
            SendMessages: true,
            ManageMessages: true,
            ViewChannel: true
          });
        }
      }
      
      // Update turn with thread ID
      await connection.execute(
        `UPDATE turn SET thread_id = ? WHERE turn_id = ?`,
        [threadId, turnId]
      );
    }
    
    // Send DM or mention
    const txtDMTurnStart = await getConfigValue('txtDMTurnStart', guild_id);
    const linkToUse = threadId || writer.story_thread_id;
    
    try {
      // Try to send DM
      const user = await interaction.client.users.fetch(writer.discord_user_id);
      await user.send(`${txtDMTurnStart}\nThread: <#${linkToUse}>`);
      dmMessage = 'DM sent successfully';
    } catch (dmError) {
      // DM failed, send mention in channel
      const txtMentionTurnStart = await getConfigValue('txtMentionTurnStart', guild_id);
      const storyFeedChannelId = await getConfigValue('cfgStoryFeedChannelId', guild_id);
      const channel = await interaction.guild.channels.fetch(storyFeedChannelId);
      
      await channel.send(`<@${writer.discord_user_id}> ${txtMentionTurnStart}\nThread: <#${linkToUse}>`);
      dmMessage = 'Mention sent in channel';
    }
    
    return {
      success: true,
      turnId,
      threadId,
      dmMessage
    };
    
  } catch (error) {
    console.error(`${formattedDate()}: [Guild ${guild_id}] NextTurn failed:`, error);
    return {
      success: false,
      error: 'Failed to create turn'
    };
  }
}

/**
 * Helper function to get turn number for a story
 */
async function getTurnNumber(connection, storyId) {
  const [result] = await connection.execute(
    `SELECT COUNT(*) + 1 as turn_number FROM turn t 
     JOIN story_writer sw ON t.story_writer_id = sw.story_writer_id  
     WHERE sw.story_id = ?`,
    [storyId]
  );
  return result[0].turn_number;
}

/**
 * turnEndTime function - calculates when a turn ends
 */
export function turnEndTimeFunction(turnId, turnLengthHours) {
  // For now, calculate from current time + turn length
  // In a real implementation, you'd get the turn's started_at from database
  return new Date(Date.now() + (turnLengthHours * 60 * 60 * 1000));
}

/**
 * Helper to get database connection
 */
async function getDBConnection() {
  // This should return a connection from your DB pool
  // For now, assume we have access to the global connection
  const { DB } = await import('./utilities.js');
  const config = await import('./config.json', { assert: { type: 'json' } });
  const db = new DB(config.default.db);
  await db.connect();
  return db.connection;
}
