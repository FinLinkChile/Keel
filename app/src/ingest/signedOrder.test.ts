// Runs in Node (vitest), not in the app

import { describe, expect, it, vi } from 'vitest';

import { buildOrder } from '../data/newOrder';
import { newProposal, type Proposal } from '../data/proposals';

import { agentOrderFile, canonical, sendSignedOrder } from './signedOrder';

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

  it('reports a refusal and a network failure without throwing', async () => {
    expect(await sendSignedOrder({ ingestUrl: 'http://ingest', proposal: signed(), fetchFn: reply(400) })).toEqual({ kind: 'rejected', status: 400 });
    const down = vi.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    expect(await sendSignedOrder({ ingestUrl: 'http://ingest', proposal: signed(), fetchFn: down })).toEqual({ kind: 'failed' });
  });
});
