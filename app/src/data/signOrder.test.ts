// Runs in Node (vitest), not in the app

import { describe, expect, it, vi } from 'vitest';

import { localSigner, newPrivateKey } from '../wallet/localSigner';

import { buildOrder } from './newOrder';
import {
  checkForExporter,
  checkOrder,
  CHECK_WORDS,
  differenceWords,
  escrowFrom,
  incotermText,
  orderDifferences,
  payoutHistory,
  recoverPurchaseOrderSigner,
  signingSetup,
  signPurchaseOrder,
} from './signOrder';

vi.mock('expo-crypto', () => ({ getRandomValues: (a: Uint8Array<ArrayBuffer>) => globalThis.crypto.getRandomValues(a) }));

const a = (n: number) => `0x${n.toString(16).padStart(40, '0')}` as const;
const ESCROW = a(0xe5c0);
const SETUP = { chainId: 31337, escrow: ESCROW };
const NOW = 1_792_000_000;

const importerSigner = localSigner(newPrivateKey());
const exporterSigner = localSigner(newPrivateKey());

// A real order from buildOrder, between the two test wallets
async function order() {
  const form = {
    importer: await importerSigner.address(),
    supplier: { exporter: await exporterSigner.address(), payoutAddress: a(0x33) },
    orderNumber: 'PO0158',
    currency: 'USD' as const,
    amountMinor: 4_800_000,
    incoterm: 'CIF' as const,
    hsCodes: ['130231'],
    shipmentDeadline: NOW + 40 * 86_400,
    advanceBps: 5000,
    documentHash: `0x${'ab'.repeat(32)}` as const,
  };
  const built = buildOrder(form, { token: a(0x44), carrier: a(0x55), arbiter: a(0x66), documentVerifier: a(0x77) }, { now: NOW, nonce: 158n });
  if (built.kind !== 'ready') throw new Error(JSON.stringify(built, (_, v) => (typeof v === 'bigint' ? v.toString() : v)));
  return { po: built.po, terms: built.terms };
}

describe('the escrow and the signing setup', () => {
  it('accepts a real address and never a placeholder', () => {
    expect(escrowFrom(ESCROW)).toBe(ESCROW);
    expect(escrowFrom(`  ${ESCROW}  `)).toBe(ESCROW);
    expect(escrowFrom(undefined)).toBeUndefined();
    expect(escrowFrom('')).toBeUndefined();
    expect(escrowFrom('0xdeadbeef')).toBeUndefined();
    expect(escrowFrom('not an address')).toBeUndefined();
    expect(escrowFrom('0x0000000000000000000000000000000000000000')).toBeUndefined();
  });

  it('disables signing when the escrow or the chain is missing', () => {
    expect(signingSetup({ chainId: 31337, escrowAddress: ESCROW })).toEqual(SETUP);
    expect(signingSetup({ chainId: 31337 })).toBeUndefined();
    expect(signingSetup({ escrowAddress: ESCROW })).toBeUndefined();
    expect(signingSetup({})).toBeUndefined();
  });
});

describe('signing a PurchaseOrder', () => {
  it('recovers to the exporter that signed it, with the schemas types and the Keel domain', async () => {
    const { po } = await order();
    const signature = await signPurchaseOrder(exporterSigner, SETUP, po);
    expect(await recoverPurchaseOrderSigner(SETUP, po, signature)).toBe(po.exporter);
  });

  it('recovers the importer too, and a signature by the wrong key is not the exporter', async () => {
    const { po } = await order();
    const byImporter = await signPurchaseOrder(importerSigner, SETUP, po);
    expect(await recoverPurchaseOrderSigner(SETUP, po, byImporter)).toBe(po.importer);
    expect(await recoverPurchaseOrderSigner(SETUP, po, byImporter)).not.toBe(po.exporter);
  });

  it('does not recover the same signer when the order, the escrow or the chain is different', async () => {
    const { po } = await order();
    const signature = await signPurchaseOrder(exporterSigner, SETUP, po);
    const other = (setup: typeof SETUP, p = po) => recoverPurchaseOrderSigner(setup, p, signature);
    expect(await other({ ...SETUP, escrow: a(0xbad) })).not.toBe(po.exporter);
    expect(await other({ ...SETUP, chainId: 1 })).not.toBe(po.exporter);
    expect(await other(SETUP, { ...po, payoutAddress: a(0xbad) })).not.toBe(po.exporter);
    expect(await other(SETUP, { ...po, totalAmount: po.totalAmount + 1n })).not.toBe(po.exporter);
    expect(await other(SETUP, { ...po, shipmentDeadline: po.shipmentDeadline + 1n })).not.toBe(po.exporter);
  });

  it('gives undefined for a signature that is not one', async () => {
    const { po } = await order();
    expect(await recoverPurchaseOrderSigner(SETUP, po, '0x1234')).toBeUndefined();
  });

  it('reads the incoterm of the order', async () => {
    expect(incotermText((await order()).po.incoterm)).toBe('CIF');
  });
});

