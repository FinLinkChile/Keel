// Runs in Node (vitest), not in the app

import type { Hex } from '@keel/schemas';
import { describe, expect, it, vi } from 'vitest';

import type { Signer } from '../wallet/signer';

import { ApiError, toWire, type ApiClient, type ProposalView } from './api';
import { httpProposalStore, moveOf, proposalFromView } from './httpProposals';
import { mockData } from './mock';
import { newProposal, type Proposal } from './proposals';

const sample = async (): Promise<Proposal> => {
  const [order] = await mockData.orders();
  const po = { ...order!.po, orderId: `0x${'77'.repeat(32)}` as Hex, nonce: 2n ** 200n + 7n };
  return newProposal({ po, terms: order!.terms }, 'Agar powder', 1_792_000_000, { amountCents: 1, advanceBps: null, issueDate: null, latestShipmentDate: null });
};

const signer = (name: string): Signer => ({ address: async () => name as Hex, signTypedData: async () => '0x' });
const importer = signer('importer');
const exporter = signer('exporter');

// The wire JSON of the server: what JSON.stringify of a bigint-carrying object gives
const wire = (v: unknown) => JSON.parse(toWire(v)) as Record<string, unknown>;

function viewOf(p: Proposal, over: Partial<ProposalView> = {}): ProposalView {
  return {
    orderId: p.orderId.toLowerCase() as Hex,
    status: 'awaiting_exporter',
    label: p.label,
    goods: p.goods,
    importer: p.po.importer.toLowerCase(),
    exporter: p.po.exporter.toLowerCase(),
    po: wire(p.po),
    terms: wire(p.terms),
    proposed: { po: wire(p.proposed.po), terms: wire(p.proposed.terms) },
    differences: [],
    createdAt: 1_792_000_100,
    updatedAt: 1_792_000_100,
    you: ['importer'],
    ...over,
  };
}

describe('proposalFromView', () => {
  it('maps the server view to the proposal of the screens, fully_signed as signed', async () => {
    const p = await sample();
    const v = viewOf(p, { status: 'fully_signed', sigExporter: '0xaa', sigImporter: '0xbb', exporterSignedAt: 5, importerSignedAt: 6 });
    const got = proposalFromView(v);
    expect(got).toMatchObject({ status: 'signed', exporterSignature: '0xaa', importerSignature: '0xbb', exporterSignedAt: 5, signedAt: 6, sentAt: 1_792_000_100, goods: 'Agar powder', label: p.label });
    expect(got.po).toEqual(p.po);
    expect(got.terms).toEqual(p.terms);
    expect(got.proposed).toEqual(p.proposed);
    expect(got.po.nonce).toBe(2n ** 200n + 7n);
    expect(got.quote).toBeUndefined();
  });
});

describe('moveOf', () => {
  it('turns each state the flows save into the API move and the side that makes it', async () => {
    const p = await sample();
    expect(moveOf(undefined, p)).toEqual({ kind: 'create', side: 'importer' });
    expect(moveOf(p, { ...p, status: 'awaiting_importer' })).toEqual({ kind: 'exporter_signs', side: 'exporter', counter: false });
    const counter = { ...p, status: 'awaiting_importer' as const, po: { ...p.po, totalAmount: p.po.totalAmount + 1n } };
    expect(moveOf(p, counter)).toMatchObject({ kind: 'exporter_signs', counter: true });
    const waiting = { ...p, status: 'awaiting_importer' as const };
    expect(moveOf(waiting, { ...p, status: 'signed' })).toEqual({ kind: 'importer_signs', side: 'importer' });
    expect(moveOf(p, { ...p, status: 'rejected' })).toEqual({ kind: 'reject', side: 'exporter' });
    expect(moveOf(waiting, { ...p, status: 'rejected' })).toEqual({ kind: 'reject', side: 'importer' });
    expect(moveOf(p, p)).toEqual({ kind: 'none' });
    expect(() => moveOf({ ...p, status: 'signed' }, { ...p, status: 'rejected' })).toThrow(ApiError);
  });
});

