/** Order lifecycle. A worker walks through `ORDER_FLOW`, one stage at a time. */
export const ORDER_FLOW = ['pending', 'processing', 'paid', 'packed', 'shipped'];
export const FINAL_STATES = new Set(['shipped', 'failed']);

/**
 * Returns the stages still to run. Because the worker resumes from the stored
 * status, a job that is picked up again after a worker crash does not repeat
 * finished stages and therefore never charges a customer twice.
 */
export function remainingStages(currentStatus) {
  if (FINAL_STATES.has(currentStatus)) return [];
  const index = ORDER_FLOW.indexOf(currentStatus);
  if (index === -1) throw new Error(`Unknown order status: ${currentStatus}`);
  return ORDER_FLOW.slice(index + 1);
}

/** Totals are computed from database prices, never from values sent by the browser. */
export function computeTotalCents(lines) {
  return lines.reduce((total, line) => total + line.priceCents * line.quantity, 0);
}
