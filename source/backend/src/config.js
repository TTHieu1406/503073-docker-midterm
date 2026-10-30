import { readFileSync } from 'node:fs';
import os from 'node:os';

/**
 * Reads a secret following the "<NAME>_FILE" convention used by the official
 * Postgres image. Docker Compose and Kubernetes both mount secrets as files, so
 * the value never appears in `docker inspect` or in the process environment.
 */
export function readSecret(name, env = process.env, readFile = readFileSync) {
  const file = env[`${name}_FILE`];
  if (file) return readFile(file, 'utf8').trim();
  if (env[name]) return env[name];
  if (env.NODE_ENV === 'production') {
    // Failing at boot is better than running with a guessable default.
    throw new Error(`Missing required secret: ${name}`);
  }
  return `dev-only-${name.toLowerCase()}`;
}

function toInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

export function loadConfig(env = process.env) {
  return {
    env: env.NODE_ENV ?? 'development',
    version: env.APP_VERSION ?? 'dev',
    port: toInt(env.PORT, 4000),
    workerPort: toInt(env.WORKER_PORT, 4001),
    instanceId: os.hostname(),
    logLevel: env.LOG_LEVEL ?? 'info',
    db: {
      host: env.DB_HOST ?? 'localhost',
      port: toInt(env.DB_PORT, 5432),
      user: env.DB_USER ?? 'dockmart',
      database: env.DB_NAME ?? 'dockmart',
      password: readSecret('DB_PASSWORD', env),
      max: toInt(env.DB_POOL_SIZE, 10),
    },
    redis: {
      host: env.REDIS_HOST ?? 'localhost',
      port: toInt(env.REDIS_PORT, 6379),
      password: readSecret('REDIS_PASSWORD', env),
    },
    jwtSecret: readSecret('JWT_SECRET', env),
    adminPassword: readSecret('ADMIN_PASSWORD', env),
    cacheTtlSeconds: toInt(env.CACHE_TTL_SECONDS, 30),
    orderStageDelayMs: toInt(env.ORDER_STAGE_DELAY_MS, 1500),
    workerConcurrency: toInt(env.WORKER_CONCURRENCY, 2),
    paymentFailureRate: Number(env.PAYMENT_FAILURE_RATE ?? 0),
    // The CPU-burn endpoint is only useful for load tests, so it must be opted into.
    demoEndpoints: env.ENABLE_DEMO_ENDPOINTS === 'true',
    shutdownTimeoutMs: toInt(env.SHUTDOWN_TIMEOUT_MS, 15000),
  };
}

export const config = loadConfig();
