import { logger } from './logger.js';
import { redis, redisIsUp } from './redis.js';

export const CACHE_STATS_KEY = 'dockmart:cache:stats';
const CACHE_VERSION_KEY = 'dockmart:cache:products:version';
const CACHE_PREFIX = 'dockmart:cache:products';

/**
 * The cache is an optimisation, not a dependency: every function here survives a
 * Redis outage, so the catalog keeps working from Postgres in a degraded mode.
 * The redisIsUp() checks matter: without them each command waits for a reconnect
 * attempt, and a request during an outage takes seconds instead of milliseconds.
 */
export async function readCache(filters) {
  if (!redisIsUp()) return { available: false };
  try {
    const version = (await redis.get(CACHE_VERSION_KEY)) ?? '0';
    const key = `${CACHE_PREFIX}:${version}:${JSON.stringify(filters)}`;
    return { available: true, key, value: await redis.get(key) };
  } catch {
    return { available: false };
  }
}

export async function writeCache(key, value, ttlSeconds) {
  if (!redisIsUp()) return;
  await redis.set(key, value, 'EX', ttlSeconds).catch((err) => logger.warn({ err: err.message }, 'cache write failed'));
}

export function countCacheResult(field) {
  if (redisIsUp()) redis.hincrby(CACHE_STATS_KEY, field, 1).catch(() => {});
}

/**
 * Bumping the version makes every cached list unreachable at once, and the old
 * keys then expire through their TTL. There is no need to find and delete them.
 * If Redis is down the entries are short-lived anyway, because of that same TTL.
 */
export async function invalidateProductCache() {
  if (!redisIsUp()) return;
  await redis.incr(CACHE_VERSION_KEY).catch((err) => logger.warn({ err: err.message }, 'cache invalidation failed'));
}
