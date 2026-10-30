import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { shouldDeliver } from '../src/lib/event-filter.js';

describe('shouldDeliver', () => {
  const event = { type: 'order.updated', userId: 3 };

  it('sends an order update to its owner', () => {
    assert.equal(shouldDeliver(event, { id: 3, role: 'customer' }), true);
  });

  it('keeps it away from other customers', () => {
    assert.equal(shouldDeliver(event, { id: 4, role: 'customer' }), false);
  });

  it('always sends it to admins', () => {
    assert.equal(shouldDeliver(event, { id: 1, role: 'admin' }), true);
  });

  it('sends catalog changes to everyone', () => {
    assert.equal(shouldDeliver({ type: 'catalog.updated' }, { id: 4, role: 'customer' }), true);
  });
});
