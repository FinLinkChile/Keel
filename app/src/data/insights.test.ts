import type { Hex } from '@keel/schemas';
import { describe, expect, it } from 'vitest';

import { centsToToken } from './amounts';
import { insights, type Period } from './insights';
import type { Order, Role } from './types';

const PACIFICO = '0x00000000000000000000000000000000000000a0' as Hex;
const LINGNAN = '0x00000000000000000000000000000000000000a1' as Hex;
const PEARL = '0x00000000000000000000000000000000000000a2' as Hex;
const NOW = 1_800_000_000;
const DAY = 86_400;

let n = 0;
const order = (stage: Order['stage'], totalCents: number, extra: Partial<Order> = {}, exporter = LINGNAN, hs = '130231'): Order =>
  ({
    label: `PO-${++n}`,
    goods: 'Agar powder',
    goodsShort: hs === '130231' ? 'Agar' : 'Carrageenan',
    stage,
    signedAt: NOW - 10 * DAY,
    documents: [],
    ...extra,
    terms: { hsCodes: [hs] },
    po: {
      orderId: `0x${n.toString(16).padStart(64, '0')}` as Hex,
      importer: PACIFICO,
      exporter,
      totalAmount: centsToToken(BigInt(totalCents)),
      advanceBps: 3000,
      shipmentDeadline: BigInt(NOW + 7 * DAY),
    },
  }) as unknown as Order;

const NAMES: Record<string, string> = { [PACIFICO]: 'Pacífico', [LINGNAN]: 'Lingnan', [PEARL]: 'Pearl Delta' };
const run = (orders: Order[], role: Role = 'importer', period: Period = 'all') =>
  insights({ orders, role, period, now: NOW, counterparty: (a) => ({ label: NAMES[a.toLowerCase()]!, stars: a === LINGNAN ? 5 : null }) });

describe('insights', () => {
  it('is empty without signed orders', () => {
    const r = run([order('awaiting_signature', 1_000_000), order('rejected', 1_000_000)]);
    expect(r).toMatchObject({ signed: [], totalCents: 0, averageCents: null, averageAdvanceBps: null, byCounterparty: [], upcoming: [] });
  });

  it('adds up purchases, what is locked and the advance at risk for the importer', () => {
    const r = run([
      order('advance_paid', 4_800_000),
      order('shipped', 2_000_000, { shippedAt: NOW - DAY, advancePaidAt: NOW - 9 * DAY }, PEARL, '130239'),
      order('settled', 1_000_000, { shippedAt: NOW - 2 * DAY, advancePaidAt: NOW - 9 * DAY }),
    ]);
    expect(r.totalCents).toBe(7_800_000);
    expect(r.averageCents).toBe(2_600_000);
    expect(r.averageAdvanceBps).toBe(3000);
    // Balances of the funded orders that have not settled: 70% of 48,000 and of 20,000
    expect(r.lockedCents).toBe(3_360_000 + 1_400_000);
    // Only the order paid but not shipped
    expect(r.advanceAtRiskCents).toBe(1_440_000);
    expect(r.shipments).toEqual({ shipped: 2, onTime: 2 });
    expect(r.byCounterparty.map((b) => [b.label, b.cents, b.orderIds.length, b.stars])).toEqual([
      ['Lingnan', 5_800_000, 2, 5],
      ['Pearl Delta', 2_000_000, 1, null],
    ]);
    expect(r.byProduct.map((b) => [b.label, b.cents])).toEqual([
      ['Agar', 5_800_000],
      ['Carrageenan', 2_000_000],
    ]);
  });

  it('shows the exporter its advances, released balances, buyers and documents', () => {
    const r = run(
      [
        order('settled', 1_000_000, { advancePaidAt: NOW - 9 * DAY, shippedAt: NOW - DAY, documents: [{ status: 'accepted' }] as Order['documents'] }),
        order('advance_paid', 4_800_000, { advancePaidAt: NOW - 5 * DAY, documents: [{ status: 'under_review' }] as Order['documents'] }),
        order('refunded', 2_000_000, { advancePaidAt: NOW - 9 * DAY }),
      ],
      'exporter',
    );
    expect(r.advancesCents).toBe(300_000 + 1_440_000 + 600_000);
    expect(r.releasedCents).toBe(700_000);
    expect(r.refunds).toEqual({ count: 1, cents: 1_400_000 });
    expect(r.documents).toEqual({ uploaded: 2, accepted: 1 });
    expect(r.byCounterparty).toMatchObject([{ label: 'Pacífico', cents: 7_800_000 }]);
    expect(r.byCounterparty[0]!.stars).toBeUndefined();
  });

  it('counts only the period, but what is locked and coming up stays current', () => {
    const old = order('advance_paid', 4_800_000, { signedAt: NOW - 120 * DAY });
    const r = run([old, order('settled', 1_000_000)], 'importer', '30d');
    expect(r.signed).toHaveLength(1);
    expect(r.totalCents).toBe(1_000_000);
    expect(r.lockedCents).toBe(3_360_000);
    expect(r.upcoming.map((u) => u.label)).toEqual([old.label]);
  });

  it('lists the ship-by dates of the next 14 days, soonest first', () => {
    const later = order('signed', 1);
    later.po = { ...later.po, shipmentDeadline: BigInt(NOW + 13 * DAY) };
    const soon = order('advance_paid', 1);
    const far = order('signed', 1);
    far.po = { ...far.po, shipmentDeadline: BigInt(NOW + 20 * DAY) };
    const r = run([later, soon, far, order('settled', 1)]);
    expect(r.upcoming.map((u) => u.label)).toEqual([soon.label, later.label]);
  });
});
