import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { CACHE_STATS_KEY } from '../cache.js';
import { config } from '../config.js';
import { query } from '../db.js';
import { addClient, connectedClients } from '../events.js';
import { listInstances, opsLog, readOpsLog } from '../instance.js';
import { HttpError } from '../lib/errors.js';
import { requireAdmin, requireAuth } from '../middleware.js';
import { orderQueue } from '../queue.js';
import { CHANNELS, redis } from '../redis.js';

export const opsRouter = Router();

const chaosSchema = z.object({
  action: z.enum(['crash', 'unhealthy', 'healthy']),
  target: z.string().min(1).max(100),
});

const computeSchema = z.object({
  iterations: z.coerce.number().int().min(1).max(300_000).default(50_000),
});

/** Public: the Ops Center fires bursts at this to show load balancing. */
opsRouter.get('/whoami', (_req, res) => {
  res.json({ instance: config.instanceId, version: config.version });
});

/** Server-Sent Events stream of order and catalog changes. */
opsRouter.get('/events', requireAuth, (req, res) => {
  addClient(req, res);
});

/** Synthetic CPU work so that load tests measure scaling rather than Redis. */
opsRouter.get('/ops/compute', (req, res) => {
  if (!config.demoEndpoints) throw new HttpError(404, 'Not found.');
  const { iterations } = computeSchema.parse(req.query);
  const digest = crypto.pbkdf2Sync('dockmart', 'load-test', iterations, 32, 'sha256').toString('hex');
  res.json({ instance: config.instanceId, digest: digest.slice(0, 16) });
});

opsRouter.get('/ops/overview', requireAdmin, async (_req, res) => {
  const [instances, queue, log, cache, orderStats, productStats, userStats] = await Promise.all([
    listInstances(),
    orderQueue.getJobCounts('waiting', 'active', 'delayed', 'completed', 'failed'),
    readOpsLog(),
    redis.hgetall(CACHE_STATS_KEY),
    query(`SELECT status, count(*)::int AS count, COALESCE(sum(total_cents), 0)::bigint AS cents
           FROM orders GROUP BY status`),
    query('SELECT count(*)::int AS count, COALESCE(sum(stock), 0)::int AS stock FROM products'),
    query('SELECT count(*)::int AS count FROM users'),
  ]);

  res.json({
    servedBy: config.instanceId,
    sseClientsHere: connectedClients(),
    instances,
    queue,
    log,
    cache: { hits: Number(cache.hits ?? 0), misses: Number(cache.misses ?? 0) },
    totals: {
      users: userStats.rows[0].count,
      products: productStats.rows[0].count,
      stock: productStats.rows[0].stock,
      orders: orderStats.rows.reduce((sum, row) => sum + row.count, 0),
      revenueCents: orderStats.rows
        .filter((row) => row.status !== 'failed')
        .reduce((sum, row) => sum + Number(row.cents), 0),
      byStatus: Object.fromEntries(orderStats.rows.map((row) => [row.status, row.count])),
    },
  });
});

opsRouter.post('/ops/chaos', requireAdmin, async (req, res) => {
  const command = chaosSchema.parse(req.body);
  await opsLog('warn', `${req.user.name} sent "${command.action}" to ${command.target.slice(0, 12)}`);
  await redis.publish(CHANNELS.commands, JSON.stringify(command));
  res.status(202).json({ accepted: true });
});
