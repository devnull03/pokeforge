import { createPool, VercelPool } from "@vercel/postgres";

let pool: VercelPool | null = null;
let initialized = false;

function getPool(): VercelPool {
  if (!pool) {
    pool = createPool({
      connectionString: process.env.POSTGRES_URL || process.env.DATABASE_URL || process.env.STORAGE_URL,
    });
  }
  return pool;
}

async function ensureDb() {
  if (initialized) return;

  const p = getPool();

  await p.query(`
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

  await p.query(`
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

  initialized = true;
}

export async function query(text: string, params: any[] = []) {
  await ensureDb();
  return getPool().query(text, params);
}
