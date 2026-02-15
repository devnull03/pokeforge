const Database = require("better-sqlite3");
const path = require("path");
const bcrypt = require("bcryptjs");

const DB_PATH = path.join(process.cwd(), "mcpmarket.db");
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// Create tables
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

// Clear existing data
db.exec("DELETE FROM servers");
db.exec("DELETE FROM users");

// Create admin user (password: admin123)
const adminPassword = bcrypt.hashSync("admin123", 10);
const adminApiKey = "mcp_admin_" + generateKey();
db.prepare(
  `INSERT INTO users (username, password, role, api_key, api_calls_limit) VALUES (?, ?, 'admin', ?, 10000)`
).run("admin", adminPassword, adminApiKey);

// Create demo user (password: user123)
const userPassword = bcrypt.hashSync("user123", 10);
const userApiKey = "mcp_user_" + generateKey();
db.prepare(
  `INSERT INTO users (username, password, role, api_key, api_calls_limit) VALUES (?, ?, 'user', ?, 100)`
).run("demo", userPassword, userApiKey);

// Insert 3 dummy MCP servers
const servers = [
  {
    name: "GitHub MCP",
    description:
      "Turn GitHub into an MCP server. Access repos, issues, PRs, and code search through natural language.",
    url: "https://mcp.mcpmarket.dev/github",
    website_url: "https://github.com",
    color: "#6bcbff",
    icon: "🐙",
    api_key: "sk_github_" + generateKey(),
  },
  {
    name: "Notion MCP",
    description:
      "Transform Notion workspaces into an MCP server. Query databases, pages, and content seamlessly.",
    url: "https://mcp.mcpmarket.dev/notion",
    website_url: "https://notion.so",
    color: "#ff6b9d",
    icon: "📝",
    api_key: "sk_notion_" + generateKey(),
  },
  {
    name: "Slack MCP",
    description:
      "Make Slack an MCP server. Send messages, search conversations, and manage channels via AI.",
    url: "https://mcp.mcpmarket.dev/slack",
    website_url: "https://slack.com",
    color: "#ffd93d",
    icon: "💬",
    api_key: "sk_slack_" + generateKey(),
  },
];

const insertServer = db.prepare(
  `INSERT INTO servers (name, description, url, website_url, color, icon, api_key, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, 1)`
);

for (const s of servers) {
  insertServer.run(s.name, s.description, s.url, s.website_url, s.color, s.icon, s.api_key);
}

console.log("✅ Database seeded successfully!");
console.log("");
console.log("👤 Admin account:");
console.log("   Username: admin");
console.log("   Password: admin123");
console.log("   API Key:  " + adminApiKey);
console.log("");
console.log("👤 Demo user account:");
console.log("   Username: demo");
console.log("   Password: user123");
console.log("   API Key:  " + userApiKey);
console.log("");
console.log("🖥️  MCP Servers created: " + servers.length);

db.close();

function generateKey() {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let key = "";
  for (let i = 0; i < 32; i++) {
    key += chars[Math.floor(Math.random() * chars.length)];
  }
  return key;
}
