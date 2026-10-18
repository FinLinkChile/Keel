import type { Hex } from '@keel/schemas';
import { describe, expect, it } from 'vitest';

import { analysisInput, METRIC_KINDS } from './analysisInput';
import { centsToToken } from './amounts';
import type { Order } from './types';

const PACIFICO = '0x00000000000000000000000000000000000000a0' as Hex;
const LINGNAN = '0x00000000000000000000000000000000000000a1' as Hex;
const PEARL = '0x00000000000000000000000000000000000000a2' as Hex;
const NOW = Date.UTC(2026, 9, 17) / 1000;
const DAY = 86_400;

let n = 0;
const order = (daysAgo: number, totalCents: number, exporter = LINGNAN, extra: Partial<Order> = {}, hs = '130231'): Order =>
  ({
    label: `PO-${++n}`,
    goods: 'Agar powder from the secret recipe of Ms. Rojas',
    goodsShort: 'Agar',
    stage: 'settled',
    signedAt: NOW - daysAgo * DAY,
    shippedAt: NOW - daysAgo * DAY + 10 * DAY,
    documents: [],
    ...extra,
    terms: { hsCodes: [hs] },
    po: {
      orderId: `0x${n.toString(16).padStart(64, '0')}` as Hex,
      importer: PACIFICO,
      exporter,
      totalAmount: centsToToken(BigInt(totalCents)),
      advanceBps: 3000,
      shipmentDeadline: BigInt(NOW + 400 * DAY),
    },
  }) as unknown as Order;

const ORDERS = [
  order(150, 2_000_000),
  order(120, 2_000_000, PEARL, {}, '130239'),
  order(100, 2_000_000),
  order(50, 4_000_000),
  order(10, 4_000_000, LINGNAN, { stage: 'advance_paid', shippedAt: undefined }),
];
const run = () => analysisInput({ orders: ORDERS, role: 'importer', profile: { industry: 'food', salesBracket: 'small' }, now: NOW });
const find = (kind: string, subject?: string) => run().input.metrics.find((m) => m.kind === kind && (subject === undefined || m.subject === subject));

describe('analysisInput', () => {
  it('names counterparties S1, S2 by spend and keeps the map on the phone', () => {
    const { input, counterparties } = run();
    expect(counterparties).toEqual({ S1: LINGNAN, S2: PEARL });
    expect(find('top_counterparty_share_pct')).toMatchObject({ subject: 'S1', value: 85.7 });
    expect(input.profile).toEqual({ industry: 'food', salesBracket: 'small' });
  });

  it('compares the last 90 days with the 90 before', () => {
    // Last 90: 40,000 + 40,000; previous: 20,000 + 20,000 + 20,000
    expect(find('spend_period')!.value).toBe(80_000);
    expect(find('spend_previous_period')!.value).toBe(60_000);
    expect(find('spend_change_pct')!.value).toBe(33.3);
    expect(find('product_spend_change_pct', '130231')!.value).toBe(100);
  });

  it('learns the rhythm of a product and when the next order would be', () => {
    // Agar every 46.7 days: 150, 100, 50, 10 days ago
    expect(find('product_interval_days', '130231')!.value).toBe(47);
    expect(find('product_next_order_in_days', '130231')!.value).toBe(37);
  });

  it('reports the money at stake now', () => {
    expect(find('advance_paid_not_shipped')!.value).toBe(12_000);
    expect(find('balance_locked')!.value).toBe(28_000);
  });

  it('sends only numbers, closed kinds and ids: no names, no descriptions', () => {
    const { input } = run();
    const text = JSON.stringify(input);
    for (const word of ['Lingnan', 'Pearl', 'Agar', 'Rojas', LINGNAN.slice(2), PEARL.slice(2)]) expect(text).not.toContain(word);
    for (const m of input.metrics) {
      expect(METRIC_KINDS).toContain(m.kind);
      expect(m.id).toMatch(/^m\d+$/);
      expect(typeof m.value).toBe('number');
      if (m.subject) expect(m.subject).toMatch(/^(S\d+|\d{6,10}(\/[A-Z]{2,3})?)$/);
      if (m.period) expect(m.period).toMatch(/^(\d{4}-\d{2}|last_90d|previous_90d|last_365d)$/);
    }
  });
});
