// Runs in Node (vitest), not in the app

import { describe, expect, it, vi } from 'vitest';

import { localSigner, newPrivateKey } from '../wallet/localSigner';

import { buildOrder } from './newOrder';
import { exporterRejects, exporterSigns } from './proposalFlow';
import { memoryProposalStore, newProposal } from './proposals';
import { recoverPurchaseOrderSigner } from './signOrder';

vi.mock('expo-crypto', () => ({ getRandomValues: (a: Uint8Array<ArrayBuffer>) => globalThis.crypto.getRandomValues(a) }));

const a = (n: number) => `0x${n.toString(16).padStart(40, '0')}` as const;
const SETUP = { chainId: 31337, escrow: a(0xe5c0) };
const NOW = 1_792_000_000;
const PAYOUT = a(0x33);

const importerSigner = localSigner(newPrivateKey());
const exporterSigner = localSigner(newPrivateKey());

async function proposal() {
  const built = buildOrder(
    {
      importer: await importerSigner.address(),
      supplier: { exporter: await exporterSigner.address(), payoutAddress: PAYOUT },
      orderNumber: 'PO0158',
      currency: 'USD',
      amountMinor: 4_800_000,
      incoterm: 'CIF',
      hsCodes: ['130231'],
      shipmentDeadline: NOW + 40 * 86_400,
      advanceBps: 5000,
      documentHash: `0x${'ab'.repeat(32)}`,
    },
    { token: a(0x44), carrier: a(0x55), arbiter: a(0x66), documentVerifier: a(0x77) },
    { now: NOW, nonce: 158n },
  );
  if (built.kind !== 'ready') throw new Error('not ready');
  return newProposal(built, 'Agar powder, 6,000 kg', NOW);
}

const ctx = { signer: exporterSigner, setup: SETUP, registeredPayout: PAYOUT, now: NOW };

describe('the exporter signs first', () => {
  it('stores a signature that recovers to the exporter and passes the order on to the importer', async () => {
    const { store } = memoryProposalStore();
    const p = await proposal();
    await store.save(p);
    const move = await exporterSigns(store, p, ctx);
    if (!move.ok) throw new Error(move.checks.join());
    expect(move.proposal.status).toBe('awaiting_importer');
    expect(await recoverPurchaseOrderSigner(SETUP, p.po, move.proposal.exporterSignature!)).toBe(p.po.exporter);
    expect(await store.get(p.orderId)).toEqual(move.proposal);
    // What was proposed is untouched
    expect(move.proposal.proposed).toEqual(p.proposed);
  });

  it('does not sign when the payout is not the one registered for this exporter', async () => {
    const { store } = memoryProposalStore();
    const p = await proposal();
    await store.save(p);
    expect(await exporterSigns(store, p, { ...ctx, registeredPayout: a(0x98) })).toEqual({ ok: false, checks: ['payout_not_registered'] });
    expect((await store.get(p.orderId))!.status).toBe('awaiting_exporter');
  });

  it('does not sign an order addressed to another wallet', async () => {
    const { store } = memoryProposalStore();
    const p = await proposal();
    const other = localSigner(newPrivateKey());
    expect(await exporterSigns(store, p, { ...ctx, signer: other })).toEqual({ ok: false, checks: ['wrong_exporter'] });
  });

  it('does not sign an order changed after it was sent', async () => {
    const { store } = memoryProposalStore();
    const p = await proposal();
    const changed = { ...p, po: { ...p.po, totalAmount: p.po.totalAmount * 2n } };
    const move = await exporterSigns(store, changed, ctx);
    expect(move.ok).toBe(false);
    expect(!move.ok && move.checks).toContain('changed_since_sent');
    expect(await store.list()).toEqual([]);
  });

  it('does not sign twice, or an order that is not waiting for the exporter', async () => {
    const { store } = memoryProposalStore();
    const p = await proposal();
    expect((await exporterSigns(store, { ...p, status: 'awaiting_importer' }, ctx)).ok).toBe(false);
    expect((await exporterSigns(store, { ...p, status: 'rejected' }, ctx)).ok).toBe(false);
  });
});

describe('the exporter refuses', () => {
  it('marks the proposal rejected and keeps it', async () => {
    const { store } = memoryProposalStore();
    const p = await proposal();
    await store.save(p);
    const rejected = await exporterRejects(store, p);
    expect(rejected.status).toBe('rejected');
    expect(rejected.exporterSignature).toBeUndefined();
    expect((await store.get(p.orderId))!.status).toBe('rejected');
  });
});
