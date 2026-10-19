import { getLanguage, t } from '../i18n/translate';

import type { Metric, MetricKind } from './analysisInput';

// How the analysis reads on screen: the ids the model used (S1, HS codes) become the names this
// phone knows, and each cited metric gets a label. The names never left the phone.

export type Names = { counterparty: Record<string, string>; product: Record<string, string> };

export function displayText(text: string, names: Names): string {
  return text
    .replace(/\bHS\s*(\d{6,10})\b/g, (m, hs: string) => names.product[hs] ?? m)
    .replace(/\b(\d{6,10})\b/g, (m, hs: string) => names.product[hs] ?? m)
    .replace(/\bS(\d{1,2})\b/g, (m) => names.counterparty[m] ?? m);
}

const LABELS: Record<MetricKind, string> = {
  spend_month: 'Spend in the month',
  spend_period: 'Spend, last 90 days',
  spend_previous_period: 'Spend, the 90 days before',
  spend_change_pct: 'Change in spend',
  orders_period: 'Orders, last 90 days',
  average_order: 'Average order',
  counterparty_share_pct: 'Share of spend',
  top_counterparty_share_pct: 'Largest supplier share',
  counterparties: 'Suppliers in the year',
  product_share_pct: 'Share of spend',
  product_spend_change_pct: 'Change in spend',
  unit_price_change_pct: 'Change in price per unit',
  product_interval_days: 'Days between orders',
  product_next_order_in_days: 'Next order expected in',
  advance_paid_not_shipped: 'Advance paid, not shipped',
  balance_locked: 'Balance locked in escrow',
  deposits_to_fund: 'Deposits to make',
  average_advance_pct: 'Average advance',
  on_time_pct: 'Shipped on time',
  refunds: 'Refunds in the year',
  negotiated_advance_points: 'Advance negotiated',
  negotiated_amount_pct: 'Total negotiated',
};

// 48,000 in English, 48.000 in Spanish
const grouped = (n: number) => {
  const text = n.toLocaleString('en-US', { maximumFractionDigits: 0 });
  return getLanguage() === 'es' ? text.replace(/,/g, '.') : text;
};

const value = (m: Metric) => {
  switch (m.unit) {
    case 'usd':
      return `USD ${grouped(m.value)}`;
    case 'pct':
      return `${m.value}%`;
    case 'days':
      return t('{n} days', { n: m.value });
    case 'points':
      return `${m.value} ${t('pts')}`;
    default:
      return String(m.value);
  }
};

// "Share of spend, Lingnan: 71.4%"
export function metricLabel(m: Metric, names: Names): string {
  const subject = m.subject ? (names.counterparty[m.subject] ?? names.product[m.subject.split('/')[0]!] ?? m.subject) : undefined;
  return `${t(LABELS[m.kind])}${subject ? `, ${subject}` : ''}${m.kind === 'spend_month' && m.period ? ` ${m.period}` : ''}: ${value(m)}`;
}
