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
const past = (cents: number, extra: Partial<Order> = {}, incoterm: Incoterm = 'FOB', exporter = LINGNAN.address, advanceBps = 3000): Order =>
  ({
    stage: 'settled',
    documents: [],
    shippedAt: NOW - 30 * DAY,
    signedAt: NOW - 60 * DAY + id,
    ...extra,
    po: {
      orderId: `0x${(++id).toString(16).padStart(64, '0')}` as Hex,
      exporter,
      totalAmount: centsToToken(BigInt(cents)),
      advanceBps,
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

  it('without history, suggests the cautious default for a first order with a supplier', () => {
    const [note] = agentNotes(input({ supplier: KOWLOON, advanceBps: 5000, orders: [] }));
    expect(note).toMatchObject({ rule: 'new_supplier_advance', suggestion: { field: 'advanceBps', value: 3000 }, facts: { basis: 'default' } });
    expect(agentNoteText(note!)).toBe(
      'First order with Kowloon Food Ingredients: a 50% advance puts USD 24,000.00 at risk before anything ships. Suggest 30% (USD 14,400.00), a cautious default, until you have more orders.',
    );
    expect(agentNoteAction(note!)).toBe('Use 30% advance');
  });

  it('learns the first-order advance from how the company started with other suppliers', () => {
    const PEARL = '0x00000000000000000000000000000000000000b2' as Hex;
    // First orders: 20% with Lingnan, 20% with Pearl Delta; later Lingnan orders at 50% do not count
    const orders = [
      past(4_800_000, { signedAt: NOW - 90 * DAY }, 'FOB', LINGNAN.address, 2000),
      past(4_800_000, { signedAt: NOW - 30 * DAY }, 'FOB', LINGNAN.address, 5000),
      past(2_000_000, { signedAt: NOW - 80 * DAY }, 'FOB', PEARL, 2000),
    ];
    const [note] = agentNotes(input({ supplier: KOWLOON, advanceBps: 3000, orders }));
    expect(note).toMatchObject({ rule: 'new_supplier_advance', suggestion: { value: 2000 }, facts: { basis: 'first_orders', basisOrders: 2 } });
    expect(agentNoteText(note!)).toContain('Suggest 20% (USD 9,600.00), what you agreed on first orders with 2 suppliers.');
    // At or below what the company usually starts with, no note
    expect(rules(input({ supplier: KOWLOON, advanceBps: 2000, orders }))).toEqual([]);
  });

  it('for a supplier that shipped late, suggests the lowest advance the company has agreed', () => {
    const orders = [
      past(4_800_000, { stage: 'refunded', shippedAt: undefined }, 'FOB', LINGNAN.address, 5000),
      past(4_800_000, { shippedAt: NOW + DAY }, 'FOB', LINGNAN.address, 1000),
    ];
    const [note] = agentNotes(input({ advanceBps: 5000, orders }));
    expect(note).toMatchObject({ rule: 'low_score_advance', suggestion: { value: 1000 }, facts: { onTime: 0, rated: 2, basis: 'lowest' } });
    // Never above the cautious default, even when every earlier advance was higher
    const high = orders.map((o) => ({ ...o, po: { ...o.po, advanceBps: 6000 } }));
    expect(agentNotes(input({ advanceBps: 5000, orders: high }))[0]).toMatchObject({ suggestion: { value: 3000 }, facts: { basis: 'default' } });
  });

  it('with a supplier that delivers, compares with the advance usually agreed with it', () => {
    const [note] = agentNotes(input({ advanceBps: 5000 }));
    expect(note).toMatchObject({ rule: 'advance_above_usual', tone: 'info', suggestion: { value: 3000 }, facts: { basis: 'supplier', basisOrders: 2 } });
    expect(agentNoteText(note!)).toBe('This order asks a 50% advance. With Lingnan Hydrocolloids you usually agree 30%, what you agreed in your last 2 orders with them.');
    expect(rules(input({ advanceBps: 3000 }))).toEqual([]);
  });

  it('warns about a total out of the range the agent accepts, like the engine', () => {
    const notes = agentNotes(input({ totalCents: 9_400_000 }));
    expect(notes.map((n) => n.rule)).toEqual(['amount_out_of_range']);
    expect(agentNoteText(notes[0]!)).toBe(
      'The total is 100% above your average with Lingnan Hydrocolloids (USD 47,000.00; your 2 orders ranged USD 46,000.00 to USD 48,000.00). The agent will hold the deposit for your approval.',
    );
    // 25% is the engine's tolerance: inside it the agent does not hold, but above every earlier
    // order it is worth a look
    expect(rules(input({ totalCents: 5_875_000 }))).toEqual(['amount_above_history']);
    expect(rules(input({ totalCents: 4_700_000 }))).toEqual([]);
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
    const allowed = [KOWLOON.name, 'above', 'below', 'supplier', 'first_orders', 'company', 'lowest', 'default'];
    for (const n of notes) expect(Object.values(n.facts).every((v) => typeof v === 'number' || allowed.includes(v))).toBe(true);
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

  describe('price per unit', () => {
    const line = (quantity: number, unit: 'KGM' | 'TNE' | 'CT', cents: number, hs = '130231') => ({ hs_code: hs, quantity, unit, amount_minor: cents });
    // Earlier orders of agar, from any supplier, with the lines their proforma printed
    const withLines = (cents: number, signedAt: number, unit: 'KGM' | 'TNE' | 'CT' = 'KGM', quantity = 6000) =>
      past(cents, { signedAt, quote: { amountCents: cents, advanceBps: 3000, issueDate: null, latestShipmentDate: null, lines: [line(quantity, unit, cents)] } });
    const history = [withLines(4_200_000, NOW - 10 * DAY), withLines(4_380_000, NOW - 20 * DAY), withLines(4_260_000, NOW - 30 * DAY), withLines(1, NOW - 40 * DAY)];

    it('flags a price per unit well above the last orders of the same product', () => {
      // USD 8.00/kg against 7.00, 7.30 and 7.10 (the oldest order is past the last 3)
      const notes = agentNotes(input({ supplier: undefined, orders: history, lines: [line(6000, 'KGM', 4_800_000)] }));
      expect(notes.map((n) => n.rule)).toEqual(['unit_price_above_usual']);
      expect(agentNoteText(notes[0]!)).toBe('HS 1302.31 costs USD 8.00 per kg, 12% above your last 3 orders of it (USD 7.13 per kg on average).');
    });

    it('compares tons with kilos, but never cartons with kilos', () => {
      expect(rules(input({ supplier: undefined, orders: history, lines: [line(6, 'TNE', 4_800_000)] }))).toEqual(['unit_price_above_usual']);
      expect(rules(input({ supplier: undefined, orders: history, lines: [line(100, 'CT', 4_800_000)] }))).toEqual([]);
    });

    it('stays quiet within 10%, for another product, or with less than 2 earlier orders', () => {
      expect(rules(input({ supplier: undefined, orders: history, lines: [line(6000, 'KGM', 4_700_000)] }))).toEqual([]);
      expect(rules(input({ supplier: undefined, orders: history, lines: [line(6000, 'KGM', 4_800_000, '130232')] }))).toEqual([]);
      expect(rules(input({ supplier: undefined, orders: history.slice(0, 1), lines: [line(6000, 'KGM', 9_000_000)] }))).toEqual([]);
    });
  });
});
