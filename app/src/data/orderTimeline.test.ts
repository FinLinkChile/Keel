// Runs in Node (vitest), not in the app

import { describe, expect, it } from 'vitest';

import { mockData } from './mock';
import { importerTimeline, orderAmounts, proposalTimeline } from './orderTimeline';
import { newProposal, type Proposal } from './proposals';
import type { Order, Party } from './types';

const NOW = Date.UTC(2026, 9, 14) / 1000;

async function setup(label: string) {
  const order = (await mockData.orders()).find((o) => o.label === label)!;
  const supplier = (await mockData.partyByAddress(order.po.exporter))!;
  const carrier = (await mockData.partyByAddress(order.po.carrier))!;
  return { order, supplier, carrier };
}

const timeline = async (label: string, patch: Partial<Order> = {}, now = NOW) => {
  const { order, supplier, carrier } = await setup(label);
  return importerTimeline({ ...order, ...patch }, supplier as Party, carrier as Party, now);
};
const summary = (items: Awaited<ReturnType<typeof timeline>>) => items.map((i) => `${i.state}:${i.key}`);

describe('importerTimeline', () => {
  it('shows an order waiting for the exporter, with nothing done after the signature', async () => {
    const items = await timeline('PO-0157', { waitingOn: 'exporter' });
    expect(summary(items)).toEqual(['current:signed', 'todo:locked', 'todo:advance', 'todo:shipment', 'todo:balance']);
    expect(items[0].title).toBe('Waiting for Lingnan to sign');
  });

  it('says it is the importer who signs last when the exporter already signed', async () => {
    const items = await timeline('PO-0157');
    expect(items[0]).toMatchObject({ title: 'Waiting for your signature', detail: 'Lingnan signed. Yours is the last one.', state: 'current' });
  });

  it('waits for the deposit once both signed, or for the supplier check', async () => {
    const signed = await timeline('PO-0151', { blockedBy: undefined });
    expect(summary(signed).slice(0, 3)).toEqual(['done:signed', 'current:locked', 'todo:advance']);
    expect(signed[1].detail).toBe('Waiting to be opened in the escrow');
    expect((await timeline('PO-0151'))[1].detail).toBe('Waiting for the supplier check');
  });

  it('shows the advance paid and what the shipment waits on, with the days left', async () => {
    const items = await timeline('PO-0142');
    expect(summary(items)).toEqual(['done:signed', 'done:locked', 'done:advance', 'current:shipment', 'todo:balance']);
    expect(items[0].detail).toBe('Oct 2');
    expect(items[1]).toMatchObject({ detail: 'Oct 2, by the agent', trailing: { text: '48,000.00', tone: 'muted' } });
    expect(items[2]).toMatchObject({ title: 'Advance paid to Lingnan', detail: 'Oct 2, by the contract', trailing: { text: '24,000.00', tone: 'money' } });
    expect(items[3].title).toBe('Waiting for the shipment');
    expect(items[3].detail).toBe(
      'Harbor Line has to confirm the goods are on board by Nov 20. Lingnan uploads the bill of lading and invoice. Nothing for you to do.',
    );
    expect(items[3].trailing).toEqual({ text: '37 days left', tone: 'plain' });
    expect(items[4]).toMatchObject({ title: 'Balance paid to Lingnan', detail: 'After the shipment is proven' });
  });

  it('counts one day, and zero days once the deadline passed', async () => {
    const { order } = await setup('PO-0142');
    const left = (now: number) => timeline('PO-0142', {}, now).then((i) => i[3].trailing?.text);
    expect(await left(Number(order.po.shipmentDeadline) - 3600)).toBe('1 day left');
    expect(await left(Number(order.po.shipmentDeadline) + DAY)).toBe('0 days left');
  });

  it('shows a proven shipment with the balance coming after the dispute window', async () => {
    const items = await timeline('PO-0139');
    expect(summary(items)).toEqual(['done:signed', 'done:locked', 'done:advance', 'done:shipment', 'current:balance']);
    expect(items[3]).toMatchObject({ title: 'Shipment proven by Harbor Line', detail: 'Oct 14' });
    expect(items[4].title).toBe('Balance to Pearl Delta');
    expect(items[4].detail).toMatch(/^Paid (today|in \d+ days?), after the dispute window$/);
  });

  it('shows a settled order with every step done', async () => {
    const items = await timeline('PO-0131');
    expect(summary(items)).toEqual(['done:signed', 'done:locked', 'done:advance', 'done:shipment', 'done:balance']);
    expect(items[4]).toMatchObject({ title: 'Balance paid to Lingnan', trailing: { text: '24,000.00', tone: 'money' } });
  });

  it('shows a refund: no proof of shipment and the balance back to the importer', async () => {
    const items = await timeline('PO-0128');
    expect(items[3]).toMatchObject({ title: 'No proof of shipment', state: 'done' });
    expect(items[4]).toMatchObject({ title: 'Balance returned to you', state: 'done', trailing: { tone: 'money' } });
  });

  it('ends at the cancellation for an order cancelled together', async () => {
    const items = await timeline('PO-0119');
    expect(summary(items)).toEqual(['done:signed', 'done:locked', 'done:cancelled']);
  });

  it('leaves out the advance step when there is none, and a date that is not known', async () => {
    const { order } = await setup('PO-0142');
    const items = await timeline('PO-0142', { po: { ...order.po, advanceBps: 0 }, signedAt: undefined, advancePaidAt: undefined });
    expect(items.map((i) => i.key)).not.toContain('advance');
    expect(items[0].detail).toBeUndefined();
    expect(items[1].detail).toBe('by the agent');
  });
});

