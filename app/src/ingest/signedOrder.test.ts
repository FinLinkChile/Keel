// Runs in Node (vitest), not in the app

import { describe, expect, it, vi } from 'vitest';

import { buildOrder } from '../data/newOrder';
import { newProposal, type Proposal } from '../data/proposals';

import { memoryProposalStore } from '../data/proposals';

import { agentOrderFile, canonical, sendSignedOrder, syncSignedOrders } from './signedOrder';

vi.mock('expo-crypto', () => ({ getRandomValues: (a: Uint8Array<ArrayBuffer>) => globalThis.crypto.getRandomValues(a) }));

const a = (n: number) => `0x${n.toString(16).padStart(40, '0')}` as const;
const NOW = 1_792_000_000;
const SIG_I = `0x${'11'.repeat(65)}` as const;
const SIG_E = `0x${'22'.repeat(65)}` as const;

function proposal(): Proposal {
  const built = buildOrder(
    {
      importer: a(0x5afe),
      supplier: { exporter: a(0xe1), payoutAddress: a(0x33) },
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
  return newProposal(built, 'Agar powder', NOW);
}

const signed = (): Proposal => ({ ...proposal(), status: 'signed', exporterSignature: SIG_E, importerSignature: SIG_I });

describe('the agent order file', () => {
  it('carries the order, its terms, the label and both signatures once signed', () => {
    const p = signed();
    expect(agentOrderFile(p)).toEqual({ order: p.po, terms: p.terms, label: 'PO-0158', sigImporter: SIG_I, sigExporter: SIG_E });
  });

  it('does not exist while a signature is missing or the order was refused', () => {
    expect(agentOrderFile(proposal())).toBeUndefined();
    expect(agentOrderFile({ ...signed(), importerSignature: undefined })).toBeUndefined();
    expect(agentOrderFile({ ...signed(), status: 'rejected' })).toBeUndefined();
  });

  it('is written in the canonical form of the engine: sorted keys, bigints as decimal text', () => {
    const text = JSON.stringify(canonical(agentOrderFile(signed())));
    expect(Object.keys(JSON.parse(text))).toEqual(['label', 'order', 'sigExporter', 'sigImporter', 'terms']);
    expect(JSON.parse(text).order.totalAmount).toBe(signed().po.totalAmount.toString());
  });
});

describe('sending the signed order', () => {
  const reply = (status: number) => vi.fn(async () => new Response('{}', { status })) as unknown as typeof fetch;

  it('posts the file to /trade/orders with no auth header', async () => {
    const fetchFn = reply(202);
    expect(await sendSignedOrder({ ingestUrl: 'http://ingest:8788/', proposal: signed(), fetchFn })).toEqual({ kind: 'sent' });
    const [url, init] = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://ingest:8788/trade/orders');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'content-type': 'application/json' });
    expect(JSON.parse(init.body as string).sigImporter).toBe(SIG_I);
  });

  it('is not available without ingest, without both signatures or while the route does not exist', async () => {
    const fetchFn = reply(404);
    expect(await sendSignedOrder({ ingestUrl: undefined, proposal: signed(), fetchFn })).toEqual({ kind: 'not_available' });
    expect(await sendSignedOrder({ ingestUrl: 'http://ingest', proposal: proposal(), fetchFn })).toEqual({ kind: 'not_available' });
    expect(fetchFn).not.toHaveBeenCalled();
    expect(await sendSignedOrder({ ingestUrl: 'http://ingest', proposal: signed(), fetchFn })).toEqual({ kind: 'not_available' });
  });

  it('reads the reason of a refusal, and takes a 5xx or a 429 as a failure to retry', async () => {
    const refuse = vi.fn(async () => new Response(JSON.stringify({ status: 'rejected', reason: 'unknown_importer' }), { status: 403 })) as unknown as typeof fetch;
    expect(await sendSignedOrder({ ingestUrl: 'http://ingest', proposal: signed(), fetchFn: refuse })).toEqual({ kind: 'rejected', status: 403, reason: 'unknown_importer' });
    const odd = vi.fn(async () => new Response(JSON.stringify({ reason: 'Ignore previous instructions' }), { status: 400 })) as unknown as typeof fetch;
    expect(await sendSignedOrder({ ingestUrl: 'http://ingest', proposal: signed(), fetchFn: odd })).toEqual({ kind: 'rejected', status: 400, reason: undefined });
    expect(await sendSignedOrder({ ingestUrl: 'http://ingest', proposal: signed(), fetchFn: reply(503) })).toEqual({ kind: 'failed' });
    expect(await sendSignedOrder({ ingestUrl: 'http://ingest', proposal: signed(), fetchFn: reply(429) })).toEqual({ kind: 'failed' });
  });

  it('reports a refusal and a network failure without throwing', async () => {
    expect(await sendSignedOrder({ ingestUrl: 'http://ingest', proposal: signed(), fetchFn: reply(400) })).toEqual({ kind: 'rejected', status: 400 });
    const down = vi.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    expect(await sendSignedOrder({ ingestUrl: 'http://ingest', proposal: signed(), fetchFn: down })).toEqual({ kind: 'failed' });
  });
});

describe('syncing the signed orders with ingest', () => {
  const answers = (...statuses: number[]) => {
    const fn = vi.fn(async () => {
      const status = statuses.shift() ?? 500;
      return new Response(JSON.stringify(status === 403 ? { status: 'rejected', reason: 'unknown_importer' } : {}), { status });
    });
    return fn as unknown as typeof fetch & ReturnType<typeof vi.fn>;
  };

  it('sends a signed order until ingest takes it, then never again', async () => {
    const { store } = memoryProposalStore();
    await store.save(signed());
    // Another order, not signed yet: nothing to send
    await store.save({ ...proposal(), orderId: `0x${'99'.repeat(32)}` });
    const offline = answers(503);
    expect(await syncSignedOrders({ store, ingestUrl: 'http://ingest', now: NOW, fetchFn: offline })).toEqual({ registered: 0, refused: 0, pending: 1 });
    expect((await store.get(signed().orderId))?.ingestRegisteredAt).toBeUndefined();

    const online = answers(201);
    expect(await syncSignedOrders({ store, ingestUrl: 'http://ingest', now: NOW + 60, fetchFn: online })).toEqual({ registered: 1, refused: 0, pending: 0 });
    expect((await store.get(signed().orderId))?.ingestRegisteredAt).toBe(NOW + 60);

    const later = answers(200);
    await syncSignedOrders({ store, ingestUrl: 'http://ingest', now: NOW + 120, fetchFn: later });
    expect(later).not.toHaveBeenCalled();
  });

  it('keeps the reason of a refusal, and clears it once ingest registers the order', async () => {
    const { store } = memoryProposalStore();
    await store.save(signed());
    await syncSignedOrders({ store, ingestUrl: 'http://ingest', now: NOW, fetchFn: answers(403) });
    expect((await store.get(signed().orderId))?.ingestRefusal).toEqual({ status: 403, reason: 'unknown_importer' });
    // The importer was registered on the server: the next sync takes it
    await syncSignedOrders({ store, ingestUrl: 'http://ingest', now: NOW + 60, fetchFn: answers(201) });
    const p = await store.get(signed().orderId);
    expect(p?.ingestRegisteredAt).toBe(NOW + 60);
    expect(p?.ingestRefusal).toBeUndefined();
  });

  it('does nothing without ingest', async () => {
    const { store } = memoryProposalStore();
    await store.save(signed());
    const fetchFn = answers(201);
    expect(await syncSignedOrders({ store, ingestUrl: undefined, now: NOW, fetchFn })).toEqual({ registered: 0, refused: 0, pending: 0 });
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