describe('checking an order before signing', () => {
  it('finds nothing wrong with the order that was sent', async () => {
    const o = await order();
    expect(checkOrder(o, o, { now: NOW, escrow: ESCROW })).toEqual([]);
    const ctx = { exporter: o.po.exporter, registeredPayout: o.po.payoutAddress, now: NOW, escrow: ESCROW };
    expect(checkForExporter(o, o, ctx)).toEqual([]);
  });

  it('detects a changed payout, amount or deadline and names the field', async () => {
    const sent = await order();
    const tamper = (changes: Partial<typeof sent.po>) => ({ po: { ...sent.po, ...changes }, terms: sent.terms });
    for (const [changes, field] of [
      [{ payoutAddress: a(0xbad) }, 'payoutAddress'],
      [{ totalAmount: sent.po.totalAmount + 1n }, 'totalAmount'],
      [{ shipmentDeadline: sent.po.shipmentDeadline + 86_400n }, 'shipmentDeadline'],
    ] as const) {
      const changed = tamper(changes);
      expect(orderDifferences(changed, sent)).toEqual([field]);
      expect(checkOrder(changed, sent, { now: NOW })).toContain('changed_since_sent');
    }
  });

  it('detects terms that do not match their hash, and an order id that does not match the parties', async () => {
    const sent = await order();
    const badTerms = { po: sent.po, terms: { ...sent.terms, invoiceAmountMinor: sent.terms.invoiceAmountMinor + 1n } };
    expect(checkOrder(badTerms, badTerms, { now: NOW })).toContain('terms_hash');
    expect(orderDifferences(badTerms, sent)).toEqual(['terms.invoiceAmountMinor']);
    const badId = { po: { ...sent.po, nonce: sent.po.nonce + 1n }, terms: sent.terms };
    expect(checkOrder(badId, badId, { now: NOW })).toContain('order_id');
  });

  it('refuses what the escrow would refuse: a past deadline and a wallet used twice', async () => {
    const o = await order();
    expect(checkOrder(o, o, { now: Number(o.po.shipmentDeadline) + 1 })).toEqual(['deadline_passed']);
    const twice = { po: { ...o.po, carrier: o.po.payoutAddress }, terms: o.terms };
    expect(checkOrder(twice, twice, { now: NOW })).toContain('third_party_not_independent');
  });

  it('blocks an order for another wallet, or one that pays an account that is not registered', async () => {
    const o = await order();
    const base = { exporter: o.po.exporter, registeredPayout: o.po.payoutAddress, now: NOW };
    expect(checkForExporter(o, o, { ...base, exporter: a(0x99) })).toEqual(['wrong_exporter']);
    expect(checkForExporter(o, o, { ...base, registeredPayout: a(0x98) })).toEqual(['payout_not_registered']);
    expect(checkForExporter(o, o, { ...base, registeredPayout: undefined })).toEqual(['payout_not_registered']);
  });

  it('has words for every check', () => {
    for (const check of Object.keys(CHECK_WORDS)) expect(CHECK_WORDS[check as keyof typeof CHECK_WORDS].length).toBeGreaterThan(10);
  });
});

describe('what the importer compares', () => {
  it('names the changed fields in words', () => {
    expect(differenceWords(['payoutAddress', 'totalAmount', 'terms.documentHash', 'somethingNew'])).toEqual([
      'payout account',
      'total',
      'proforma',
      'somethingNew',
    ]);
  });

  it('says whether the payout account is the same as in earlier orders with that supplier', async () => {
    const o = await order();
    const other = (payoutAddress: `0x${string}`, orderId = a(0x1)) => ({ po: { orderId, exporter: o.po.exporter, payoutAddress } });
    expect(payoutHistory([], o.po)).toEqual({ same: 0, different: 0 });
    expect(payoutHistory([other(o.po.payoutAddress), other(o.po.payoutAddress, a(0x2)), other(a(0x98), a(0x3))], o.po)).toEqual({ same: 2, different: 1 });
    // The order itself and orders with another supplier do not count
    expect(payoutHistory([{ po: o.po }, { po: { ...other(a(0x98)).po, exporter: a(0x77) } }], o.po)).toEqual({ same: 0, different: 0 });
  });
});
