// Runs in Node (vitest), not in the app

import { describe, expect, it, vi } from 'vitest';

import type { ProformaReading, ProformaResult } from '../ingest/proforma';

import { buildOrder, type TradeRegistry } from './newOrder';
import {
  advanceBpsOf,
  advanceFrom,
  advanceSplit,
  FIELD_WORDS,
  knownLine,
  formatCents,
  formatFullDay,
  missingOnProforma,
  nextOrderNumber,
  parseAmount,
  parseDay,
  parseHsCodes,
  parsePercent,
  PROBLEM_WORDS,
  proformaNotice,
  screenFormFrom,
  shipByLine,
  termsReadLine,
  toOrderForm,
} from './newOrderForm';

vi.mock('expo-crypto', () => ({ getRandomValues: (a: Uint8Array<ArrayBuffer>) => globalThis.crypto.getRandomValues(a) }));

const a = (n: number) => `0x${n.toString(16).padStart(40, '0')}` as const;
const NOV_20 = Date.UTC(2026, 10, 20) / 1000;
const HASH = `0x${'ab'.repeat(32)}` as const;
const REGISTRY: TradeRegistry = { token: a(0x44), carrier: a(0x55), arbiter: a(0x66), documentVerifier: a(0x77) };

const reading = (): ProformaReading => ({
  fileHash: HASH,
  input: 'text',
  proforma: {
    proforma_number: 'PI20260142',
    issue_date: 1_790_899_200,
    currency: 'USD',
    amount_minor: 4_800_000,
    incoterm: 'CIF',
    hs_codes: ['130231'],
    latest_shipment_date: NOV_20,
    port_of_loading: 'CNNGB',
    port_of_discharge: null,
    advance_bps: 5000,
    lines: [],
  },
  missing: ['port_of_discharge'],
  mentionsAccountChange: false,
  hiddenTextDetected: false,
});

describe('nextOrderNumber', () => {
  it('is the next number after the highest label, in hex, without the dash', () => {
    expect(nextOrderNumber(['PO-0157', 'PO-0142', 'PO-0131'])).toBe('PO0158');
    expect(nextOrderNumber(['PO-0159'])).toBe('PO015A');
    expect(nextOrderNumber(['PO-00ff'])).toBe('PO0100');
  });

  it('starts at PO0001 and ignores labels it does not know', () => {
    expect(nextOrderNumber([])).toBe('PO0001');
    expect(nextOrderNumber(['hello', 'PO-'])).toBe('PO0001');
  });
});

describe('amounts, dates and codes', () => {
  it('parses the total in cents', () => {
    expect(parseAmount('48,000.00')).toBe(4_800_000);
    expect(parseAmount('48000')).toBe(4_800_000);
    expect(parseAmount('0.5')).toBe(50);
    expect(parseAmount('12.345')).toBeNull();
    expect(parseAmount('abc')).toBeNull();
    expect(parseAmount('')).toBeNull();
    expect(formatCents(4_800_000)).toBe('48,000.00');
    expect(formatCents(null)).toBe('');
  });

  it('parses the day at midnight UTC in three spellings and refuses impossible dates', () => {
    const nov20 = Date.UTC(2026, 10, 20) / 1000;
    expect(parseDay('Nov 20, 2026')).toBe(nov20);
    expect(parseDay('20 November 2026')).toBe(nov20);
    expect(parseDay('2026-11-20')).toBe(nov20);
    expect(parseDay('Feb 30, 2026')).toBeNull();
    expect(parseDay('Foo 20, 2026')).toBeNull();
    expect(parseDay('tomorrow')).toBeNull();
    expect(formatFullDay(nov20)).toBe('Nov 20, 2026');
    expect(parseDay(formatFullDay(NOV_20))).toBe(NOV_20);
  });

  it('reads HS codes with dots, commas or spaces', () => {
    expect(parseHsCodes('1302.31, 350300  8207.50')).toEqual(['130231', '350300', '820750']);
    expect(parseHsCodes('')).toEqual([]);
  });

  it('reads a percentage into basis points', () => {
    expect(parsePercent('40')).toBe(4000);
    expect(parsePercent('12.5%')).toBe(1250);
    expect(parsePercent('100')).toBe(10_000);
    expect(parsePercent('101')).toBeNull();
    expect(parsePercent('x')).toBeNull();
  });
});

describe('advance', () => {
  it('maps the basis points of the reading to the segmented control', () => {
    expect(advanceFrom(null)).toEqual({ advance: null, advanceOther: '' });
    expect(advanceFrom(0)).toEqual({ advance: '0', advanceOther: '' });
    expect(advanceFrom(3000)).toEqual({ advance: '30', advanceOther: '' });
    expect(advanceFrom(5000)).toEqual({ advance: '50', advanceOther: '' });
    expect(advanceFrom(4000)).toEqual({ advance: 'other', advanceOther: '40' });
    expect(advanceFrom(1250)).toEqual({ advance: 'other', advanceOther: '12.5' });
    for (const bps of [0, 3000, 5000, 4000, 1250, 4025]) expect(advanceBpsOf(advanceFrom(bps))).toBe(bps);
  });

  it('splits the total in the advance and the balance', () => {
    expect(advanceSplit(4_800_000, 5000)).toEqual({ onSigning: 2_400_000n, onShipment: 2_400_000n });
    expect(advanceSplit(4_800_000, 0)).toEqual({ onSigning: 0n, onShipment: 4_800_000n });
    expect(advanceSplit(101, 5000)).toEqual({ onSigning: 50n, onShipment: 51n });
  });
});

