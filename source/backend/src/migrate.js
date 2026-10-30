import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { config } from './config.js';
import { pool } from './db.js';
import { logger } from './logger.js';

const MIGRATIONS_DIR = path.join(import.meta.dirname, '..', 'migrations');
// Any constant works, as long as every migrator uses the same one.
const LOCK_ID = 503073;

async function run() {
  const client = await pool.connect();
  try {
    // Several replicas may start at once. The advisory lock lets only one migrate.
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);

    const { rows } = await client.query('SELECT name FROM schema_migrations');
    const applied = new Set(rows.map((row) => row.name));
    const files = (await readdir(MIGRATIONS_DIR)).filter((file) => file.endsWith('.sql')).sort();

    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      logger.info({ file }, 'migration applied');
    }

    // The admin password comes from a secret, so it cannot live in a SQL file.
    const passwordHash = await bcrypt.hash(config.adminPassword, 10);
    await client.query(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ('Store Admin', 'admin@dockmart.local', $1, 'admin')
       ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
      [passwordHash],
    );
    logger.info('database is up to date');
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]);
    client.release();
  }
}

try {
  await run();
  await pool.end();
  process.exit(0);
} catch (err) {
  logger.error({ err }, 'migration failed');
  process.exit(1);
}