const DAY = 86_400;

describe('orderAmounts', () => {
  const amounts = async (label: string) => orderAmounts((await setup(label)).order);

  it('splits the money between the supplier and the escrow while the order runs', async () => {
    expect(await amounts('PO-0142')).toEqual({ total: 4_800_000n, paid: 2_400_000n, locked: 2_400_000n, returned: 0n });
    expect(await amounts('PO-0139')).toMatchObject({ paid: 1_075_000n, locked: 1_075_000n });
  });

  it('has everything paid once settled, and the balance back after a refund', async () => {
    expect(await amounts('PO-0131')).toMatchObject({ paid: 4_800_000n, locked: 0n, returned: 0n });
    expect(await amounts('PO-0128')).toMatchObject({ paid: 980_000n, locked: 0n, returned: 980_000n });
  });

  it('has no split before the deposit, and none for a cancellation, whose split the app does not see', async () => {
    expect(await amounts('PO-0157')).toBeUndefined();
    expect(await amounts('PO-0151')).toBeUndefined();
    expect(await amounts('PO-0119')).toBeUndefined();
  });
});

describe('proposalTimeline', () => {
  const proposal = async (patch: Partial<Proposal> = {}): Promise<{ p: Proposal; supplier: Party }> => {
    const { order, supplier } = await setup('PO-0142');
    return { p: { ...newProposal(order, 'Agar powder', Date.UTC(2026, 9, 14, 12) / 1000), ...patch }, supplier };
  };
  const run = async (patch: Partial<Proposal> = {}) => {
    const { p, supplier } = await proposal(patch);
    return proposalTimeline(p, supplier);
  };

  it('waits for the supplier first, with the steps after the signatures pending and without dates', async () => {
    const items = await run();
    expect(summary(items)).toEqual(['done:sent', 'current:exporter', 'todo:importer', 'todo:open', 'todo:shipment', 'todo:balance']);
    expect(items[0]).toMatchObject({ title: 'Order sent', detail: 'Oct 14' });
    expect(items[1]).toMatchObject({ title: 'Lingnan signs', detail: 'They check the terms and sign first.' });
    expect(items[2].action).toBeUndefined();
    expect(items[3]).toMatchObject({ title: 'Opened in the escrow, advance paid', detail: 'Waits for the escrow to be opened' });
    expect(items[4]).toMatchObject({ title: 'Shipment and documents by Nov 20' });
    expect(items[4].detail).toBeUndefined();
    expect(items[5]).toMatchObject({ title: 'Balance paid to Lingnan', trailing: { text: '24,000.00' } });
  });

  it('asks for the importer when the supplier signed, with a way to the review', async () => {
    const items = await run({ status: 'awaiting_importer', exporterSignedAt: Date.UTC(2026, 9, 15, 8) / 1000 });
    expect(summary(items).slice(0, 3)).toEqual(['done:sent', 'done:exporter', 'current:importer']);
    expect(items[1].detail).toBe('Oct 15');
    expect(items[2]).toMatchObject({ detail: 'Lingnan signed. Yours is the last signature.', action: 'review' });
  });

  it('is done at the signatures once signed by both, and still waits for the escrow', async () => {
    const items = await run({ status: 'signed', exporterSignedAt: Date.UTC(2026, 9, 15, 8) / 1000, signedAt: Date.UTC(2026, 9, 16, 8) / 1000 });
    expect(summary(items)).toEqual(['done:sent', 'done:exporter', 'done:importer', 'todo:open', 'todo:shipment', 'todo:balance']);
    expect(items[2].detail).toBe('Oct 16');
    expect(items.every((i) => i.action === undefined)).toBe(true);
  });

  it('stops at a rejection in the same timeline', async () => {
    const items = await run({ status: 'rejected' });
    expect(summary(items)).toEqual(['done:sent', 'todo:exporter', 'stopped:rejected']);
    const afterSigning = await run({ status: 'rejected', exporterSignature: `0x${'ab'.repeat(65)}` });
    expect(summary(afterSigning)).toEqual(['done:sent', 'done:exporter', 'stopped:rejected']);
  });
});
