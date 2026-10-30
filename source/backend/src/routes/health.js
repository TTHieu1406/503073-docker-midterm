import { Router } from 'express';
import { pool } from '../db.js';
import { health } from '../instance.js';
import { registry } from '../metrics.js';

/** Internal endpoints. The gateway never proxies them to the public. */
export function createHealthRouter() {
  const router = Router();

  // Liveness: "is this process stuck?" Failing it gets the container restarted.
  router.get('/health/live', (_req, res) => {
    res.status(health.healthy ? 200 : 503).json({ alive: health.healthy });
  });

  // Readiness: "can it do useful work?" Failing it only removes it from traffic.
  // Redis is left out on purpose. Every replica shares it, so an outage would pull
  // all of them out of the Service at once, although the catalog still works.
  router.get('/health/ready', async (_req, res) => {
    if (!health.ready) return res.status(503).json({ ready: false, reason: 'draining' });
    // A replica failing liveness is about to be restarted: stop sending it traffic now.
    if (!health.healthy) return res.status(503).json({ ready: false, reason: 'unhealthy' });
    try {
      await pool.query('SELECT 1');
      return res.json({ ready: true });
    } catch (err) {
      return res.status(503).json({ ready: false, reason: err.message });
    }
  });

  router.get('/metrics', async (_req, res) => {
    res.set('Content-Type', registry.contentType).send(await registry.metrics());
  });

  return router;
}
