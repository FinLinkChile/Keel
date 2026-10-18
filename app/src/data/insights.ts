import type { Hex } from '@keel/schemas';

import { tokenToCents } from './amounts';
import type { Order, Role } from './types';

// The numbers of the agent panel: what the company bought (importer) or sold (exporter), what is
// at stake now and how the other side delivered. Plain sums over the orders, in integer cents,
// each with the orders behind it so a number can be traced back. No model is involved.

export type Period = '30d' | '90d' | 'all';

export type Bar = { key: string; label: string; cents: number; orderIds: Hex[]; stars?: number | null };

export type Upcoming = { orderId: Hex; label: string; goods: string; deadline: number };

export type Insights = {
  // Orders signed by both in the period
  signed: Hex[];
  totalCents: number;
  averageCents: number | null;
  averageAdvanceBps: number | null;
  // Now, whatever the period: the balance held by the escrow
  lockedCents: number;
  // Importer: advances paid for orders that have not shipped yet
  advanceAtRiskCents: number;
  // Exporter: advances received, and balances released to it
  advancesCents: number;
  releasedCents: number;
  refunds: { count: number; cents: number };
  shipments: { shipped: number; onTime: number };
  // Orders with documents uploaded, and those whose documents were all accepted
  documents: { uploaded: number; accepted: number };
  byCounterparty: Bar[];
  byProduct: Bar[];
  upcoming: Upcoming[];
};

const DAY = 86_400;
const PERIOD_DAYS: Record<Exclude<Period, 'all'>, number> = { '30d': 30, '90d': 90 };
const UNSIGNED = new Set<Order['stage']>(['awaiting_signature', 'rejected']);
const OPEN = new Set<Order['stage']>(['signed', 'advance_paid']);

const cents = (o: Order) => Number(tokenToCents(o.po.totalAmount));
const advanceCents = (o: Order) => Number(tokenToCents((o.po.totalAmount * BigInt(o.po.advanceBps)) / 10_000n));

type Input = {
  orders: readonly Order[];
  role: Role;
  period: Period;
  now: number;
  // Name and score of each counterparty, by lowercase address
  counterparty: (address: Hex) => { label: string; stars?: number | null };
};

export function insights({ orders, role, period, now, counterparty }: Input): Insights {
  const signedAll = orders.filter((o) => !UNSIGNED.has(o.stage));
  const since = period === 'all' ? -Infinity : now - PERIOD_DAYS[period] * DAY;
  const inPeriod = signedAll.filter((o) => (o.signedAt ?? now) >= since);

  const total = inPeriod.reduce((a, o) => a + cents(o), 0);
  const balance = (o: Order) => cents(o) - advanceCents(o);

  const shipped = inPeriod.filter((o) => o.shippedAt !== undefined);
  const withDocs = inPeriod.filter((o) => o.documents.length > 0);

  const group = (keyOf: (o: Order) => string, labelOf: (o: Order) => string, extra?: (o: Order) => Partial<Bar>): Bar[] => {
    const bars = new Map<string, Bar>();
    for (const o of inPeriod) {
      const key = keyOf(o);
      const bar = bars.get(key) ?? { key, label: labelOf(o), cents: 0, orderIds: [], ...extra?.(o) };
      bar.cents += cents(o);
      bar.orderIds.push(o.po.orderId);
      bars.set(key, bar);
    }
    return [...bars.values()].sort((a, b) => b.cents - a.cents);
  };
  const otherSide = (o: Order) => (role === 'importer' ? o.po.exporter : o.po.importer);

  return {
    signed: inPeriod.map((o) => o.po.orderId),
    totalCents: total,
    averageCents: inPeriod.length ? Math.round(total / inPeriod.length) : null,
    averageAdvanceBps: inPeriod.length ? Math.round(inPeriod.reduce((a, o) => a + o.po.advanceBps, 0) / inPeriod.length) : null,
    lockedCents: signedAll.filter((o) => o.stage === 'advance_paid' || o.stage === 'shipped').reduce((a, o) => a + balance(o), 0),
    advanceAtRiskCents: signedAll.filter((o) => o.stage === 'advance_paid').reduce((a, o) => a + advanceCents(o), 0),
    advancesCents: inPeriod.filter((o) => o.advancePaidAt !== undefined).reduce((a, o) => a + advanceCents(o), 0),
    releasedCents: inPeriod.filter((o) => o.stage === 'settled').reduce((a, o) => a + balance(o), 0),
    refunds: {
      count: inPeriod.filter((o) => o.stage === 'refunded').length,
      cents: inPeriod.filter((o) => o.stage === 'refunded').reduce((a, o) => a + balance(o), 0),
    },
    shipments: { shipped: shipped.length, onTime: shipped.filter((o) => BigInt(o.shippedAt!) <= o.po.shipmentDeadline).length },
    documents: { uploaded: withDocs.length, accepted: withDocs.filter((o) => o.documents.every((d) => d.status === 'accepted')).length },
    byCounterparty: group(
      (o) => otherSide(o).toLowerCase(),
      (o) => counterparty(otherSide(o)).label,
      (o) => (role === 'importer' ? { stars: counterparty(otherSide(o)).stars ?? null } : {}),
    ),
    byProduct: group(
      (o) => o.terms.hsCodes[0] ?? o.goods,
      (o) => o.goodsShort || o.goods,
    ),
    upcoming: signedAll
      .filter((o) => OPEN.has(o.stage) && Number(o.po.shipmentDeadline) >= now && Number(o.po.shipmentDeadline) <= now + 14 * DAY)
      .sort((a, b) => Number(a.po.shipmentDeadline - b.po.shipmentDeadline))
      .map((o) => ({ orderId: o.po.orderId, label: o.label, goods: o.goods, deadline: Number(o.po.shipmentDeadline) })),
  };
}
