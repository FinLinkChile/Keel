import type { Hex } from '@keel/schemas';
import { describe, expect, it } from 'vitest';

import { supplierScore } from './supplierScore';
import type { Order } from './types';

const LINGNAN = '0x00000000000000000000000000000000000000a1' as Hex;
const OTHER = '0x00000000000000000000000000000000000000b2' as Hex;
const DEADLINE = 1_000_000;

const order = (stage: Order['stage'], extra: Partial<Order> = {}, exporter = LINGNAN): Order =>
  ({ stage, documents: [], ...extra, po: { exporter, shipmentDeadline: BigInt(DEADLINE) } }) as unknown as Order;

describe('supplierScore', () => {
  it('has no score until an order ships or is refunded', () => {
    const s = supplierScore([order('signed'), order('advance_paid'), order('awaiting_signature')], LINGNAN);
    expect(s).toMatchObject({ orders: 2, rated: 0, stars: null });
  });

  it('gives five stars when every shipment was on time', () => {
    const s = supplierScore(
      [order('settled', { shippedAt: DEADLINE - 10 }), order('shipped', { shippedAt: DEADLINE }), order('advance_paid')],
      LINGNAN,
    );
    expect(s).toMatchObject({ orders: 3, shipped: 2, shippedOnTime: 2, completed: 1, rated: 2, stars: 5 });
  });

  it('counts a late shipment and a refund against the supplier', () => {
    const s = supplierScore(
      [order('settled', { shippedAt: DEADLINE - 1 }), order('shipped', { shippedAt: DEADLINE + 1 }), order('refunded'), order('settled', { shippedAt: 1 })],
      LINGNAN,
    );
    // 2 on time out of 4 outcomes
    expect(s).toMatchObject({ shipped: 3, shippedOnTime: 2, refunded: 1, rated: 4, stars: 2.5 });
  });

  it('leaves out cancellations, unsigned orders and other suppliers', () => {
    const s = supplierScore(
      [order('cancelled'), order('rejected'), order('settled', { shippedAt: 1 }, OTHER), order('settled', { shippedAt: 1 })],
      LINGNAN.toUpperCase().replace('0X', '0x') as Hex,
    );
    expect(s).toMatchObject({ orders: 2, cancelled: 1, rated: 1, stars: 5 });
  });

  it('rounds to half stars', () => {
    const on = order('settled', { shippedAt: 1 });
    const s = supplierScore([on, on, on, order('refunded')], LINGNAN);
    // 3 of 4 is 3.75, shown as 4
    expect(s.stars).toBe(4);
  });

  it('measures how early it ships, its documents and how fast it signs', () => {
    const DAY = 86_400;
    const s = supplierScore(
      [
        order('settled', { shippedAt: DEADLINE - 4 * DAY, documents: [{ status: 'accepted' }] as Order['documents'], sentAt: 0, exporterSignedAt: DAY }),
        order('shipped', { shippedAt: DEADLINE + DAY, documents: [{ status: 'under_review' }] as Order['documents'], sentAt: 0, exporterSignedAt: 2 * DAY }),
        order('advance_paid'),
      ],
      LINGNAN,
    );
    // (4 days early + 1 day late) / 2
    expect(s.marginDays).toBe(1.5);
    expect(s.documents).toEqual({ uploaded: 2, accepted: 1 });
    expect(s.signDays).toBe(1.5);
    expect(supplierScore([order('signed')], LINGNAN)).toMatchObject({ marginDays: null, signDays: null, documents: { uploaded: 0, accepted: 0 } });
  });
});
