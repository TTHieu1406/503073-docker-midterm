// End-to-end checks against the running stack, from inside the `edge` network.
// Run with: docker compose --profile test run --rm smoke
//
// Only Docker is required on the host, because the tests run in a Node container.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:8080';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@dockmart.local';
const ADMIN_PASSWORD = readFileSync(process.env.ADMIN_PASSWORD_FILE, 'utf8').trim();

/** Small client that remembers the session cookie. */
function client() {
  let cookie = '';
  return async function call(path, { method = 'GET', body, raw = false } = {}) {
    const response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    if (raw) return response;
    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    return { status: response.status, headers: response.headers, data };
  };
}

const uniqueEmail = () => `smoke-${Date.now()}-${Math.round(Math.random() * 1e6)}@example.com`;

const admin = client();
const customer = client();

before(async () => {
  const login = await admin('/api/auth/login', { method: 'POST', body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } });
  assert.equal(login.status, 200, 'the seeded admin account must be able to sign in');
  const register = await customer('/api/auth/register', {
    method: 'POST',
    body: { name: 'Smoke Test', email: uniqueEmail(), password: 'correct horse battery' },
  });
  assert.equal(register.status, 201);
});

describe('gateway', () => {
  it('serves the React application', async () => {
    const { status, data } = await client()('/');
    assert.equal(status, 200);
    assert.match(data, /<div id="root">/);
  });

  it('falls back to index.html for client-side routes', async () => {
    const { status, data } = await client()('/ops');
    assert.equal(status, 200);
    assert.match(data, /<div id="root">/);
  });

  it('sets security headers and hides the Nginx version', async () => {
    const { headers } = await client()('/');
    assert.equal(headers.get('x-content-type-options'), 'nosniff');
    assert.equal(headers.get('x-frame-options'), 'DENY');
    assert.ok(headers.get('content-security-policy'));
    assert.equal(headers.get('server'), 'nginx');
  });

  it('never exposes internal endpoints', async () => {
    for (const path of ['/metrics', '/health/live', '/health/ready']) {
      const { data } = await client()(path);
      assert.doesNotMatch(String(data), /nodejs_|"alive"|"ready"/, `${path} leaked through the gateway`);
    }
  });

  it('balances requests across more than one replica', async () => {
    const seen = new Set();
    for (let i = 0; i < 30; i += 1) {
      const { data } = await client()('/api/whoami');
      seen.add(data.instance);
    }
    assert.ok(seen.size >= 2, `expected several replicas, saw ${seen.size}`);
  });
});

describe('authentication', () => {
  it('rejects a wrong password', async () => {
    const { status } = await client()('/api/auth/login', {
      method: 'POST',
      body: { email: ADMIN_EMAIL, password: 'wrong-password' },
    });
    assert.equal(status, 401);
  });

  it('rejects a duplicate email', async () => {
    const email = uniqueEmail();
    const body = { name: 'Twin', email, password: 'correct horse battery' };
    assert.equal((await client()('/api/auth/register', { method: 'POST', body })).status, 201);
    assert.equal((await client()('/api/auth/register', { method: 'POST', body })).status, 409);
  });

  it('validates input', async () => {
    const { status } = await client()('/api/auth/register', {
      method: 'POST',
      body: { name: 'x', email: 'not-an-email', password: 'short' },
    });
    assert.equal(status, 400);
  });

  it('marks the session cookie HttpOnly', async () => {
    const response = await client()('/api/auth/login', {
      method: 'POST',
      raw: true,
      body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });
    assert.match(response.headers.get('set-cookie'), /HttpOnly/i);
  });

  it('accepts a session on every replica, because JWTs are stateless', async () => {
    const seen = new Set();
    for (let i = 0; i < 30; i += 1) {
      const { status, headers } = await customer('/api/auth/me');
      assert.equal(status, 200);
      seen.add(headers.get('x-served-by'));
    }
    assert.ok(seen.size >= 2);
  });
});

describe('catalog', () => {
  it('lists the seeded products and caches the result in Redis', async () => {
    const first = await client()('/api/products?sort=price_desc');
    assert.equal(first.status, 200);
    assert.ok(first.data.products.length >= 12);
    const second = await client()('/api/products?sort=price_desc');
    assert.equal(second.headers.get('x-cache'), 'HIT');
  });

  it('filters by category', async () => {
    const { data } = await client()('/api/products?category=Audio');
    assert.ok(data.products.length > 0);
    assert.ok(data.products.every((product) => product.category === 'Audio'));
  });

  it('ignores SQL injection attempts', async () => {
    const { status, data } = await client()(`/api/products?q=${encodeURIComponent("' OR 1=1 --")}`);
    assert.equal(status, 200);
    assert.equal(data.products.length, 0);
  });

  it('refuses writes from customers and strangers', async () => {
    const body = { name: 'Nope', description: 'Nope', category: 'Audio', priceCents: 100, stock: 1 };
    assert.equal((await client()('/api/products', { method: 'POST', body })).status, 401);
    assert.equal((await customer('/api/products', { method: 'POST', body })).status, 403);
  });

  it('lets an admin create, update and delete a product, and drops stale cache', async () => {
    const list = () => client()('/api/products?sort=name');
    await list();

    const body = { name: 'Smoke Widget', description: 'Temporary', category: 'Accessories', priceCents: 1000, stock: 5 };
    const created = await admin('/api/products', { method: 'POST', body });
    assert.equal(created.status, 201);
    const { id } = created.data.product;

    const afterCreate = await list();
    assert.equal(afterCreate.headers.get('x-cache'), 'MISS');
    assert.ok(afterCreate.data.products.some((product) => product.id === id));

    const updated = await admin(`/api/products/${id}`, { method: 'PUT', body: { ...body, priceCents: 2000 } });
    assert.equal(updated.data.product.priceCents, 2000);

    assert.equal((await admin(`/api/products/${id}`, { method: 'DELETE' })).status, 204);
    assert.equal((await client()(`/api/products/${id}`)).status, 404);
  });
});

