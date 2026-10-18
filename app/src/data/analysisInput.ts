import type { Hex } from '@keel/schemas';

import { tokenToCents } from './amounts';
import { negotiation } from './negotiation';
import type { Industry, SalesBracket } from './onboarding';
import { supplierScore } from './supplierScore';
import type { Order, Role } from './types';
import { unitPrice } from './unitPrice';

// What the analyst model receives: numbers computed here, each with an id it must cite. No names,
// no descriptions, no document text: counterparties are S1, S2... and products are HS codes, so
// nothing anybody typed or printed reaches the model. The app maps the ids back to names.

export const METRIC_KINDS = [
  'spend_month',
  'spend_period',
  'spend_previous_period',
  'spend_change_pct',
  'orders_period',
  'average_order',
  'counterparty_share_pct',
  'top_counterparty_share_pct',
  'counterparties',
  'product_share_pct',
  'product_spend_change_pct',
  'unit_price_change_pct',
  'product_interval_days',
  'product_next_order_in_days',
  'advance_paid_not_shipped',
  'balance_locked',
  'deposits_to_fund',
  'average_advance_pct',
  'on_time_pct',
  'refunds',
  'negotiated_advance_points',
  'negotiated_amount_pct',
] as const;
export type MetricKind = (typeof METRIC_KINDS)[number];

export type MetricUnit = 'usd' | 'pct' | 'days' | 'count' | 'points';

export type Metric = {
  id: string;
  kind: MetricKind;
  value: number;
  unit: MetricUnit;
  // S1, S2... for a counterparty, an HS code (with its unit for prices, "130231/KGM") for a product
  subject?: string;
  // "2026-09" for a month, "last_90d" or "previous_90d" for a period
  period?: string;
};

export type AnalysisInput = {
  role: Role;
  profile: { industry: Industry; salesBracket: SalesBracket } | null;
  // YYYY-MM-DD
  asOf: string;
  metrics: Metric[];
};

const DAY = 86_400;
const UNSIGNED = new Set<Order['stage']>(['awaiting_signature', 'rejected']);
const usd = (cents: number) => Math.round(cents) / 100;
const pct = (n: number) => Math.round(n * 10) / 10;
const cents = (o: Order) => Number(tokenToCents(o.po.totalAmount));
const month = (t: number) => new Date(t * 1000).toISOString().slice(0, 7);

type Input = {
  orders: readonly Order[];
  role: Role;
  profile: AnalysisInput['profile'];
  now: number;
};

