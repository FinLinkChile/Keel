import type { Hex, Incoterm } from '@keel/schemas';

import { tokenToCents } from './amounts';
import { incotermText } from './signOrder';
import { supplierScore } from './supplierScore';
import type { Order } from './types';

// The agent's notes before signing. The agent reads (the quarantined extractor turned the proforma
// into typed fields); these rules compare those fields with the company's own orders and suggest.
// No model writes a note: each one is a rule with explicit thresholds, and its words come from a
// fixed template (agentNoteText.ts) that only receives numbers and names from the supplier book.
// A note never decides anything and can only suggest a different advance, never another payee,
// amount or currency. The engine applies its own rules again at funding.

export type NoteRule =
  | 'account_change'
  | 'hidden_text'
  | 'new_supplier_advance'
  | 'low_score_advance'
  | 'advance_above_usual'
  | 'amount_out_of_range'
  | 'amount_above_history'
  | 'deadline_soon'
  | 'incoterm_changed';

export type NoteTone = 'warning' | 'caution' | 'info';

export type AgentNote = {
  rule: NoteRule;
  tone: NoteTone;
  // The numbers and names the note was made from
  facts: Record<string, string | number>;
  // Only the advance can be suggested
  suggestion?: { field: 'advanceBps'; value: number };
};

export const DEFAULT_NOTE_POLICY = {
  // The advance suggested for a new or weak supplier only when the company has no history to
  // learn it from
  fallbackAdvanceBps: 3000,
  // Below this many stars a supplier's record is weak
  minStars: 3,
  // Comparisons need at least this many earlier orders
  minHistory: 2,
  // Same values as DEFAULT_FUNDING_POLICY in engine/src/funding.ts (the app does not import the
  // engine), so a note warns about what the agent will hold
  amountToleranceBps: 2500,
  deadlineWarningSeconds: 3 * 24 * 60 * 60,
} as const;

export type NotesInput = {
  supplier?: { name: string; address: Hex };
  totalCents: number | null;
  advanceBps: number | null;
  shipmentDeadline: number | null;
  incoterm: Incoterm | null;
  // The company's orders; the one under review, if any, is left out of its own history
  orders: readonly Order[];
  excludeOrderId?: Hex;
  warnings?: { accountChange: boolean; hiddenText: boolean };
  now: number;
};

const TONE_ORDER: Record<NoteTone, number> = { warning: 0, caution: 1, info: 2 };
const UNSIGNED = new Set<Order['stage']>(['awaiting_signature', 'rejected']);

