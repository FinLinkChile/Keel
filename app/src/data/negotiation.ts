import type { Hex } from '@keel/schemas';

import { tokenToCents } from './amounts';
import type { Order } from './types';

// How the importer negotiated: what each proforma asked for against what was signed. The order's
// documentHash is the hash of its proforma, and the reading was kept with the order when it was
// sent, so the two can be compared. Orders without a reading are left out.

export type Negotiated = {
  orderId: Hex;
  askedAdvanceBps: number | null;
  agreedAdvanceBps: number;
  askedCents: number | null;
  agreedCents: number;
};

export type NegotiationSummary = {
  orders: Negotiated[];
  // Orders where the proforma printed an advance, and those signed with a lower one
  withAdvance: number;
  lowerAdvance: number;
  // Average of asked minus agreed, in percentage points; positive means you paid less upfront
  advancePointsSaved: number | null;
  // Average change of the total against the proforma, in percent; negative means you paid less
  amountChangePct: number | null;
};

const UNSIGNED = new Set<Order['stage']>(['awaiting_signature', 'rejected']);
const average = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);

export function negotiation(orders: readonly Order[], supplier?: Hex): NegotiationSummary {
  const quoted = orders.filter(
    (o) => o.quote && !UNSIGNED.has(o.stage) && (!supplier || o.po.exporter.toLowerCase() === supplier.toLowerCase()),
  );
  const rows: Negotiated[] = quoted.map((o) => ({
    orderId: o.po.orderId,
    askedAdvanceBps: o.quote!.advanceBps,
    agreedAdvanceBps: o.po.advanceBps,
    // A total in another currency than the order's cannot be compared without an agreed rate
    askedCents: o.quote!.currency === o.terms.currency ? o.quote!.amountCents : null,
    agreedCents: Number(tokenToCents(o.po.totalAmount)),
  }));
  const withAdvance = rows.filter((r) => r.askedAdvanceBps !== null);
  const withAmount = rows.filter((r) => r.askedCents !== null && r.askedCents > 0);
  const saved = average(withAdvance.map((r) => (r.askedAdvanceBps! - r.agreedAdvanceBps) / 100));
  const change = average(withAmount.map((r) => ((r.agreedCents - r.askedCents!) / r.askedCents!) * 100));
  return {
    orders: rows,
    withAdvance: withAdvance.length,
    lowerAdvance: withAdvance.filter((r) => r.agreedAdvanceBps < r.askedAdvanceBps!).length,
    advancePointsSaved: saved === null ? null : Math.round(saved * 10) / 10,
    amountChangePct: change === null ? null : Math.round(change * 10) / 10,
  };
}
