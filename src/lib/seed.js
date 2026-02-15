const { createPool } = require("@vercel/postgres");
const bcrypt = require("bcryptjs");

function generateKey() {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let key = "";
  for (let i = 0; i < 32; i++) {
    key += chars[Math.floor(Math.random() * chars.length)];
  }
  return key;
}

async function seed() {
  const pool = createPool();

  // Create tables
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      api_key TEXT UNIQUE,
      api_calls_used INTEGER NOT NULL DEFAULT 0,
      api_calls_limit INTEGER NOT NULL DEFAULT 100,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS servers (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      url TEXT NOT NULL,
      website_url TEXT,
      color TEXT NOT NULL DEFAULT '#ff6b9d',
      icon TEXT NOT NULL DEFAULT '🌐',
      api_key TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  // Clear existing data
  await pool.query("DELETE FROM servers");
  await pool.query("DELETE FROM users");

  // Create admin user (password: admin123)
  const adminPassword = bcrypt.hashSync("admin123", 10);
  const adminApiKey = "mcp_admin_" + generateKey();
  await pool.query(
    "INSERT INTO users (username, password, role, api_key, api_calls_limit) VALUES ($1, $2, 'admin', $3, 10000)",
    ["admin", adminPassword, adminApiKey]
  );

  // Create demo user (password: user123)
  const userPassword = bcrypt.hashSync("user123", 10);
  const userApiKey = "mcp_user_" + generateKey();
  await pool.query(
    "INSERT INTO users (username, password, role, api_key, api_calls_limit) VALUES ($1, $2, 'user', $3, 100)",
    ["demo", userPassword, userApiKey]
  );

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

  await pool.end();
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
