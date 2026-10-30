import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { computeTotalCents, remainingStages } from '../src/lib/order-state.js';

describe('remainingStages', () => {
  it('runs the whole flow for a new order', () => {
    assert.deepEqual(remainingStages('pending'), ['processing', 'paid', 'packed', 'shipped']);
  });

  it('resumes after the last finished stage when a job is retried', () => {
    assert.deepEqual(remainingStages('paid'), ['packed', 'shipped']);
  });

  it('does nothing for finished orders', () => {
    assert.deepEqual(remainingStages('shipped'), []);
    assert.deepEqual(remainingStages('failed'), []);
  });

  it('rejects an unknown status', () => {
    assert.throws(() => remainingStages('lost'), /Unknown order status/);
  });
});

describe('computeTotalCents', () => {
  it('adds up every line', () => {
    const lines = [
      { priceCents: 1000, quantity: 2 },
      { priceCents: 250, quantity: 3 },
    ];
    assert.equal(computeTotalCents(lines), 2750);
  });

  it('returns zero for no lines', () => {
    assert.equal(computeTotalCents([]), 0);
  });
});
