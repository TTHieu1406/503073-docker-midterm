import { createApp } from './app.js';
import { config } from './config.js';
import { pool } from './db.js';
import { connectedClients, startEventHub } from './events.js';
import { startInstance } from './instance.js';
import { logger } from './logger.js';
import { queueDepth } from './metrics.js';
import { stats } from './middleware.js';
import { orderQueue } from './queue.js';
import { redis } from './redis.js';

const QUEUE_GAUGE_MS = 5000;

const app = createApp();
const hub = await startEventHub();
const instance = await startInstance({
  role: 'api',
  getStats: () => ({ requests: stats.requests, sseClients: connectedClients() }),
});

const server = app.listen(config.port, () => {
  logger.info({ port: config.port }, 'api listening');
});

const queueGauge = setInterval(async () => {
  const counts = await orderQueue.getJobCounts('waiting', 'active', 'delayed', 'failed').catch(() => ({}));
  for (const [state, count] of Object.entries(counts)) queueDepth.set({ state }, count);
}, QUEUE_GAUGE_MS);

let shuttingDown = false;

/**
 * SIGTERM is what `docker stop` and Kubernetes send. Going through this path lets
 * requests already in flight finish, which is the basis of zero-downtime deploys.
 */
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'shutdown started');

  const forceExit = setTimeout(() => {
    logger.error('shutdown timed out, exiting');
    process.exit(1);
  }, config.shutdownTimeoutMs);
  forceExit.unref();

  clearInterval(queueGauge);
  await instance.stop();
  hub.stop();
  await new Promise((resolve) => server.close(resolve));
  await Promise.allSettled([orderQueue.close(), pool.end()]);
  redis.disconnect();
  logger.info('shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
