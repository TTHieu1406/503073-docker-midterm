import { describe, expect, it } from 'vitest';
import { addLine, countItems, formatPrice, MAX_QUANTITY, setQuantity, totalCents } from './cart.js';

const keyboard = { id: 1, name: 'Keyboard', category: 'Keyboards', priceCents: 12900 };
const cable = { id: 2, name: 'Cable', category: 'Accessories', priceCents: 2900 };

describe('cart', () => {
  it('adds a new line', () => {
    expect(addLine([], keyboard)).toHaveLength(1);
  });

  it('increases the quantity of a product already in the cart', () => {
    const lines = addLine(addLine([], keyboard), keyboard, 2);
    expect(lines).toHaveLength(1);
    expect(lines[0].quantity).toBe(3);
  });

  it('never exceeds the maximum quantity', () => {
    const lines = addLine([], keyboard);
    expect(setQuantity(lines, 1, 500)[0].quantity).toBe(MAX_QUANTITY);
  });

  it('removes a line when its quantity reaches zero', () => {
    expect(setQuantity(addLine([], keyboard), 1, 0)).toEqual([]);
  });

  it('counts items and adds up the total', () => {
    const lines = addLine(addLine([], keyboard, 2), cable);
    expect(countItems(lines)).toBe(3);
    expect(totalCents(lines)).toBe(28700);
  });

  it('formats cents as dollars', () => {
    expect(formatPrice(12900)).toBe('$129.00');
  });
});