describe('orders', () => {
  let product;

  before(async () => {
    const { data } = await admin('/api/products', {
      method: 'POST',
      body: { name: `Smoke Item ${Date.now()}`, description: 'For the order tests', category: 'Audio', priceCents: 1500, stock: 3 },
    });
    product = data.product;
  });

  after(async () => {
    await admin(`/api/products/${product.id}`, {
      method: 'PUT',
      body: { name: product.name, description: 'Left over from smoke tests', category: 'Audio', priceCents: 1500, stock: 0 },
    });
  });

  it('requires a signed-in user', async () => {
    const { status } = await client()('/api/orders', {
      method: 'POST',
      body: { items: [{ productId: product.id, quantity: 1 }] },
    });
    assert.equal(status, 401);
  });

  it('refuses to sell more than the stock', async () => {
    const { status, data } = await customer('/api/orders', {
      method: 'POST',
      body: { items: [{ productId: product.id, quantity: 4 }] },
    });
    assert.equal(status, 409);
    assert.match(data.error, /left in stock/);
  });

  it('takes an order through the queue to "shipped" and streams each stage', async () => {
    // Open the event stream first so that no stage can be missed.
    const stream = await customer('/api/events', { raw: true });
    assert.equal(stream.status, 200);
    assert.match(stream.headers.get('content-type'), /text\/event-stream/);

    const created = await customer('/api/orders', {
      method: 'POST',
      body: { items: [{ productId: product.id, quantity: 1 }] },
    });
    assert.equal(created.status, 201);
    assert.equal(created.data.order.totalCents, 1500);
    const orderId = created.data.order.id;

    const received = [];
    const reader = stream.body.pipeThrough(new TextDecoderStream()).getReader();
    const deadline = Date.now() + 30000;
    let buffer = '';
    while (!received.includes('shipped') && Date.now() < deadline) {
      const { value, done } = await Promise.race([reader.read(), sleep(2000).then(() => ({ value: '' }))]);
      if (done) break;
      buffer += value ?? '';
      for (const match of buffer.matchAll(/^data: (.+)$/gm)) {
        const event = JSON.parse(match[1]);
        if (event.orderId === orderId && !received.includes(event.status)) received.push(event.status);
      }
    }
    await reader.cancel();

    assert.deepEqual(received.slice(-4), ['processing', 'paid', 'packed', 'shipped']);

    const { data } = await customer(`/api/orders/${orderId}`);
    assert.equal(data.order.status, 'shipped');
    assert.ok(data.order.processedBy, 'the order records which worker handled it');
  });

  it('decreases the stock', async () => {
    const { data } = await client()(`/api/products/${product.id}`);
    assert.equal(data.product.stock, 2);
  });

  it('never oversells when customers race for the last units', async () => {
    const attempts = await Promise.all(
      Array.from({ length: 6 }, () =>
        customer('/api/orders', { method: 'POST', body: { items: [{ productId: product.id, quantity: 1 }] } }),
      ),
    );
    assert.equal(attempts.filter((attempt) => attempt.status === 201).length, 2);
    assert.equal(attempts.filter((attempt) => attempt.status === 409).length, 4);
    const { data } = await client()(`/api/products/${product.id}`);
    assert.equal(data.product.stock, 0);
  });

  it('hides orders from other customers', async () => {
    const stranger = client();
    await stranger('/api/auth/register', {
      method: 'POST',
      body: { name: 'Stranger', email: uniqueEmail(), password: 'correct horse battery' },
    });
    const mine = await customer('/api/orders');
    const { status } = await stranger(`/api/orders/${mine.data.orders[0].id}`);
    assert.equal(status, 404);
  });
});

describe('ops center', () => {
  it('is closed to customers', async () => {
    assert.equal((await customer('/api/ops/overview')).status, 403);
  });

  it('reports every running replica', async () => {
    const { status, data } = await admin('/api/ops/overview');
    assert.equal(status, 200);
    assert.ok(data.instances.filter((instance) => instance.role === 'api').length >= 2);
    assert.ok(data.instances.some((instance) => instance.role === 'worker'));
    assert.ok(data.totals.products >= 12);
  });

  it('counts the requests each replica has served', async () => {
    await sleep(2500); // replicas report every two seconds
    const { data } = await admin('/api/ops/overview');
    const served = data.instances.filter((i) => i.role === 'api').reduce((sum, i) => sum + i.requests, 0);
    assert.ok(served >= 50, `expected the earlier tests to be counted, saw ${served}`);
  });
});
