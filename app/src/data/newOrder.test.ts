// Runs in Node (vitest), not in the app

import { bytes32Text, requiredDocsHash, termsHash } from '@keel/schemas/hash';
import { describe, expect, it, vi } from 'vitest';

import type { ProformaReading } from '../ingest/proforma';

import {
  buildOrder,
  DEFAULT_DISPUTE_DAYS,
  documentHashOf,
  freshNonce,
  prefillFromProforma,
  REQUIRED_DOCS,
  shipmentDeadlineOf,
  type OrderForm,
  type TradeRegistry,
  type VerifiedSupplier,
} from './newOrder';
import { orderIdOf } from './orderRules';

vi.mock('expo-crypto', () => ({ getRandomValues: (a: Uint8Array<ArrayBuffer>) => globalThis.crypto.getRandomValues(a) }));

const a = (n: number) => `0x${n.toString(16).padStart(40, '0')}` as const;
const IMPORTER = a(0x11);
const SUPPLIER: VerifiedSupplier = { exporter: a(0x22), payoutAddress: a(0x33) };
const ATTACKER = a(0xbad);
const REGISTRY: TradeRegistry = { token: a(0x44), carrier: a(0x55), arbiter: a(0x66), documentVerifier: a(0x77) };
const NOW = 1_792_000_000;
const HASH = `0x${'ab'.repeat(32)}` as const;

const reading = (): ProformaReading => ({
  fileHash: HASH,
  input: 'text',
  proforma: {
    proforma_number: 'PI20260142',
    issue_date: 1_790_899_200,
    currency: 'USD',
    amount_minor: 2_000_000,
    incoterm: 'FOB',
    hs_codes: ['820750', '846721'],
    latest_shipment_date: 1_794_700_800,
    port_of_loading: 'CNNGB',
    port_of_discharge: 'CLSAI',
    advance_bps: 3000,
  },
  missing: [],
  mentionsAccountChange: false,
  hiddenTextDetected: false,
});

// A complete form: the prefill of the reading plus what only the importer can say
const form = (patch: Partial<OrderForm> = {}): OrderForm => ({
  importer: IMPORTER,
  supplier: SUPPLIER,
  orderNumber: 'PO0142',
  currency: null,
  amountMinor: null,
  incoterm: null,
  hsCodes: [],
  shipmentDeadline: null,
  advanceBps: null,
  documentHash: null,
  ...prefillFromProforma(reading()),
  ...patch,
});

const build = (f: OrderForm, nonce = 7n) => buildOrder(f, REGISTRY, { now: NOW, nonce });
const show = (v: unknown) => JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? x.toString() : x));

describe('prefillFromProforma', () => {
  it('fills the typed fields and nothing about who is paid or the order number', () => {
    const prefill = prefillFromProforma(reading());
    expect(Object.keys(prefill).sort()).toEqual(
      ['advanceBps', 'amountMinor', 'currency', 'documentHash', 'hsCodes', 'incoterm', 'shipmentDeadline'].sort(),
    );
    expect(prefill.documentHash).toBe(documentHashOf(HASH));
    expect(prefill.shipmentDeadline).toBe(shipmentDeadlineOf(1_794_700_800));
  });

  it('leaves a field the proforma does not print empty', () => {
    const r = reading();
    r.proforma.amount_minor = null;
    r.proforma.latest_shipment_date = null;
    r.proforma.hs_codes = [];
    expect(prefillFromProforma(r)).toMatchObject({ amountMinor: null, shipmentDeadline: null, hsCodes: [] });
  });
});