// An API in memory with the server's moves, enough for the store
function fakeApi() {
  const items = new Map<string, ProposalView>();
  const key = (id: Hex) => id.toLowerCase();
  const seen = (s: Signer, v: ProposalView) => (s === importer ? v.you.includes('importer') : v.you.includes('exporter'));
  const api = {
    getProposal: vi.fn(async (s: Signer, id: Hex) => {
      const v = items.get(key(id));
      if (!v || !seen(s, v)) throw new ApiError(404, 'not_found');
      return v;
    }),
    listProposals: vi.fn(async (s: Signer) => [...items.values()].filter((v) => seen(s, v))),
    createProposal: vi.fn(async (s: Signer, body: { po: Proposal['po']; terms: Proposal['terms']; label?: string; goods?: string }) => {
      expect(s).toBe(importer);
      const p = { po: body.po, terms: body.terms, proposed: { po: body.po, terms: body.terms }, label: body.label ?? '', goods: body.goods ?? '', orderId: body.po.orderId } as Proposal;
      const v = viewOf(p, { you: ['importer', 'exporter'] });
      items.set(key(v.orderId), v);
      return v;
    }),
    exporterSignature: vi.fn(async (s: Signer, id: Hex, body: { signature: Hex; po?: unknown }) => {
      expect(s).toBe(exporter);
      const v = items.get(key(id))!;
      items.set(key(id), { ...v, status: 'awaiting_importer', sigExporter: body.signature, exporterSignedAt: 7 });
      return v;
    }),
    importerSignature: vi.fn(async (s: Signer, id: Hex, body: { signature: Hex }) => {
      expect(s).toBe(importer);
      const v = items.get(key(id))!;
      items.set(key(id), { ...v, status: 'fully_signed', sigImporter: body.signature, importerSignedAt: 8 });
      return v;
    }),
    rejectProposal: vi.fn(async (_s: Signer, id: Hex) => {
      const v = items.get(key(id))!;
      items.set(key(id), { ...v, status: 'rejected' });
      return v;
    }),
  };
  return { api, client: api as unknown as ApiClient };
}

describe('httpProposalStore', () => {
  it('runs a proposal from sent to signed through the API, each move signed by its side', async () => {
    const { api, client } = fakeApi();
    const store = httpProposalStore(client, () => ({ importer, exporter }));
    const p = await sample();

    await store.save(p);
    expect(api.createProposal).toHaveBeenCalledWith(importer, { po: p.po, terms: p.terms, label: p.label, goods: 'Agar powder' });
    const sent = await store.get(p.orderId);
    expect(sent).toMatchObject({ status: 'awaiting_exporter', goods: 'Agar powder' });
    // The proforma's quote stays on this phone
    expect(sent?.quote).toEqual(p.quote);

    await store.save({ ...sent!, status: 'awaiting_importer', exporterSignature: '0xe1' });
    expect(api.exporterSignature).toHaveBeenCalledWith(exporter, p.orderId, { signature: '0xe1' });

    const waiting = await store.get(p.orderId);
    await store.save({ ...waiting!, status: 'signed', importerSignature: '0x11' });
    expect(api.importerSignature).toHaveBeenCalledWith(importer, p.orderId, { signature: '0x11' });
    expect((await store.list()).map((x) => x.status)).toEqual(['signed']);
  });

  it('sends a counter offer when the exporter signed a changed order', async () => {
    const { api, client } = fakeApi();
    const store = httpProposalStore(client, () => ({ importer, exporter }));
    const p = await sample();
    await store.save(p);
    const po = { ...p.po, shipmentDeadline: p.po.shipmentDeadline + 86_400n };
    await store.save({ ...p, po, status: 'awaiting_importer', exporterSignature: '0xe1' });
    expect(api.exporterSignature).toHaveBeenCalledWith(exporter, p.orderId, { signature: '0xe1', po, terms: p.terms });
  });

  it('rejects as the side whose turn it was, and finds nothing without a wallet', async () => {
    const { api, client } = fakeApi();
    const store = httpProposalStore(client, () => ({ importer, exporter }));
    const p = await sample();
    await store.save(p);
    await store.save({ ...p, status: 'rejected' });
    expect(api.rejectProposal).toHaveBeenCalledWith(exporter, p.orderId);
    expect(await httpProposalStore(client, () => ({})).list()).toEqual([]);
    expect(await httpProposalStore(client, () => ({})).get(p.orderId)).toBeUndefined();
    await expect(httpProposalStore(client, () => ({ exporter })).save({ ...(await sample()), orderId: `0x${'99'.repeat(32)}` as Hex })).rejects.toMatchObject({
      code: 'no_wallet',
    });
  });
});
