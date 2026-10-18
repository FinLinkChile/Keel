import type { Hex } from '@keel/schemas';

import { formatMinor } from '../ui/format';
import { t } from '../i18n/translate';

import { tokenToCents } from './amounts';
import type { Proposal } from './proposals';
import type { Role } from './types';

// What this phone did, newest first: the trail of the demo. Each line comes from a saved
// proposal, so nothing is shown that did not happen.

export type ActivityItem = {
  key: string;
  // Unix seconds
  at: number;
  title: string;
  detail: string;
};

// `names` maps a lowercase company address to its short name
export function activityFrom(proposals: readonly Proposal[], names: Record<string, string>, role: Role): ActivityItem[] {
  const name = (a: Hex) => names[a.toLowerCase()] ?? t('Unknown company');
  const items: ActivityItem[] = [];
  for (const p of proposals) {
    const amount = `${formatMinor(tokenToCents(p.po.totalAmount))} ${p.terms.currency}`;
    const what = p.goods ? `${p.goods}, ${amount}` : amount;
    items.push({
      key: `${p.orderId}:sent`,
      at: p.sentAt,
      title: role === 'importer' ? t('Sent {label} to {name}', { label: p.label, name: name(p.po.exporter) }) : t('{name} sent you {label}', { name: name(p.po.importer), label: p.label }),
      detail: what,
    });
    if (p.status === 'signed' && p.signedAt) {
      items.push({ key: `${p.orderId}:signed`, at: p.signedAt, title: t('{label} signed by both', { label: p.label }), detail: t('Waits for the deposit') });
    }
  }
  return items.sort((a, b) => b.at - a.at);
}
