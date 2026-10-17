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
  | 'amount_out_of_range'
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
  // The advance suggested when the supplier has no record or a weak one
  safeAdvanceBps: 3000,
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

  // The advance is paid before anything ships: with no record, or a weak one, less is at risk
  if (total !== null && total > 0 && advance !== null && advance > policy.safeAdvanceBps) {
    const score = supplierScore(history, supplier.address);
    const atRisk = (total * advance) / 10_000;
    const atRiskSuggested = (total * policy.safeAdvanceBps) / 10_000;
    const base = {
      supplier: supplier.name,
      advancePct: advance / 100,
      atRiskCents: Math.round(atRisk),
      suggestedPct: policy.safeAdvanceBps / 100,
      suggestedCents: Math.round(atRiskSuggested),
    };
    const suggestion = { field: 'advanceBps' as const, value: policy.safeAdvanceBps };
    if (score.stars === null) {
      notes.push({ rule: 'new_supplier_advance', tone: 'caution', facts: base, suggestion });
    } else if (score.stars < policy.minStars) {
      notes.push({ rule: 'low_score_advance', tone: 'caution', facts: { ...base, onTime: score.shippedOnTime, rated: score.rated }, suggestion });
    }
  }

  // Same comparison as the engine's amount-in-range rule, in cents
  if (total !== null && total > 0 && history.length >= policy.minHistory) {
    const amounts = history.map((o) => Number(tokenToCents(o.po.totalAmount)));
    const average = amounts.reduce((a, b) => a + b, 0) / amounts.length;
    if (average > 0 && Math.abs(total - average) * 10_000 > average * policy.amountToleranceBps) {
      notes.push({
        rule: 'amount_out_of_range',
        tone: 'caution',
        facts: { supplier: supplier.name, pct: Math.round((Math.abs(total - average) / average) * 100), direction: total > average ? 'above' : 'below', averageCents: Math.round(average), orders: amounts.length },
      });
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

const sorted = (notes: AgentNote[]) => [...notes].sort((a, b) => TONE_ORDER[a.tone] - TONE_ORDER[b.tone]);
