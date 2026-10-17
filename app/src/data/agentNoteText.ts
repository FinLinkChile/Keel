import { formatMinor } from '../ui/format';

import type { AgentNote } from './agentNotes';
import { WARNING_ACCOUNT_CHANGE, WARNING_HIDDEN_TEXT } from './newOrderForm';
import { UNIT_WORDS } from './unitPrice';
import type { ProformaUnit } from '../ingest/proforma';

// The words of each note: fixed templates that only take the numbers and supplier names of the
// note. Nothing a document prints reaches the screen through here.

const BASIS: Record<string, (n: string | number) => string> = {
  supplier: (n) => `what you agreed in your last ${n} orders with them`,
  first_orders: (n) => `what you agreed on first orders with ${n} suppliers`,
  company: (n) => `your usual advance over ${n} orders`,
  lowest: (n) => `the lowest advance in your ${n} orders`,
  default: () => 'a cautious default, until you have more orders',
};

const usd = (cents: string | number) => `USD ${formatMinor(BigInt(Math.round(Number(cents))))}`;
// Cents, or up to 4 decimals for a price under a dollar (a screw, a gram)
const perUnit = (cents: string | number) =>
  `USD ${(Number(cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: Number(cents) < 100 ? 4 : 2 })}`;
const hs = (code: string | number) => `${String(code).slice(0, 4)}.${String(code).slice(4)}`;

const pct = (value: string | number) => `${Number(value).toLocaleString('en-US', { maximumFractionDigits: 2 })}%`;

export function agentNoteText(note: AgentNote): string {
  const f = note.facts;
  switch (note.rule) {
    case 'account_change':
      return WARNING_ACCOUNT_CHANGE;
    case 'hidden_text':
      return WARNING_HIDDEN_TEXT;
    case 'new_supplier_advance':
      return `First order with ${f.supplier}: a ${pct(f.advancePct!)} advance puts ${usd(f.atRiskCents!)} at risk before anything ships. Suggest ${pct(f.suggestedPct!)} (${usd(f.suggestedCents!)}), ${BASIS[f.basis!]!(f.basisOrders!)}.`;
    case 'low_score_advance':
      return `${f.supplier} shipped on time in ${f.onTime} of ${f.rated} orders. Suggest ${pct(f.suggestedPct!)} (${usd(f.suggestedCents!)} instead of ${usd(f.atRiskCents!)}), ${BASIS[f.basis!]!(f.basisOrders!)}.`;
    case 'advance_above_usual':
      return `This order asks a ${pct(f.advancePct!)} advance. With ${f.supplier} you usually agree ${pct(f.suggestedPct!)}, ${BASIS[f.basis!]!(f.basisOrders!)}.`;
    case 'amount_out_of_range':
      return `The total is ${f.pct}% ${f.direction} your average with ${f.supplier} (${usd(f.averageCents!)}; your ${f.orders} orders ranged ${usd(f.minCents!)} to ${usd(f.maxCents!)}). The agent will hold the deposit for your approval.`;
    case 'amount_above_history':
      return `This is your largest order with ${f.supplier}: your ${f.orders} earlier orders ranged ${usd(f.minCents!)} to ${usd(f.maxCents!)}.`;
    case 'unit_price_above_usual': {
      const unit = UNIT_WORDS[f.unit as ProformaUnit];
      return `HS ${hs(f.hsCode!)} costs ${perUnit(f.priceCents!)} per ${unit}, ${f.pct}% above your last ${f.orders} orders of it (${perUnit(f.averageCents!)} per ${unit} on average).`;
    }
    case 'deadline_soon':
      return `The ship-by date is in ${f.days} ${f.days === 1 ? 'day' : 'days'}. Check that the supplier can make it.`;
    case 'incoterm_changed':
      return `Your last ${f.orders} orders with ${f.supplier} were ${f.usual}; this one is ${f.now}. Check who pays freight and insurance.`;
  }
}

// What applying the suggestion does, for the button
export function agentNoteAction(note: AgentNote): string | undefined {
  return note.suggestion ? `Use ${pct(note.suggestion.value / 100)} advance` : undefined;
}
