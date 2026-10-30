import { Redis } from 'ioredis';
import { config } from './config.js';
import { logger } from './logger.js';

export const CHANNELS = {
  events: 'dockmart:events',
  commands: 'dockmart:commands',
};

/**
 * Pub/sub subscribers and BullMQ each need their own connection, so callers
 * create as many as they need. `maxRetriesPerRequest: null` is required by BullMQ.
 */
export function createRedis(name, options = {}) {
  const client = new Redis({
    ...config.redis,
    connectionName: `${config.instanceId}:${name}`,
    maxRetriesPerRequest: null,
    retryStrategy: (attempt) => Math.min(attempt * 200, 2000),
    ...options,
  });
  client.on('error', (err) => logger.warn({ err: err.message, name }, 'redis connection error'));
  return client;
}

// Requests use this client, so during an outage its commands must fail quickly
// instead of waiting for Redis to come back while the visitor's page hangs.
export const redis = createRedis('main', { maxRetriesPerRequest: 1 });

export const redisIsUp = () => redis.status === 'ready';

/** Live updates are a convenience. A lost event must never fail the request itself. */
export async function publishEvent(event) {
  if (!redisIsUp()) return;
  await redis
    .publish(CHANNELS.events, JSON.stringify({ at: new Date().toISOString(), ...event }))
    .catch((err) => logger.warn({ err: err.message, type: event.type }, 'event not published'));
}