describe('screenFormFrom', () => {
  it('fills the fields the proforma printed and leaves the others empty', () => {
    const form = screenFormFrom(reading(), 'PO0158');
    expect(form).toMatchObject({
      supplierId: null,
      goods: '',
      orderNumber: 'PO0158',
      currency: 'USD',
      amountText: '48,000.00',
      dayText: 'Nov 20, 2026',
      hsText: '130231',
      advance: '50',
      incoterm: 'CIF',
    });
  });

  it('leaves everything empty without a reading, or for what it did not print', () => {
    expect(screenFormFrom(undefined, 'PO0158')).toMatchObject({ currency: null, amountText: '', hsText: '', advance: null, incoterm: null });
    const r = reading();
    r.proforma.amount_minor = null;
    r.proforma.incoterm = null;
    expect(screenFormFrom(r, 'PO0158')).toMatchObject({ amountText: '', incoterm: null });
  });

  it('never takes the supplier or the order number from the proforma', () => {
    const form = screenFormFrom(reading(), 'PO0158');
    expect(form.supplierId).toBeNull();
    expect(form.orderNumber).not.toBe('PI20260142');
  });
});

describe('toOrderForm and buildOrder', () => {
  const supplier = { exporter: a(0x22), payoutAddress: a(0x33) };
  const NOW = 1_792_000_000;

  it('turns what the reading filled into a ready order', () => {
    const form = toOrderForm(screenFormFrom(reading(), 'po0158'), { importer: a(0x11), supplier, documentHash: HASH });
    expect(form).toMatchObject({ orderNumber: 'PO0158', amountMinor: 4_800_000, hsCodes: ['130231'], shipmentDeadline: NOV_20, advanceBps: 5000 });
    const built = buildOrder(form, REGISTRY, { now: NOW, nonce: 1n });
    expect(built.kind).toBe('ready');
  });

  it('is blocked until the supplier is chosen and the missing fields are filled', () => {
    const r = reading();
    r.proforma.amount_minor = null;
    const form = toOrderForm(screenFormFrom(r, 'PO0158'), { importer: a(0x11), supplier: undefined, documentHash: HASH });
    const built = buildOrder(form, REGISTRY, { now: NOW, nonce: 1n });
    expect(built).toMatchObject({ kind: 'blocked', fields: ['supplier', 'amount'] });
  });

  it('has words for every field and problem', () => {
    const built = buildOrder(
      toOrderForm(screenFormFrom(undefined, ''), { importer: a(0x11), supplier: undefined, documentHash: null }),
      REGISTRY,
      { now: NOW, nonce: 1n },
    );
    if (built.kind !== 'blocked') throw new Error('not blocked');
    for (const field of built.fields) expect(FIELD_WORDS[field]).toBeTruthy();
    for (const problem of Object.keys(PROBLEM_WORDS)) expect(PROBLEM_WORDS[problem as keyof typeof PROBLEM_WORDS]).toBeTruthy();
  });
});

describe('missingOnProforma', () => {
  it('maps the fields of the proforma to the fields of the form and drops the ones without an input', () => {
    expect(missingOnProforma(['port_of_discharge', 'amount_minor', 'latest_shipment_date', 'hs_codes', 'advance_bps', 'proforma_number'])).toEqual([
      'amount',
      'shipmentDeadline',
      'hsCodes',
      'advance',
    ]);
  });
});

describe('proformaNotice', () => {
  it('lets the importer fill the form by hand only when the file was unreadable', () => {
    expect(proformaNotice({ kind: 'unreadable', fileHash: HASH })).toMatchObject({ byHand: true });
    expect(proformaNotice('denied').byHand).toBe(false);
  });

  it('has a short sentence for every rejection and failure, and none repeats text from ingest', () => {
    const results: Exclude<ProformaResult, { kind: 'read' }>[] = [
      ...(['too_large', 'unsupported_media', 'bad_signature', 'stale_signature', 'not_an_importer', 'rate_limited', 'invalid_request'] as const).map(
        (reason) => ({ kind: 'rejected' as const, reason }),
      ),
      ...(['not_configured', 'network', 'server'] as const).map((reason) => ({ kind: 'failed' as const, reason })),
    ];
    const texts = results.map((r) => proformaNotice(r).text);
    expect(texts.every((t) => t.length > 10 && t.length < 100)).toBe(true);
    expect(texts.some((t) => t.includes('·'))).toBe(false);
  });
});

describe('lines of the New order screen', () => {
  it('says how many orders the supplier is known for', () => {
    expect(knownLine(4)).toBe('Known, 4 orders');
    expect(knownLine(1)).toBe('Known, 1 order');
    expect(knownLine(0)).toBe('Known supplier');
  });

  it('counts the terms the agent read as the fields that are not missing', () => {
    // 10 fields in a reading, one missing
    expect(termsReadLine(reading())).toBe('Uploaded. The agent read 9 terms.');
    const r = reading();
    r.missing = ['amount_minor', 'incoterm', 'hs_codes', 'issue_date', 'proforma_number', 'currency', 'advance_bps', 'port_of_loading', 'port_of_discharge'];
    expect(termsReadLine(r)).toBe('Uploaded. The agent read 1 term.');
  });

  it('writes the shipment line with the day and the incoterm', () => {
    expect(shipByLine(screenFormFrom(reading(), 'PO0158'))).toBe('Nov 20, CIF');
    expect(shipByLine({ dayText: '', incoterm: 'FOB' })).toBe('FOB');
    expect(shipByLine({ dayText: '', incoterm: null })).toBe('');
  });
});