export function agentNotes(input: NotesInput, policy = DEFAULT_NOTE_POLICY): AgentNote[] {
  const notes: AgentNote[] = [];
  const { supplier, totalCents: total, advanceBps: advance } = input;

  if (input.warnings?.accountChange) notes.push({ rule: 'account_change', tone: 'warning', facts: {} });
  if (input.warnings?.hiddenText) notes.push({ rule: 'hidden_text', tone: 'warning', facts: {} });

  if (input.shipmentDeadline !== null && input.shipmentDeadline > input.now) {
    const left = input.shipmentDeadline - input.now;
    if (left < policy.deadlineWarningSeconds) {
      notes.push({ rule: 'deadline_soon', tone: 'caution', facts: { days: Math.max(1, Math.ceil(left / 86_400)) } });
    }
  }

  if (!supplier) return sorted(notes);
  const history = input.orders.filter(
    (o) =>
      o.po.exporter.toLowerCase() === supplier.address.toLowerCase() &&
      !UNSIGNED.has(o.stage) &&
      (!input.excludeOrderId || o.po.orderId.toLowerCase() !== input.excludeOrderId.toLowerCase()),
  );

  // The advance is paid before anything ships. The suggestion is learned from the company's own
  // orders: what it usually pays this supplier, what it agreed on first orders with new
  // suppliers, or its usual advance overall. The fixed fallback is used only without history.
  if (total !== null && total > 0 && advance !== null) {
    const score = supplierScore(history, supplier.address);
    const signedAll = input.orders.filter(
      (o) => !UNSIGNED.has(o.stage) && (!input.excludeOrderId || o.po.orderId.toLowerCase() !== input.excludeOrderId.toLowerCase()),
    );
    const usual = learnedAdvance(signedAll, history, policy);
    const facts = (target: number, basis: AdvanceBasis, basisOrders: number) => ({
      supplier: supplier.name,
      advancePct: advance / 100,
      atRiskCents: Math.round((total * advance) / 10_000),
      suggestedPct: target / 100,
      suggestedCents: Math.round((total * target) / 10_000),
      basis,
      basisOrders,
    });
    const suggest = (value: number) => ({ field: 'advanceBps' as const, value });

    if (score.stars === null) {
      const { bps, basis, orders } = usual.firstOrders ?? usual.company ?? { bps: policy.fallbackAdvanceBps, basis: 'default' as const, orders: 0 };
      if (advance > bps) notes.push({ rule: 'new_supplier_advance', tone: 'caution', facts: facts(bps, basis, orders), suggestion: suggest(bps) });
    } else if (score.stars < policy.minStars) {
      // A weak record gets the lowest advance the company has agreed, never more than the fallback
      const lowest = usual.lowest && usual.lowest.bps < policy.fallbackAdvanceBps ? usual.lowest : { bps: policy.fallbackAdvanceBps, basis: 'default' as const, orders: 0 };
      if (advance > lowest.bps) {
        notes.push({
          rule: 'low_score_advance',
          tone: 'caution',
          facts: { ...facts(lowest.bps, lowest.basis, lowest.orders), onTime: score.shippedOnTime, rated: score.rated },
          suggestion: suggest(lowest.bps),
        });
      }
    } else if (usual.supplier && advance > usual.supplier.bps) {
      notes.push({ rule: 'advance_above_usual', tone: 'info', facts: facts(usual.supplier.bps, 'supplier', usual.supplier.orders), suggestion: suggest(usual.supplier.bps) });
    }
  }

  // Two comparisons with the orders placed with this supplier. Out of the engine's range (same
  // rule and tolerance as amount-in-range), the agent will hold the deposit; inside it but above
  // every earlier order, it is only worth a look.
  if (total !== null && total > 0 && history.length >= policy.minHistory) {
    const amounts = history.map((o) => Number(tokenToCents(o.po.totalAmount)));
    const average = amounts.reduce((a, b) => a + b, 0) / amounts.length;
    const range = { minCents: Math.min(...amounts), maxCents: Math.max(...amounts) };
    if (average > 0 && Math.abs(total - average) * 10_000 > average * policy.amountToleranceBps) {
      notes.push({
        rule: 'amount_out_of_range',
        tone: 'caution',
        facts: { supplier: supplier.name, pct: Math.round((Math.abs(total - average) / average) * 100), direction: total > average ? 'above' : 'below', averageCents: Math.round(average), orders: amounts.length, ...range },
      });
    } else if (total > range.maxCents) {
      notes.push({ rule: 'amount_above_history', tone: 'info', facts: { supplier: supplier.name, orders: amounts.length, ...range } });
    }
  }

  // The usual incoterm with this supplier, when the last orders agree on one
  if (input.incoterm && history.length >= policy.minHistory) {
    const recent = [...history].sort((a, b) => (b.signedAt ?? 0) - (a.signedAt ?? 0)).slice(0, 3);
    const usual = incotermText(recent[0]!.po.incoterm);
    if (usual && recent.every((o) => incotermText(o.po.incoterm) === usual) && usual !== input.incoterm) {
      notes.push({ rule: 'incoterm_changed', tone: 'info', facts: { supplier: supplier.name, usual, now: input.incoterm, orders: recent.length } });
    }
  }

  return sorted(notes);
}

export type AdvanceBasis = 'supplier' | 'first_orders' | 'company' | 'lowest' | 'default';
type Learned = { bps: number; basis: AdvanceBasis; orders: number };

const median = (values: number[]) => {
  const v = [...values].sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid]! : Math.round((v[mid - 1]! + v[mid]!) / 2);
};

// The advances the company has agreed, as medians so one unusual order does not move them
export function learnedAdvance(signed: readonly Order[], withSupplier: readonly Order[], policy = DEFAULT_NOTE_POLICY) {
  const enough = (orders: readonly Order[]) => orders.length >= policy.minHistory;
  const firsts = new Map<string, Order>();
  for (const o of [...signed].sort((a, b) => (a.signedAt ?? 0) - (b.signedAt ?? 0))) {
    const key = o.po.exporter.toLowerCase();
    if (!firsts.has(key)) firsts.set(key, o);
  }
  const first = [...firsts.values()];
  const learned = (orders: readonly Order[], basis: AdvanceBasis): Learned | undefined =>
    enough(orders) ? { bps: median(orders.map((o) => o.po.advanceBps)), basis, orders: orders.length } : undefined;
  return {
    supplier: learned(withSupplier, 'supplier'),
    firstOrders: learned(first, 'first_orders'),
    company: learned(signed, 'company'),
    lowest: enough(signed) ? { bps: Math.min(...signed.map((o) => o.po.advanceBps)), basis: 'lowest' as const, orders: signed.length } : undefined,
  };
}

const sorted = (notes: AgentNote[]) => [...notes].sort((a, b) => TONE_ORDER[a.tone] - TONE_ORDER[b.tone]);
