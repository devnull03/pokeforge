import Database from "better-sqlite3";
import path from "path";

const DB_PATH = path.join(process.cwd(), "mcpmarket.db");

let db: Database.Database;

function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    initializeDb(db);
  }
  return db;
}

function initializeDb(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      api_key TEXT UNIQUE,
      api_calls_used INTEGER NOT NULL DEFAULT 0,
      api_calls_limit INTEGER NOT NULL DEFAULT 100,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS servers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      url TEXT NOT NULL,
      website_url TEXT,
      color TEXT NOT NULL DEFAULT '#ff6b9d',
      icon TEXT NOT NULL DEFAULT '🌐',
      api_key TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (created_by) REFERENCES users(id)
    );
  `);
}

export default getDb;
