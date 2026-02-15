import { createClient } from '@libsql/client';

let client = null;

export function getDb() {
    if (!client) {
        client = createClient({
            url: process.env.TURSO_DATABASE_URL,
            authToken: process.env.TURSO_AUTH_TOKEN,
        });
    }
    return client;
}

export async function initDb() {
    const db = getDb();
    await db.execute(`
    CREATE TABLE IF NOT EXISTS time_segments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      seg_start TEXT NOT NULL,
      seg_end TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
    await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_segments_date ON time_segments(date)
  `);
}
