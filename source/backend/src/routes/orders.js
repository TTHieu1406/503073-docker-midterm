import { Router } from 'express';
import { z } from 'zod';
import { invalidateProductCache } from '../cache.js';
import { query, withTransaction } from '../db.js';
import { HttpError } from '../lib/errors.js';
import { computeTotalCents } from '../lib/order-state.js';
import { ordersCreated } from '../metrics.js';
import { requireAuth } from '../middleware.js';
import { enqueueOrder } from '../queue.js';
import { publishEvent, redisIsUp } from '../redis.js';

export const ordersRouter = Router();

const orderSchema = z.object({
  items: z
    .array(z.object({ productId: z.number().int().positive(), quantity: z.number().int().min(1).max(20) }))
    .min(1)
    .max(30),
});

const ORDER_SELECT = `
  SELECT o.id, o.user_id, o.status, o.total_cents, o.processed_by, o.failure_reason,
         o.created_at, o.updated_at, u.name AS customer,
         COALESCE(json_agg(json_build_object(
           'productId', i.product_id, 'name', p.name, 'quantity', i.quantity,
           'unitPriceCents', i.unit_price_cents) ORDER BY i.id), '[]') AS items
  FROM orders o
  JOIN users u ON u.id = o.user_id
  JOIN order_items i ON i.order_id = o.id
  JOIN products p ON p.id = i.product_id`;

const toOrder = (row) => ({
  id: row.id,
  userId: row.user_id,
  customer: row.customer,
  status: row.status,
  totalCents: row.total_cents,
  processedBy: row.processed_by,
  failureReason: row.failure_reason,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  items: row.items,
});

ordersRouter.post('/', requireAuth, async (req, res) => {
  const { items } = orderSchema.parse(req.body);

  // Refuse before touching the stock: an order that cannot be queued would never ship.
  if (!redisIsUp()) throw new HttpError(503, 'Checkout is briefly unavailable. Please try again in a moment.');

  // The same product may be listed twice; merging keeps stock arithmetic correct.
  const quantities = new Map();
  for (const item of items) {
    quantities.set(item.productId, (quantities.get(item.productId) ?? 0) + item.quantity);
  }
  // Locking rows in a fixed order prevents deadlocks between concurrent checkouts.
  const productIds = [...quantities.keys()].sort((a, b) => a - b);

  const order = await withTransaction(async (client) => {
    const { rows: products } = await client.query(
      'SELECT id, name, price_cents, stock FROM products WHERE id = ANY($1) ORDER BY id FOR UPDATE',
      [productIds],
    );
    if (products.length !== productIds.length) throw new HttpError(404, 'A product in your cart no longer exists.');

    const lines = products.map((product) => {
      const quantity = quantities.get(product.id);
      if (product.stock < quantity) {
        throw new HttpError(409, `Only ${product.stock} of "${product.name}" left in stock.`);
      }
      return { productId: product.id, quantity, priceCents: product.price_cents };
    });

    const { rows } = await client.query(
      'INSERT INTO orders (user_id, status, total_cents) VALUES ($1, $2, $3) RETURNING id, status, total_cents',
      [req.user.id, 'pending', computeTotalCents(lines)],
    );
    const [created] = rows;

    for (const line of lines) {
      await client.query(
        'INSERT INTO order_items (order_id, product_id, quantity, unit_price_cents) VALUES ($1, $2, $3, $4)',
        [created.id, line.productId, line.quantity, line.priceCents],
      );
      await client.query('UPDATE products SET stock = stock - $1, updated_at = now() WHERE id = $2', [
        line.quantity,
        line.productId,
      ]);
    }
    return created;
  });

  await invalidateProductCache();
  await enqueueOrder(order.id);
  ordersCreated.inc();
  await publishEvent({ type: 'order.updated', orderId: order.id, userId: req.user.id, status: order.status });
  await publishEvent({ type: 'catalog.updated' });
  res.status(201).json({ order: { id: order.id, status: order.status, totalCents: order.total_cents } });
});

ordersRouter.get('/', requireAuth, async (req, res) => {
  const seeAll = req.query.all === '1' && req.user.role === 'admin';
  const { rows } = await query(
    `${ORDER_SELECT}
     ${seeAll ? '' : 'WHERE o.user_id = $1'}
     GROUP BY o.id, u.name
     ORDER BY o.id DESC
     LIMIT 100`,
    seeAll ? [] : [req.user.id],
  );
  res.json({ orders: rows.map(toOrder) });
});

ordersRouter.get('/:id', requireAuth, async (req, res) => {
  const id = z.coerce.number().int().positive().parse(req.params.id);
  const { rows } = await query(`${ORDER_SELECT} WHERE o.id = $1 GROUP BY o.id, u.name`, [id]);
  const order = rows[0];
  // 404 rather than 403, so order ids of other customers cannot be probed.
  if (!order || (order.user_id !== req.user.id && req.user.role !== 'admin')) {
    throw new HttpError(404, 'Order not found.');
  }
  res.json({ order: toOrder(order) });
});
