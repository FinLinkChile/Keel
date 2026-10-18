import { formatMinor } from '../ui/format';
import { t } from '../i18n/translate';

import type { AgentNote } from './agentNotes';
import { WARNING_ACCOUNT_CHANGE, WARNING_HIDDEN_TEXT } from './newOrderForm';

// The words of each note: fixed templates that only take the numbers and supplier names of the
// note. Nothing a document prints reaches the screen through here.

const BASIS: Record<string, (n: string | number) => string> = {
  supplier: (n) => t('what you agreed in your last {n} orders with them', { n }),
  first_orders: (n) => t('what you agreed on first orders with {n} suppliers', { n }),
  company: (n) => t('your usual advance over {n} orders', { n }),
  lowest: (n) => t('the lowest advance in your {n} orders', { n }),
  default: () => t('a cautious default, until you have more orders'),
};

const usd = (cents: string | number) => `USD ${formatMinor(BigInt(Math.round(Number(cents))))}`;
const pct = (value: string | number) => `${Number(value).toLocaleString('en-US', { maximumFractionDigits: 2 })}%`;

export function agentNoteText(note: AgentNote): string {
  const f = note.facts;
  switch (note.rule) {
    case 'account_change':
      return t(WARNING_ACCOUNT_CHANGE);
    case 'hidden_text':
      return t(WARNING_HIDDEN_TEXT);
    case 'new_supplier_advance':
      return t('First order with {supplier}: a {advance} advance puts {risk} at risk before anything ships. Suggest {suggested} ({amount}), {basis}.', { supplier: f.supplier!, advance: pct(f.advancePct!), risk: usd(f.atRiskCents!), suggested: pct(f.suggestedPct!), amount: usd(f.suggestedCents!), basis: BASIS[f.basis!]!(f.basisOrders!) });
    case 'low_score_advance':
      return t('{supplier} shipped on time in {onTime} of {rated} orders. Suggest {suggested} ({amount} instead of {risk}), {basis}.', { supplier: f.supplier!, onTime: f.onTime!, rated: f.rated!, suggested: pct(f.suggestedPct!), amount: usd(f.suggestedCents!), risk: usd(f.atRiskCents!), basis: BASIS[f.basis!]!(f.basisOrders!) });
    case 'advance_above_usual':
      return t('This order asks a {advance} advance. With {supplier} you usually agree {suggested}, {basis}.', { advance: pct(f.advancePct!), supplier: f.supplier!, suggested: pct(f.suggestedPct!), basis: BASIS[f.basis!]!(f.basisOrders!) });
    case 'amount_out_of_range':
      return t('The total is {pct}% {direction} your average with {supplier} ({average}; your {orders} orders ranged {min} to {max}). The agent will hold the deposit for your approval.', { pct: f.pct!, direction: t(String(f.direction)), supplier: f.supplier!, average: usd(f.averageCents!), orders: f.orders!, min: usd(f.minCents!), max: usd(f.maxCents!) });
    case 'amount_above_history':
      return t('This is your largest order with {supplier}: your {orders} earlier orders ranged {min} to {max}.', { supplier: f.supplier!, orders: f.orders!, min: usd(f.minCents!), max: usd(f.maxCents!) });
    case 'deadline_soon':
      return t(f.days === 1 ? 'The ship-by date is in {days} day. Check that the supplier can make it.' : 'The ship-by date is in {days} days. Check that the supplier can make it.', { days: f.days! });
    case 'incoterm_changed':
      return t('Your last {orders} orders with {supplier} were {usual}; this one is {now}. Check who pays freight and insurance.', { orders: f.orders!, supplier: f.supplier!, usual: f.usual!, now: f.now! });
  }
}

// What applying the suggestion does, for the button
export function agentNoteAction(note: AgentNote): string | undefined {
  return note.suggestion ? t('Use {pct} advance', { pct: pct(note.suggestion.value / 100) }) : undefined;
}
