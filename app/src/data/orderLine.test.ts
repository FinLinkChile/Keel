import { describe, expect, it } from 'vitest';

import { mockData } from './mock';
import { isClosed, orderLine } from './orderLine';
import type { Order, Role } from './types';

const NOW = Date.UTC(2026, 9, 15) / 1000;
const text = (o: Order, role: Role = 'importer') =>
  mockData.partyByAddress(role === 'importer' ? o.po.exporter : o.po.importer).then((p) => {
    const line = orderLine(o, role, p!, NOW);
    return { ...line, detail: line.detail.map((s) => s.text).join('') };
  });
const byLabel = async (label: string) => (await mockData.orders()).find((o) => o.label === label)!;

describe('orderLine for the importer, as in 14 Orders', () => {
  it('marks only your turn with the yellow dot', async () => {
    expect(await text(await byLabel('PO-0157'))).toEqual({ status: 'Review', yourTurn: true, detail: 'Lingnan, 48,000.00' });
    expect(await text(await byLabel('PO-0142'))).toEqual({ status: 'Advance paid', yourTurn: false, detail: 'Lingnan, ships by Nov 20' });
  });

  it('counts the dispute window after the shipment', async () => {
    expect(await text(await byLabel('PO-0139'))).toMatchObject({ status: 'Shipped', detail: 'Pearl Delta, balance in 2 days' });
  });

  it('says why a signed order waits', async () => {
    expect(await text(await byLabel('PO-0151'))).toMatchObject({ status: 'Signed', detail: 'Kowloon, waits for the supplier check' });
  });

  it('gives back only the balance on a refund, in green', async () => {
    const o = await byLabel('PO-0128');
    const p = await mockData.partyByAddress(o.po.exporter);
    const line = orderLine(o, 'importer', p!, NOW);
    expect(line.status).toBe('Refunded');
    expect(line.detail).toEqual([{ text: 'No proof of shipment, ' }, { text: '9,800.00 back to you', money: true }]);
  });

  it('closes settled, refunded and cancelled orders', async () => {
    const closed = (await mockData.orders()).filter(isClosed).map((o) => o.label);
    expect(closed).toEqual(['PO-0131', 'PO-0128', 'PO-0119']);
  });
});

describe('orderLine for the exporter', () => {
  it('asks the exporter to ship once the advance is paid', async () => {
    expect(await text(await byLabel('PO-0142'), 'exporter')).toEqual({ status: 'Ship', yourTurn: true, detail: 'Pacífico, ship by Nov 20' });
  });

  it('shows an order it signed and that waits for the importer as Signed', async () => {
    expect(await text(await byLabel('PO-0157'), 'exporter')).toEqual({
      status: 'Signed',
      yourTurn: false,
      detail: 'Pacífico has to sign, 48,000.00',
    });
  });

  it('never shows an internal stage name', async () => {
    for (const o of await mockData.orders())
      for (const role of ['importer', 'exporter'] as const) {
        const line = await text(o, role);
        expect(line.status).not.toMatch(/_/);
        expect(line.detail).not.toMatch(/_/);
      }
  });
});
