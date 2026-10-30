import { shouldDeliver } from './lib/event-filter.js';
import { logger } from './logger.js';
import { sseClients } from './metrics.js';
import { CHANNELS, createRedis } from './redis.js';

const KEEP_ALIVE_MS = 15000;
const clients = new Set();

/**
 * Each browser is connected to one replica, but the worker that updates an order
 * can be anywhere. Redis pub/sub fans every event out to all API replicas, and
 * each replica forwards it to the browsers it happens to hold.
 */
export async function startEventHub() {
  const subscriber = createRedis('events');
  await subscriber.subscribe(CHANNELS.events);
  subscriber.on('message', (_channel, raw) => {
    const event = JSON.parse(raw);
    for (const client of clients) {
      if (shouldDeliver(event, client.user)) {
        client.res.write(`event: ${event.type}\ndata: ${raw}\n\n`);
      }
    }
  });

  const keepAlive = setInterval(() => {
    for (const client of clients) client.res.write(': keep-alive\n\n');
  }, KEEP_ALIVE_MS);

  return {
    stop() {
      clearInterval(keepAlive);
      subscriber.disconnect();
      closeAllClients();
    },
  };
}

export function addClient(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 2000\n\n');

  const client = { res, user: req.user };
  clients.add(client);
  sseClients.set(clients.size);

  req.on('close', () => {
    clients.delete(client);
    sseClients.set(clients.size);
  });
}

export const connectedClients = () => clients.size;

/** Called on SIGTERM. EventSource reconnects by itself and reaches another replica. */
function closeAllClients() {
  logger.info({ clients: clients.size }, 'closing SSE clients');
  for (const client of clients) client.res.end();
  clients.clear();
}
