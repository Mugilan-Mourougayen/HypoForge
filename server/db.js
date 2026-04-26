import { Pool } from 'pg';

const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;

if (!connectionString) {
  throw new Error('Missing DATABASE_URL or POSTGRES_URL environment variable');
}

const pool = new Pool({
  connectionString,
  ssl: connectionString.includes('localhost') ? false : { rejectUnauthorized: false },
});

let readyPromise;

export async function query(text, params = []) {
  if (!readyPromise) {
    readyPromise = pool.query(`
      CREATE TABLE IF NOT EXISTS feedback_reviews (
        id BIGSERIAL PRIMARY KEY,
        timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        question TEXT NOT NULL,
        domain TEXT NOT NULL,
        sections JSONB NOT NULL DEFAULT '{}'::jsonb,
        overall_rating INTEGER NOT NULL DEFAULT 0,
        overall_comment TEXT NOT NULL DEFAULT ''
      );
      CREATE INDEX IF NOT EXISTS feedback_reviews_domain_timestamp_idx
      ON feedback_reviews (domain, timestamp DESC);
    `);
  }

  await readyPromise;
  return pool.query(text, params);
}
