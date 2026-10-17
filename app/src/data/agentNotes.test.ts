import type { Hex, Incoterm } from '@keel/schemas';
import { bytes32Text } from '@keel/schemas/hash';
import { describe, expect, it, vi } from 'vitest';

import { agentNoteAction, agentNoteText } from './agentNoteText';
import { agentNotes, DEFAULT_NOTE_POLICY, type NotesInput } from './agentNotes';
import { centsToToken } from './amounts';
import type { Order } from './types';

// agentNoteText reuses the proforma warnings of newOrderForm, which loads expo-crypto
vi.mock('expo-crypto', () => ({ getRandomValues: (a: Uint8Array<ArrayBuffer>) => globalThis.crypto.getRandomValues(a) }));

const LINGNAN = { name: 'Lingnan Hydrocolloids', address: '0x00000000000000000000000000000000000000a1' as Hex };
const KOWLOON = { name: 'Kowloon Food Ingredients', address: '0x00000000000000000000000000000000000000c3' as Hex };
const NOW = 1_800_000_000;
const DAY = 86_400;

let id = 0;
const past = (cents: number, extra: Partial<Order> = {}, incoterm: Incoterm = 'FOB', exporter = LINGNAN.address): Order =>
  ({
    stage: 'settled',
    shippedAt: NOW - 30 * DAY,
    signedAt: NOW - 60 * DAY + id,
    ...extra,
    po: {
      orderId: `0x${(++id).toString(16).padStart(64, '0')}` as Hex,
      exporter,
      totalAmount: centsToToken(BigInt(cents)),
      shipmentDeadline: BigInt(NOW),
      incoterm: bytes32Text(incoterm),
    },
  }) as unknown as Order;

const input = (over: Partial<NotesInput> = {}): NotesInput => ({
  supplier: LINGNAN,
  totalCents: 4_800_000,
  advanceBps: 3000,
  shipmentDeadline: NOW + 40 * DAY,
  incoterm: 'FOB',
  orders: [past(4_800_000), past(4_600_000)],
  now: NOW,
  ...over,
});

const rules = (i: NotesInput) => agentNotes(i).map((n) => n.rule);

describe('agent notes', () => {
  it('says nothing when the order looks like the earlier ones', () => {
    expect(agentNotes(input())).toEqual([]);
  });

  it('suggests a 30% advance for a first order with a supplier', () => {
    const [note] = agentNotes(input({ supplier: KOWLOON, advanceBps: 5000, totalCents: 4_800_000 }));
    expect(note).toMatchObject({ rule: 'new_supplier_advance', suggestion: { field: 'advanceBps', value: 3000 } });
    expect(agentNoteText(note!)).toBe(
      'First order with Kowloon Food Ingredients: a 50% advance puts USD 24,000.00 at risk before anything ships. Suggest 30% (USD 14,400.00).',
    );
    expect(agentNoteAction(note!)).toBe('Use 30% advance');
    // 30% or less is already the safe advance
    expect(rules(input({ supplier: KOWLOON, advanceBps: 3000 }))).toEqual([]);
  });

  it('suggests a 30% advance when the supplier shipped late or not at all', () => {
    const orders = [past(4_800_000, { stage: 'refunded', shippedAt: undefined }), past(4_800_000, { shippedAt: NOW + DAY })];
    const [note] = agentNotes(input({ advanceBps: 5000, orders }));
    expect(note).toMatchObject({ rule: 'low_score_advance', facts: { onTime: 0, rated: 2 } });
    expect(rules(input({ advanceBps: 5000 }))).toEqual([]);
  });

  it('warns about a total out of the range the agent accepts, like the engine', () => {
    const notes = agentNotes(input({ totalCents: 9_400_000 }));
    expect(notes.map((n) => n.rule)).toEqual(['amount_out_of_range']);
    expect(agentNoteText(notes[0]!)).toBe(
      'The total is 100% above your average with Lingnan Hydrocolloids (USD 47,000.00, 2 orders). The agent will hold the deposit for your approval.',
    );
    // 25% is the engine's tolerance: inside it, no note
    expect(rules(input({ totalCents: 5_875_000 }))).toEqual([]);
    expect(rules(input({ totalCents: 5_876_000 }))).toEqual(['amount_out_of_range']);
    // One earlier order is not a history to compare with
    expect(rules(input({ totalCents: 9_400_000, orders: [past(4_800_000)] }))).toEqual([]);
  });

  it('leaves the order under review out of its own history', () => {
    const current = past(9_400_000, { stage: 'advance_paid', shippedAt: undefined });
    const orders = [past(4_800_000), past(4_600_000), current];
    expect(rules(input({ totalCents: 9_400_000, orders, excludeOrderId: current.po.orderId }))).toEqual(['amount_out_of_range']);
  });

  it('warns when the ship-by date is close', () => {
    expect(agentNotes(input({ shipmentDeadline: NOW + 2 * DAY + 1 }))).toMatchObject([{ rule: 'deadline_soon', facts: { days: 3 } }]);
    expect(rules(input({ shipmentDeadline: NOW + DEFAULT_NOTE_POLICY.deadlineWarningSeconds }))).toEqual([]);
  });

  it('notices an incoterm different from the usual one with the supplier', () => {
    const [note] = agentNotes(input({ incoterm: 'CIF' }));
    expect(agentNoteText(note!)).toBe('Your last 2 orders with Lingnan Hydrocolloids were FOB; this one is CIF. Check who pays freight and insurance.');
    const mixed = [past(4_800_000, {}, 'FOB'), past(4_800_000, {}, 'CIF')];
    expect(rules(input({ incoterm: 'CIF', orders: mixed }))).toEqual([]);
  });

  it('puts the proforma warnings first, with their fixed words and nothing from the document', () => {
    const notes = agentNotes(input({ supplier: KOWLOON, advanceBps: 5000, warnings: { accountChange: true, hiddenText: true } }));
    expect(notes.map((n) => n.rule)).toEqual(['account_change', 'hidden_text', 'new_supplier_advance']);
    for (const n of notes) expect(Object.values(n.facts).every((v) => typeof v === 'number' || [KOWLOON.name, 'above', 'below'].includes(v))).toBe(true);
  });

  it('only ever suggests an advance', () => {
    const all = agentNotes(input({ supplier: KOWLOON, advanceBps: 9000, totalCents: 1, shipmentDeadline: NOW + DAY, incoterm: 'EXW', warnings: { accountChange: true, hiddenText: true } }));
    expect(all.flatMap((n) => (n.suggestion ? [n.suggestion.field] : []))).toEqual(['advanceBps']);
  });

  it('keeps the engine thresholds it copies', () => {
    // engine/src/funding.ts DEFAULT_FUNDING_POLICY: change both together
    expect(DEFAULT_NOTE_POLICY.amountToleranceBps).toBe(2500);
    expect(DEFAULT_NOTE_POLICY.deadlineWarningSeconds).toBe(3 * 24 * 60 * 60);
  });
});
