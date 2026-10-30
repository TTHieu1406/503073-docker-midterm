import pg from 'pg';
import { config } from './config.js';
import { logger } from './logger.js';

export const pool = new pg.Pool(config.db);

pool.on('error', (err) => logger.error({ err }, 'idle postgres client error'));

export const query = (text, params) => pool.query(text, params);

/** Runs `work` in a transaction and rolls back if it throws. */
export async function withTransaction(work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
