import { Router } from 'express';
import { z } from 'zod';
import { countCacheResult, invalidateProductCache, readCache, writeCache } from '../cache.js';
import { config } from '../config.js';
import { query } from '../db.js';
import { HttpError } from '../lib/errors.js';
import { cacheRequests } from '../metrics.js';
import { requireAdmin } from '../middleware.js';
import { publishEvent } from '../redis.js';

export const productsRouter = Router();

const CATEGORIES = ['Keyboards', 'Audio', 'Displays', 'Accessories'];

const listSchema = z.object({
  category: z.enum(CATEGORIES).optional(),
  q: z.string().trim().max(60).optional(),
  sort: z.enum(['name', 'price_asc', 'price_desc']).default('name'),
});

const productSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().min(2).max(500),
  category: z.enum(CATEGORIES),
  priceCents: z.number().int().min(0).max(100_000_00),
  stock: z.number().int().min(0).max(100_000),
});

const ORDER_BY = {
  name: 'name ASC',
  price_asc: 'price_cents ASC',
  price_desc: 'price_cents DESC',
};

const toProduct = (row) => ({
  id: row.id,
  name: row.name,
  description: row.description,
  category: row.category,
  priceCents: row.price_cents,
  stock: row.stock,
});

productsRouter.get('/', async (req, res) => {
  const filters = listSchema.parse(req.query);

  const cache = await readCache(filters);
  if (cache.value) {
    cacheRequests.inc({ result: 'hit' });
    countCacheResult('hits');
    return res.set('X-Cache', 'HIT').type('application/json').send(cache.value);
  }

  const conditions = [];
  const params = [];
  if (filters.category) {
    params.push(filters.category);
    conditions.push(`category = $${params.length}`);
  }
  if (filters.q) {
    params.push(`%${filters.q}%`);
    conditions.push(`(name ILIKE $${params.length} OR description ILIKE $${params.length})`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await query(`SELECT * FROM products ${where} ORDER BY ${ORDER_BY[filters.sort]}`, params);

  const body = JSON.stringify({ products: rows.map(toProduct) });
  if (!cache.available) {
    return res.set('X-Cache', 'BYPASS').type('application/json').send(body);
  }
  await writeCache(cache.key, body, config.cacheTtlSeconds);
  cacheRequests.inc({ result: 'miss' });
  countCacheResult('misses');
  return res.set('X-Cache', 'MISS').type('application/json').send(body);
});

productsRouter.get('/:id', async (req, res) => {
  const id = z.coerce.number().int().positive().parse(req.params.id);
  const { rows } = await query('SELECT * FROM products WHERE id = $1', [id]);
  if (rows.length === 0) throw new HttpError(404, 'Product not found.');
  res.json({ product: toProduct(rows[0]) });
});

productsRouter.post('/', requireAdmin, async (req, res) => {
  const input = productSchema.parse(req.body);
  const { rows } = await query(
    `INSERT INTO products (name, description, category, price_cents, stock)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [input.name, input.description, input.category, input.priceCents, input.stock],
  );
  await invalidateProductCache();
  await publishEvent({ type: 'catalog.updated' });
  res.status(201).json({ product: toProduct(rows[0]) });
});

productsRouter.put('/:id', requireAdmin, async (req, res) => {
  const id = z.coerce.number().int().positive().parse(req.params.id);
  const input = productSchema.parse(req.body);
  const { rows } = await query(
    `UPDATE products
     SET name = $1, description = $2, category = $3, price_cents = $4, stock = $5, updated_at = now()
     WHERE id = $6 RETURNING *`,
    [input.name, input.description, input.category, input.priceCents, input.stock, id],
  );
  if (rows.length === 0) throw new HttpError(404, 'Product not found.');
  await invalidateProductCache();
  await publishEvent({ type: 'catalog.updated' });
  res.json({ product: toProduct(rows[0]) });
});

productsRouter.delete('/:id', requireAdmin, async (req, res) => {
  const id = z.coerce.number().int().positive().parse(req.params.id);
  try {
    const { rowCount } = await query('DELETE FROM products WHERE id = $1', [id]);
    if (rowCount === 0) throw new HttpError(404, 'Product not found.');
  } catch (err) {
    // 23503: foreign key violation, the product appears on an existing order.
    if (err.code === '23503') throw new HttpError(409, 'This product has orders and cannot be deleted.');
    throw err;
  }
  await invalidateProductCache();
  await publishEvent({ type: 'catalog.updated' });
  res.status(204).end();
});
