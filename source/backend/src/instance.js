import dns from 'node:dns/promises';
import os from 'node:os';
import { config } from './config.js';
import { logger } from './logger.js';
import { CHANNELS, createRedis, redis } from './redis.js';

const HEARTBEAT_MS = 2000;
const HEARTBEAT_TTL_SECONDS = 6;
const LOG_KEY = 'dockmart:ops:log';
const LOG_LENGTH = 60;
const INSTANCE_PREFIX = 'dockmart:instance:';
const STARTS_KEY = 'dockmart:instance-starts';

/** Liveness flag. Flipped by the "make unhealthy" chaos action. */
export const health = { healthy: true, ready: true };

function firstIpv4() {
  const addresses = Object.values(os.networkInterfaces()).flat();
  return addresses.find((a) => a.family === 'IPv4' && !a.internal)?.address ?? '127.0.0.1';
}

/**
 * Docker's embedded DNS answers reverse lookups with the container name, for
 * example `dockmart-api-2.dockmart_edge`. Kubernetes pods simply use the hostname.
 */
async function resolveDisplayName(ip) {
  try {
    const [name] = await dns.reverse(ip);
    return name?.split('.')[0] || config.instanceId;
  } catch {
    return config.instanceId;
  }
}

export async function opsLog(level, message) {
  const entry = JSON.stringify({ at: new Date().toISOString(), level, message });
  await redis.multi().lpush(LOG_KEY, entry).ltrim(LOG_KEY, 0, LOG_LENGTH - 1).exec();
}

export async function readOpsLog() {
  return (await redis.lrange(LOG_KEY, 0, LOG_LENGTH - 1)).map((entry) => JSON.parse(entry));
}

export async function listInstances() {
  const keys = [];
  let cursor = '0';
  do {
    const [next, batch] = await redis.scan(cursor, 'MATCH', `${INSTANCE_PREFIX}*`, 'COUNT', 100);
    cursor = next;
    keys.push(...batch);
  } while (cursor !== '0');
  if (keys.length === 0) return [];
  const values = await redis.mget(keys);
  return values.filter(Boolean).map((value) => JSON.parse(value));
}

/**
 * Every replica announces itself in Redis with a short TTL. A replica that dies
 * simply stops renewing its key and disappears from the dashboard, so the Ops
 * Center needs no access to the Docker socket and works the same on Kubernetes.
 */
export async function startInstance({ role, getStats = () => ({}) }) {
  const ip = firstIpv4();
  const displayName = await resolveDisplayName(ip);
  const startedAt = new Date().toISOString();
  const starts = await redis.hincrby(STARTS_KEY, config.instanceId, 1);

  let lastCpu = process.cpuUsage();
  let lastTick = process.hrtime.bigint();

  const beat = async () => {
    const cpu = process.cpuUsage(lastCpu);
    const now = process.hrtime.bigint();
    const elapsedMicros = Number(now - lastTick) / 1000;
    lastCpu = process.cpuUsage();
    lastTick = now;

    const payload = {
      id: config.instanceId,
      name: displayName,
      role,
      ip,
      version: config.version,
      startedAt,
      restarts: starts - 1,
      healthy: health.healthy,
      ready: health.ready,
      rssBytes: process.memoryUsage().rss,
      cpuPercent: Math.round(((cpu.user + cpu.system) / elapsedMicros) * 1000) / 10,
      ...getStats(),
    };
    await redis.set(`${INSTANCE_PREFIX}${config.instanceId}`, JSON.stringify(payload), 'EX', HEARTBEAT_TTL_SECONDS);
  };

  await beat();
  const timer = setInterval(() => beat().catch((err) => logger.warn({ err: err.message }, 'heartbeat failed')), HEARTBEAT_MS);
  await opsLog('info', starts > 1 ? `${displayName} restarted (restart #${starts - 1})` : `${displayName} started`);

  const subscriber = createRedis('commands');
  await subscriber.subscribe(CHANNELS.commands);
  subscriber.on('message', (_channel, raw) => {
    const command = JSON.parse(raw);
    if (command.target !== config.instanceId) return;
    if (command.action === 'crash') {
      logger.warn('chaos: crashing on request');
      // Exit without any cleanup, exactly like a real fault.
      opsLog('error', `${displayName} crashed (chaos experiment)`).finally(() => process.exit(137));
    }
    if (command.action === 'unhealthy') {
      health.healthy = false;
      opsLog('warn', `${displayName} now fails its liveness probe`);
    }
    if (command.action === 'healthy') {
      health.healthy = true;
      opsLog('info', `${displayName} passes its liveness probe again`);
    }
  });

  return {
    displayName,
    async stop() {
      clearInterval(timer);
      health.ready = false;
      // Best effort: shutting down must not depend on Redis being reachable.
      await opsLog('info', `${displayName} is shutting down gracefully`).catch(() => {});
      await redis.del(`${INSTANCE_PREFIX}${config.instanceId}`).catch(() => {});
      subscriber.disconnect();
    },
  };
}
