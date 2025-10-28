import fs from 'fs';
import path from 'path';
import mysql from 'mysql2/promise';

export function loadConfig() {
  const cfgPath = path.resolve(process.cwd(), 'config.json');
  if (!fs.existsSync(cfgPath)) {
    console.error('Missing config.json. Copy config.example.json and fill values.');
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
// Sanitize input for Discord embed fields
export function sanitize(input) {
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
    if (input.length > 1024) {  //limit values to 1024 characters
        input = input.substring(0, 1021) + '...';
    }
    return input;
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
      console.error('Database connection failed:', error.message);
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
        console.error('Database disconnection failed:', error.message);
        throw error;
      }
    }
  }
} //close db class
/* db connection usage example 
const config = loadConfig();
const db = new DB(config.db);
await db.connect();
// ... use db.connection for queries
await db.disconnect();
*/