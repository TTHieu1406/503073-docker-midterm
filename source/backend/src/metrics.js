import client from 'prom-client';
import { config } from './config.js';

export const registry = new client.Registry();
registry.setDefaultLabels({ instance_id: config.instanceId, version: config.version });
client.collectDefaultMetrics({ register: registry });

export const httpRequests = new client.Counter({
  name: 'dockmart_http_requests_total',
  help: 'HTTP requests handled by this replica',
  labelNames: ['method', 'route', 'status'],
  registers: [registry],
});

export const httpDuration = new client.Histogram({
  name: 'dockmart_http_request_duration_seconds',
  help: 'HTTP request latency',
  labelNames: ['method', 'route'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [registry],
});

export const cacheRequests = new client.Counter({
  name: 'dockmart_cache_requests_total',
  help: 'Product cache lookups',
  labelNames: ['result'],
  registers: [registry],
});

export const sseClients = new client.Gauge({
  name: 'dockmart_sse_clients',
  help: 'Browsers connected to this replica through Server-Sent Events',
  registers: [registry],
});

export const ordersCreated = new client.Counter({
  name: 'dockmart_orders_created_total',
  help: 'Orders accepted by the API',
  registers: [registry],
});

export const ordersProcessed = new client.Counter({
  name: 'dockmart_orders_processed_total',
  help: 'Orders finished by a worker',
  labelNames: ['status'],
  registers: [registry],
});

export const queueDepth = new client.Gauge({
  name: 'dockmart_queue_jobs',
  help: 'Jobs in the order queue',
  labelNames: ['state'],
  registers: [registry],
});
