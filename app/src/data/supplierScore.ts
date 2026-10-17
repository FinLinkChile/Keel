import type { Hex } from '@keel/schemas';

import type { Order } from './types';

// How a supplier has delivered on the orders this company signed with it. Only facts that the
// flow records count: a shipment on or before the signed deadline, the balance released, a refund
// because nothing shipped in time. No written reviews, so nobody can raise a score by typing. The
// score informs the importer; who is paid and how much still come from the signed order.

export type SupplierScore = {
  // Orders signed by both, in any stage
  orders: number;
  shipped: number;
  shippedOnTime: number;
  // Balance released: the documents matched the order, or the importer approved it
  completed: number;
  // Nothing shipped by the deadline, so the importer got the balance back
  refunded: number;
  cancelled: number;
  // Orders with an outcome that counts: shipped, or refunded
  rated: number;
  // 0 to 5 in halves; null until some order has an outcome
  stars: number | null;
};

const UNSIGNED = new Set<Order['stage']>(['awaiting_signature', 'rejected']);

export function supplierScore(orders: readonly Order[], supplier: Hex): SupplierScore {
  const mine = orders.filter((o) => o.po.exporter.toLowerCase() === supplier.toLowerCase() && !UNSIGNED.has(o.stage));
  const shipped = mine.filter((o) => o.shippedAt !== undefined);
  const shippedOnTime = shipped.filter((o) => BigInt(o.shippedAt!) <= o.po.shipmentDeadline).length;
  const refunded = mine.filter((o) => o.stage === 'refunded').length;
  const rated = shipped.length + refunded;
  return {
    orders: mine.length,
    shipped: shipped.length,
    shippedOnTime,
    completed: mine.filter((o) => o.stage === 'settled').length,
    refunded,
    cancelled: mine.filter((o) => o.stage === 'cancelled').length,
    rated,
    stars: rated === 0 ? null : Math.round((10 * shippedOnTime) / rated) / 2,
  };
}
