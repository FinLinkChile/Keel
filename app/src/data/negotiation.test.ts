import type { Hex } from '@keel/schemas';
import { describe, expect, it } from 'vitest';

import { centsToToken } from './amounts';
import { negotiation } from './negotiation';
import type { Order, Quote } from './types';

const LINGNAN = '0x00000000000000000000000000000000000000a1' as Hex;
const PEARL = '0x00000000000000000000000000000000000000a2' as Hex;

let n = 0;
const order = (agreedBps: number, agreedCents: number, quote?: Partial<Quote>, stage: Order['stage'] = 'settled', exporter = LINGNAN): Order =>
  ({
    stage,
    quote: quote && { currency: 'USD', amountCents: null, advanceBps: null, issueDate: null, latestShipmentDate: null, ...quote },
    terms: { currency: 'USD' },
    po: { orderId: `0x${(++n).toString(16).padStart(64, '0')}` as Hex, exporter, advanceBps: agreedBps, totalAmount: centsToToken(BigInt(agreedCents)) },
  }) as unknown as Order;

describe('negotiation', () => {
  it('compares what each proforma asked with what was signed', () => {
    const s = negotiation([
      order(3000, 4_800_000, { advanceBps: 5000, amountCents: 5_000_000 }),
      order(3000, 2_000_000, { advanceBps: 3000, amountCents: 2_000_000 }),
      // No reading kept: left out
      order(5000, 1_000_000),
    ]);
    expect(s.orders).toHaveLength(2);
    expect(s).toMatchObject({ withAdvance: 2, lowerAdvance: 1, advancePointsSaved: 10, amountChangePct: -2 });
  });

  it('leaves out unsigned orders, other suppliers and fields the proforma did not print', () => {
    const s = negotiation(
      [
        order(3000, 1_000_000, { advanceBps: 5000 }, 'awaiting_signature'),
        order(3000, 1_000_000, { advanceBps: 5000 }, 'settled', PEARL),
        order(2000, 1_000_000, { amountCents: 1_000_000 }),
      ],
      LINGNAN,
    );
    expect(s).toMatchObject({ withAdvance: 0, lowerAdvance: 0, advancePointsSaved: null, amountChangePct: 0 });
  });

  it('does not compare a total quoted in another currency', () => {
    const s = negotiation([order(3000, 4_800_000, { currency: 'CNY', amountCents: 35_000_000, advanceBps: 5000 })]);
    expect(s).toMatchObject({ amountChangePct: null, advancePointsSaved: 20 });
  });
});