// The metrics and the map from the ids sent to the model back to the counterparty addresses
export function analysisInput({ orders, role, profile, now }: Input): { input: AnalysisInput; counterparties: Record<string, Hex> } {
  const signed = orders.filter((o) => !UNSIGNED.has(o.stage) && o.signedAt !== undefined);
  const other = (o: Order) => (role === 'importer' ? o.po.exporter : o.po.importer).toLowerCase() as Hex;
  const product = (o: Order) => o.terms.hsCodes[0] ?? 'unknown';
  const metrics: Metric[] = [];
  const add = (m: Omit<Metric, 'id'>) => metrics.push({ id: `m${metrics.length + 1}`, ...m });

  // Counterparties as S1, S2... by spend over the last year
  const year = signed.filter((o) => o.signedAt! >= now - 365 * DAY);
  const byOther = new Map<Hex, number>();
  for (const o of year) byOther.set(other(o), (byOther.get(other(o)) ?? 0) + cents(o));
  const ranked = [...byOther.entries()].sort((a, b) => b[1] - a[1]);
  const idOf = new Map(ranked.map(([a], i) => [a, `S${i + 1}`]));
  const counterparties = Object.fromEntries(ranked.map(([a], i) => [`S${i + 1}`, a]));

  // Spend by month, last 6 months
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now * 1000);
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() - i);
    const key = d.toISOString().slice(0, 7);
    add({ kind: 'spend_month', value: usd(signed.filter((o) => month(o.signedAt!) === key).reduce((a, o) => a + cents(o), 0)), unit: 'usd', period: key });
  }

  // Last 90 days against the 90 before
  const last = signed.filter((o) => o.signedAt! >= now - 90 * DAY);
  const previous = signed.filter((o) => o.signedAt! >= now - 180 * DAY && o.signedAt! < now - 90 * DAY);
  const sum = (list: Order[]) => list.reduce((a, o) => a + cents(o), 0);
  add({ kind: 'spend_period', value: usd(sum(last)), unit: 'usd', period: 'last_90d' });
  add({ kind: 'spend_previous_period', value: usd(sum(previous)), unit: 'usd', period: 'previous_90d' });
  if (sum(previous) > 0) add({ kind: 'spend_change_pct', value: pct(((sum(last) - sum(previous)) / sum(previous)) * 100), unit: 'pct', period: 'last_90d' });
  add({ kind: 'orders_period', value: last.length, unit: 'count', period: 'last_90d' });
  if (year.length) add({ kind: 'average_order', value: usd(sum(year) / year.length), unit: 'usd', period: 'last_365d' });

  // Dependence on counterparties
  const yearTotal = sum(year);
  if (yearTotal > 0) {
    add({ kind: 'counterparties', value: ranked.length, unit: 'count', period: 'last_365d' });
    add({ kind: 'top_counterparty_share_pct', value: pct((ranked[0]![1] / yearTotal) * 100), unit: 'pct', subject: 'S1', period: 'last_365d' });
    for (const [address, spent] of ranked.slice(0, 5)) {
      add({ kind: 'counterparty_share_pct', value: pct((spent / yearTotal) * 100), unit: 'pct', subject: idOf.get(address), period: 'last_365d' });
      const score = supplierScore(orders, address);
      if (role === 'importer' && score.shipped > 0) {
        add({ kind: 'on_time_pct', value: pct((score.shippedOnTime / score.shipped) * 100), unit: 'pct', subject: idOf.get(address) });
      }
    }
  }

  // Products: share, trend, price per unit and rhythm
  const products = new Map<string, Order[]>();
  for (const o of signed) products.set(product(o), [...(products.get(product(o)) ?? []), o]);
  for (const [hs, list] of [...products.entries()].sort((a, b) => sum(b[1]) - sum(a[1])).slice(0, 5)) {
    const inYear = list.filter((o) => o.signedAt! >= now - 365 * DAY);
    if (yearTotal > 0 && inYear.length) add({ kind: 'product_share_pct', value: pct((sum(inYear) / yearTotal) * 100), unit: 'pct', subject: hs, period: 'last_365d' });
    const lastP = sum(list.filter((o) => o.signedAt! >= now - 90 * DAY));
    const prevP = sum(list.filter((o) => o.signedAt! >= now - 180 * DAY && o.signedAt! < now - 90 * DAY));
    if (prevP > 0) add({ kind: 'product_spend_change_pct', value: pct(((lastP - prevP) / prevP) * 100), unit: 'pct', subject: hs, period: 'last_90d' });

    const sorted = [...list].sort((a, b) => a.signedAt! - b.signedAt!);
    // Prices of the latest quote's currency only: another currency needs a rate nobody agreed
    const currency = [...sorted].reverse().find((o) => o.quote?.lines?.length)?.quote?.currency;
    const prices = sorted
      .filter((o) => o.quote?.currency === currency)
      .flatMap((o) => (o.quote?.lines ?? []).map(unitPrice).filter((p) => p && p.hsCode === hs).slice(0, 1));
    if (prices.length >= 3) {
      const latest = prices[prices.length - 1]!;
      const before = prices.slice(0, -1).filter((p) => p!.unit === latest.unit);
      if (before.length >= 2) {
        const average = before.reduce((a, p) => a + p!.centsPerUnit, 0) / before.length;
        add({ kind: 'unit_price_change_pct', value: pct(((latest.centsPerUnit - average) / average) * 100), unit: 'pct', subject: `${hs}/${latest.unit}` });
      }
    }
    if (sorted.length >= 3) {
      const gaps = sorted.slice(1).map((o, i) => (o.signedAt! - sorted[i]!.signedAt!) / DAY);
      const interval = gaps.reduce((a, b) => a + b, 0) / gaps.length;
      add({ kind: 'product_interval_days', value: Math.round(interval), unit: 'days', subject: hs });
      add({ kind: 'product_next_order_in_days', value: Math.round(sorted[sorted.length - 1]!.signedAt! / DAY + interval - now / DAY), unit: 'days', subject: hs });
    }
  }

  // Cash and risk, now
  const advance = (o: Order) => Number(tokenToCents((o.po.totalAmount * BigInt(o.po.advanceBps)) / 10_000n));
  add({ kind: 'advance_paid_not_shipped', value: usd(signed.filter((o) => o.stage === 'advance_paid').reduce((a, o) => a + advance(o), 0)), unit: 'usd' });
  add({ kind: 'balance_locked', value: usd(signed.filter((o) => o.stage === 'advance_paid' || o.stage === 'shipped').reduce((a, o) => a + cents(o) - advance(o), 0)), unit: 'usd' });
  add({ kind: 'deposits_to_fund', value: usd(signed.filter((o) => o.stage === 'signed').reduce((a, o) => a + cents(o), 0)), unit: 'usd' });
  if (year.length) add({ kind: 'average_advance_pct', value: pct(year.reduce((a, o) => a + o.po.advanceBps, 0) / year.length / 100), unit: 'pct', period: 'last_365d' });
  add({ kind: 'refunds', value: year.filter((o) => o.stage === 'refunded').length, unit: 'count', period: 'last_365d' });

  // What was negotiated against the proformas
  if (role === 'importer') {
    const deal = negotiation(orders);
    if (deal.advancePointsSaved !== null) add({ kind: 'negotiated_advance_points', value: deal.advancePointsSaved, unit: 'points' });
    if (deal.amountChangePct !== null) add({ kind: 'negotiated_amount_pct', value: deal.amountChangePct, unit: 'pct' });
  }

  return { input: { role, profile, asOf: new Date(now * 1000).toISOString().slice(0, 10), metrics }, counterparties };
}
