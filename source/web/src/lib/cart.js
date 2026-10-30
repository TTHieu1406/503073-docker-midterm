/** Pure cart logic, kept apart from React so it can be unit tested. */

export const MAX_QUANTITY = 20;

export function addLine(lines, product, quantity = 1) {
  const existing = lines.find((line) => line.id === product.id);
  if (existing) {
    return setQuantity(lines, product.id, existing.quantity + quantity);
  }
  return [
    ...lines,
    { id: product.id, name: product.name, category: product.category, priceCents: product.priceCents, quantity },
  ];
}

export function setQuantity(lines, id, quantity) {
  if (quantity <= 0) return lines.filter((line) => line.id !== id);
  return lines.map((line) => (line.id === id ? { ...line, quantity: Math.min(quantity, MAX_QUANTITY) } : line));
}

export const countItems = (lines) => lines.reduce((count, line) => count + line.quantity, 0);

export const totalCents = (lines) => lines.reduce((total, line) => total + line.priceCents * line.quantity, 0);

export const formatPrice = (cents) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
