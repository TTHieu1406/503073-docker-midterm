import { setTimeout as sleep } from 'node:timers/promises';
import { Worker } from 'bullmq';
import express from 'express';
import { invalidateProductCache } from './cache.js';
import { config } from './config.js';
import { pool, query } from './db.js';
import { opsLog, startInstance } from './instance.js';
import { remainingStages } from './lib/order-state.js';
import { logger } from './logger.js';
import { ordersProcessed } from './metrics.js';
import { QUEUE_NAME } from './queue.js';
import { createRedis, publishEvent, redis } from './redis.js';
import { createHealthRouter } from './routes/health.js';

const stats = { jobs: 0, active: 0 };

async function setStatus(order, status, extra = {}) {
  await query(
    `UPDATE orders SET status = $1, processed_by = $2, failure_reason = $3, updated_at = now() WHERE id = $4`,
    [status, config.instanceId, extra.reason ?? null, order.id],
  );
  await publishEvent({
    type: 'order.updated',
    orderId: order.id,
    userId: order.user_id,
    status,
    worker: config.instanceId,
  });
}

/** Payment failed: put the items back on the shelf. */
async function refuseOrder(order) {
  await query(
    `UPDATE products p SET stock = p.stock + i.quantity, updated_at = now()
     FROM order_items i WHERE i.order_id = $1 AND i.product_id = p.id`,
    [order.id],
  );
  await invalidateProductCache();
  await setStatus(order, 'failed', { reason: 'Payment declined' });
  await publishEvent({ type: 'catalog.updated' });
  ordersProcessed.inc({ status: 'failed' });
}

async function processOrder(job) {
  const { rows } = await query('SELECT id, user_id, status FROM orders WHERE id = $1', [job.data.orderId]);
  const order = rows[0];
  if (!order) throw new Error(`Order ${job.data.orderId} does not exist`);

  stats.active += 1;
  try {
    for (const stage of remainingStages(order.status)) {
      await sleep(config.orderStageDelayMs);
      if (stage === 'paid' && Math.random() < config.paymentFailureRate) {
        await refuseOrder(order);
        return;
      }
      await setStatus(order, stage);
    }
    ordersProcessed.inc({ status: 'shipped' });
    stats.jobs += 1;
  } finally {
    stats.active -= 1;
  }
}

const worker = new Worker(QUEUE_NAME, processOrder, {
  connection: createRedis('worker'),
  concurrency: config.workerConcurrency,
  // Short lock: if a worker dies, another one takes its job over within seconds.
  lockDuration: 5000,
  stalledInterval: 5000,
  maxStalledCount: 3,
});

worker.on('failed', (job, err) => logger.error({ jobId: job?.id, err: err.message }, 'job failed'));
worker.on('stalled', (jobId) => {
  logger.warn({ jobId }, 'stalled job recovered');
  opsLog('warn', `Job ${jobId} lost its worker and was re-queued`);
});

const instance = await startInstance({ role: 'worker', getStats: () => ({ ...stats }) });

// A worker serves no customers, but probes and Prometheus still need to reach it.
const probe = express();
probe.use(createHealthRouter());
const probeServer = probe.listen(config.workerPort, () => {
  logger.info({ port: config.workerPort }, 'worker probe server listening');
});

let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'worker shutdown started');
  const forceExit = setTimeout(() => process.exit(1), config.shutdownTimeoutMs);
  forceExit.unref();

  await instance.stop();
  // close() waits for jobs in progress, so a redeploy does not interrupt an order.
  await worker.close();
  probeServer.close();
  await pool.end();
  redis.disconnect();
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
