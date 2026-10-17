import { describe, expect, it } from 'vitest';

import { activityFrom } from './activity';
import { mockData } from './mock';
import { newProposal, type Proposal } from './proposals';

const order = (await mockData.orders())[0]!;
const names = { [order.po.importer.toLowerCase()]: 'Pacífico', [order.po.exporter.toLowerCase()]: 'Lingnan' };
const sent = (at: number): Proposal => newProposal({ po: order.po, terms: order.terms }, 'Agar powder', at);

describe('activityFrom', () => {
  it('has no lines when nothing was sent', () => {
    expect(activityFrom([], names, 'importer')).toEqual([]);
  });

  it('says what the importer sent and what the exporter received', () => {
    const [mine] = activityFrom([sent(1000)], names, 'importer');
    expect(mine).toMatchObject({ at: 1000, title: `Sent ${sent(1000).label} to Lingnan`, detail: 'Agar powder, 48,000.00 USD' });
    expect(activityFrom([sent(1000)], names, 'exporter')[0]?.title).toBe(`Pacífico sent you ${sent(1000).label}`);
  });

  it('adds a line when both signed, newest first', () => {
    const done: Proposal = { ...sent(1000), status: 'signed', signedAt: 2000 };
    const lines = activityFrom([done], names, 'importer');
    expect(lines.map((l) => l.at)).toEqual([2000, 1000]);
    expect(lines[0]).toMatchObject({ title: `${done.label} signed by both`, detail: 'Waits for the deposit' });
  });

  it('shows only the sent line for an order still waiting for a signature', () => {
    const waiting: Proposal = { ...sent(500), status: 'awaiting_importer' };
    expect(activityFrom([waiting], names, 'importer')).toHaveLength(1);
  });
});