describe('buildOrder', () => {
  it('converts cents to token units and keeps the invoice amount in cents', () => {
    const built = build(form());
    if (built.kind !== 'ready') throw new Error(show(built));
    // 20,000.00 USD: 2,000,000 cents, 20,000,000,000 USDC units (6 decimals)
    expect(built.terms.invoiceAmountMinor).toBe(2_000_000n);
    expect(built.po.totalAmount).toBe(20_000_000_000n);
    expect(built.po.advanceBps).toBe(3000);
    expect(built.po.shipmentDeadline).toBe(1_794_700_800n);
    expect(built.po.disputeWindow).toBe(BigInt(DEFAULT_DISPUTE_DAYS * 86_400));
    expect(built.po.incoterm).toBe(bytes32Text('FOB'));
  });

  it('computes the hashes with the schemas helpers and takes the third parties from the registry', () => {
    const built = build(form(), 9n);
    if (built.kind !== 'ready') throw new Error(show(built));
    expect(built.terms).toEqual({
      orderNumber: 'PO0142',
      currency: 'USD',
      invoiceAmountMinor: 2_000_000n,
      hsCodes: ['820750', '846721'],
      documentHash: HASH,
    });
    expect(built.po.termsHash).toBe(termsHash(built.terms));
    expect(built.po.requiredDocsHash).toBe(requiredDocsHash(REQUIRED_DOCS));
    expect(built.po.orderId).toBe(orderIdOf(IMPORTER, SUPPLIER.exporter, 9n));
    expect(built.po.nonce).toBe(9n);
    expect(built.po).toMatchObject({ ...REGISTRY, importer: IMPORTER });
  });

  it('pays the verified supplier, never an address from the proforma', () => {
    // Even a reading that carried an account could not reach the order: the form has no such field
    const hostile = { ...reading(), payoutAddress: ATTACKER, exporter: ATTACKER } as unknown as ProformaReading;
    const built = build(form({ ...prefillFromProforma(hostile) }));
    if (built.kind !== 'ready') throw new Error(show(built));
    expect(built.po.exporter).toBe(SUPPLIER.exporter);
    expect(built.po.payoutAddress).toBe(SUPPLIER.payoutAddress);
    expect(show(built)).not.toContain(ATTACKER.slice(2));
  });

  it('does not use the proforma number as the order number', () => {
    const built = build(form({ orderNumber: 'PO0142' }));
    if (built.kind !== 'ready') throw new Error(show(built));
    expect(built.terms.orderNumber).toBe('PO0142');
    expect(built.terms.orderNumber).not.toBe(reading().proforma.proforma_number);
  });

  it('blocks and names each missing or invalid field', () => {
    const blocked = (patch: Partial<OrderForm>) => {
      const built = build(form(patch));
      return built.kind === 'blocked' ? built.fields : 'ready';
    };
    expect(blocked({ supplier: undefined })).toEqual(['supplier']);
    expect(blocked({ orderNumber: '' })).toEqual(['orderNumber']);
    expect(blocked({ orderNumber: 'po 1' })).toEqual(['orderNumber']);
    expect(blocked({ currency: null })).toEqual(['currency']);
    expect(blocked({ amountMinor: null })).toEqual(['amount']);
    expect(blocked({ amountMinor: 0 })).toEqual(['amount']);
    expect(blocked({ amountMinor: 10.5 })).toEqual(['amount']);
    expect(blocked({ incoterm: null })).toEqual(['incoterm']);
    expect(blocked({ hsCodes: [] })).toEqual(['hsCodes']);
    expect(blocked({ hsCodes: ['8207'] })).toEqual(['hsCodes']);
    expect(blocked({ shipmentDeadline: null })).toEqual(['shipmentDeadline']);
    expect(blocked({ advanceBps: null })).toEqual(['advance']);
    expect(blocked({ advanceBps: 10_001 })).toEqual(['advance']);
    expect(blocked({ documentHash: null })).toEqual(['documentHash']);
    expect(blocked({ documentHash: '0x12' })).toEqual(['documentHash']);
    // An empty form lists everything
    const empty = build({
      importer: IMPORTER,
      orderNumber: '',
      currency: null,
      amountMinor: null,
      incoterm: null,
      hsCodes: [],
      shipmentDeadline: null,
      advanceBps: null,
      documentHash: null,
    });
    expect(empty).toMatchObject({ kind: 'blocked', fields: expect.arrayContaining(['supplier', 'orderNumber', 'amount', 'hsCodes']) });
  });

  it('blocks a currency that is not the token instead of converting it', () => {
    expect(build(form({ currency: 'EUR' }))).toEqual({ kind: 'blocked', fields: [], problems: ['currency_is_not_the_token'] });
  });

  it('blocks what the escrow would refuse', () => {
    expect(build(form({ shipmentDeadline: NOW - 1 }))).toEqual({ kind: 'blocked', fields: [], problems: ['deadline_passed'] });
    const sameParties = build(form({ supplier: { exporter: IMPORTER, payoutAddress: SUPPLIER.payoutAddress } }));
    expect(sameParties).toMatchObject({ kind: 'blocked', problems: expect.arrayContaining(['same_parties']) });
    const payoutIsCarrier = build(form({ supplier: { ...SUPPLIER, payoutAddress: REGISTRY.carrier } }));
    expect(payoutIsCarrier).toMatchObject({ kind: 'blocked', problems: ['third_party_not_independent'] });
  });

  it('accepts a zero advance, a custom dispute window and mixed-case hashes', () => {
    const built = build(form({ advanceBps: 0, disputeDays: 5, documentHash: `0x${'AB'.repeat(32)}` }));
    if (built.kind !== 'ready') throw new Error(show(built));
    expect(built.po.advanceBps).toBe(0);
    expect(built.po.disputeWindow).toBe(5n * 86_400n);
    expect(built.terms.documentHash).toBe(HASH);
  });

  it('uses a fresh nonce each time unless one is given', () => {
    const one = buildOrder(form(), REGISTRY, { now: NOW });
    const two = buildOrder(form(), REGISTRY, { now: NOW });
    if (one.kind !== 'ready' || two.kind !== 'ready') throw new Error('not ready');
    expect(one.po.nonce).not.toBe(two.po.nonce);
    expect(one.po.orderId).not.toBe(two.po.orderId);
    expect(freshNonce()).toBeGreaterThan(0n);
  });
});
