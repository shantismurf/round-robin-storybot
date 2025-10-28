import { EventEmitter } from 'events';
import { DB } from './utilities.js';

/**
 * StoryBot contains story logic and emits 'publish' events when it
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
  emitPublish(channelId, { title, author, description, footer, content, files } = {}) {
    const embedData = { title, author, description, footer };
    this.emit('publish', { channelId, content: content || null, embeds: [embedData], files: files || [] });
  }

  // Example helper for testing/demo: if you want index.js to trigger a demo
  // publish after startup, call this with a channel id from the config.
  async triggerDemoPublish() {
    if (!this.config.demoChannelId) return;
    this.emitPublish(this.config.demoChannelId, {
      title: 'Demo: Round-Robin Storybot is online',
      author: 'StoryBot',
      description: 'This is a demo publish emitted by StoryBot.',
      footer: 'demo'
    });
  }
}

// named export above
