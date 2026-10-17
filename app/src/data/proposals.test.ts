// Runs in Node (vitest), not in the app

import { describe, expect, it } from 'vitest';

import { mockData } from './mock';
import { decodeProposal, encodeProposal, memoryProposalStore, newProposal, observedStore, proposalLabel, type Proposal } from './proposals';
import { orderLine } from './orderLine';
import { withProposals } from './withProposals';

// A real order of the mock: bigger than 2^53 in no field, but every bigint field present
const sample = async (patch: Partial<Proposal> = {}): Promise<Proposal> => {
  const [order] = await mockData.orders();
  // Its own id, so it never meets the mock order it was copied from
  const po = { ...order.po, orderId: `0x${'77'.repeat(32)}` as const, nonce: 2n ** 200n + 7n };
  return { ...newProposal({ po, terms: order.terms }, '  Agar powder, 6,000 kg  ', 1_792_000_000.9), ...patch };
};

describe('proposalLabel', () => {
  it('writes the order number as the label of the order lists', () => {
    expect(proposalLabel('PO0158')).toBe('PO-0158');
    expect(proposalLabel('PO015A')).toBe('PO-015A');
    expect(proposalLabel('ABC')).toBe('ABC');
  });
});

describe('newProposal', () => {
  it('awaits the exporter and freezes a copy of the order as sent', async () => {
    const p = await sample();
    expect(p).toMatchObject({ status: 'awaiting_exporter', goods: 'Agar powder, 6,000 kg', sentAt: 1_792_000_000 });
    expect(p.proposed.po).toEqual(p.po);
    expect(p.proposed.po).not.toBe(p.po);
    expect(p.proposed.terms.hsCodes).not.toBe(p.terms.hsCodes);
    p.po.totalAmount += 1n;
    expect(p.proposed.po.totalAmount).not.toBe(p.po.totalAmount);
  });
});

describe('the file of proposals', () => {
  it('round trips every field, bigints included, through decimal text', async () => {
    const p = await sample({ exporterSignature: `0x${'ab'.repeat(65)}`, status: 'awaiting_importer', signedAt: 5 });
    const text = JSON.stringify(encodeProposal(p));
    expect(text).toContain(`"nonce":"${(2n ** 200n + 7n).toString()}"`);
    expect(decodeProposal(JSON.parse(text))).toEqual(p);
    const { store } = memoryProposalStore();
    await store.save(p);
    expect(await store.get(p.orderId)).toEqual(p);
  });

  it('replaces a proposal with the same orderId and lists the newest first', async () => {
    const { store } = memoryProposalStore();
    const a = await sample({ sentAt: 100 });
    const b = await sample({ orderId: `0x${'22'.repeat(32)}`, sentAt: 200 });
    await store.save(a);
    await store.save(b);
    await store.save({ ...a, status: 'rejected' });
    const list = await store.list();
    expect(list.map((p) => [p.orderId === a.orderId ? 'a' : 'b', p.status])).toEqual([
      ['b', 'awaiting_exporter'],
      ['a', 'rejected'],
    ]);
  });

  it('does not lose a proposal when two saves run at once', async () => {
    const { store } = memoryProposalStore();
    const ids = [1, 2, 3, 4].map((n) => `0x${String(n).repeat(64)}` as const);
    await Promise.all(ids.map(async (orderId) => store.save(await sample({ orderId }))));
    expect((await store.list()).length).toBe(4);
  });

  it('starts empty and tells the screens when something is saved', async () => {
    const { store } = memoryProposalStore();
    expect(await store.list()).toEqual([]);
    let changes = 0;
    await observedStore(store, () => (changes += 1)).save(await sample());
    expect(changes).toBe(1);
  });
});

describe('orders of this device in the data layer', () => {
  it('lists a proposal first, as an order waiting for the exporter', async () => {
    const { store } = memoryProposalStore();
    const data = withProposals(mockData, store);
    const p = await sample({ orderId: `0x${'33'.repeat(32)}` });
    await store.save(p);
    const [first, ...rest] = await data.orders();
    expect(first).toMatchObject({ label: p.label, goods: 'Agar powder, 6,000 kg', stage: 'awaiting_signature', waitingOn: 'exporter' });
    expect(rest.length).toBe((await mockData.orders()).length);
    expect(await data.order(p.orderId)).toMatchObject({ label: p.label });
  });

  it('asks the exporter to review while it waits for them and the importer once it is theirs', async () => {
    const { store } = memoryProposalStore();
    const data = withProposals(mockData, store);
    const p = await sample();
    await store.save(p);
    const ids = async (role: 'importer' | 'exporter') => (await data.needsYou(role)).flatMap((n) => (n.kind === 'sign_order' ? [n.orderId] : []));
    expect(await ids('exporter')).toContain(p.orderId);
    expect(await ids('importer')).not.toContain(p.orderId);
    await store.save({ ...p, status: 'awaiting_importer' });
    expect(await ids('exporter')).not.toContain(p.orderId);
    expect(await ids('importer')).toContain(p.orderId);
    await store.save({ ...p, status: 'signed', signedAt: 1 });
    expect(await ids('importer')).not.toContain(p.orderId);
    expect(await ids('exporter')).not.toContain(p.orderId);
  });

  it('shows each state in words and has a stage for a rejected order', async () => {
    const { store } = memoryProposalStore();
    const data = withProposals(mockData, store);
    const supplier = (await mockData.party('lingnan'))!;
    const line = async (status: Proposal['status'], role: 'importer' | 'exporter') => {
      await store.save(await sample({ status }));
      const order = (await data.order((await sample()).orderId))!;
      return orderLine(order, role, supplier, 0).status;
    };
    expect(await line('awaiting_exporter', 'importer')).toBe('Sent');
    expect(await line('awaiting_exporter', 'exporter')).toBe('Review');
    expect(await line('awaiting_importer', 'importer')).toBe('Review');
    expect(await line('signed', 'importer')).toBe('Signed');
    expect(await line('rejected', 'importer')).toBe('Rejected');
  });
});
