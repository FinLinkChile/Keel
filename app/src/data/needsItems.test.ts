import type { Hex } from '@keel/schemas';
import { describe, expect, it } from 'vitest';

import { loadNeedsItems, needsItemHref, needsItemText } from './needsItems';
import type { KeelData, NeedsYou, Order, Party } from './types';

const IMPORTER = '0x00000000000000000000000000000000000000a1' as Hex;
const EXPORTER = '0x00000000000000000000000000000000000000b2' as Hex;
const PROPOSED = '0x01' as Hex;
const EXAMPLE = '0x02' as Hex;

const party = (id: string, short: string, address: Hex) => ({ id, name: short, short, place: '', address }) as Party;
const order = (orderId: Hex, label: string) => ({ label, po: { orderId, importer: IMPORTER, exporter: EXPORTER } }) as unknown as Order;
const PARTIES = [party('pacifico', 'Pacífico', IMPORTER), party('lingnan', 'Lingnan', EXPORTER), party('kowloon', 'Kowloon', '0x03' as Hex)];
const ORDERS = [order(PROPOSED, 'PO-0160'), order(EXAMPLE, 'PO-0157')];

const data = (needs: NeedsYou[]) =>
  ({
    needsYou: async () => needs,
    order: async (id: Hex) => ORDERS.find((o) => o.po.orderId === id),
    party: async (id: string) => PARTIES.find((p) => p.id === id),
    partyByAddress: async (a: Hex) => PARTIES.find((p) => p.address === a),
  }) as unknown as KeelData;

const isProposed = async (id: Hex) => id === PROPOSED;

describe('notifications', () => {
  it('takes the importer straight to the signature of an order proposed on this phone', async () => {
    const [proposed, example] = await loadNeedsItems(
      data([
        { kind: 'sign_order', orderId: PROPOSED },
        { kind: 'sign_order', orderId: EXAMPLE },
      ]),
      'importer',
      isProposed,
    );
    expect(needsItemHref(proposed!, 'importer')).toEqual({ pathname: '/review/[orderId]', params: { orderId: PROPOSED } });
    expect(needsItemText(proposed!, 'importer')).toEqual({ title: 'Sign PO-0160', detail: 'Lingnan signed. Yours is the last signature' });
    // An example order has no signature screen on this phone: it opens the order
    expect(needsItemHref(example!, 'importer')).toEqual({ pathname: '/order/[orderId]', params: { orderId: EXAMPLE } });
  });

  it('takes the exporter to its review, which is its order screen while it waits', async () => {
    const [item] = await loadNeedsItems(data([{ kind: 'sign_order', orderId: PROPOSED }]), 'exporter', isProposed);
    expect(needsItemHref(item!, 'exporter')).toEqual({ pathname: '/order/[orderId]', params: { orderId: PROPOSED } });
    expect(needsItemText(item!, 'exporter').detail).toBe('Pacífico sent this order. You sign first');
  });

  it('sends uploads to the order and supplier checks to Suppliers, and drops what it cannot resolve', async () => {
    const items = await loadNeedsItems(
      data([
        { kind: 'upload_documents', orderId: EXAMPLE },
        { kind: 'verify_supplier', party: 'kowloon' },
        { kind: 'sign_order', orderId: '0x99' as Hex },
      ]),
      'exporter',
      isProposed,
    );
    expect(items.map((i) => needsItemHref(i, 'exporter'))).toEqual([{ pathname: '/order/[orderId]', params: { orderId: EXAMPLE } }, '/suppliers']);
    expect(needsItemText(items[1]!, 'importer').title).toBe("Verify Kowloon's account");
  });

  it('tells the importer why ingest refused an order, and opens the notifications', async () => {
    const [known, unknown] = await loadNeedsItems(
      data([
        { kind: 'register_order', orderId: PROPOSED, reason: 'unknown_importer' },
        { kind: 'register_order', orderId: EXAMPLE, reason: 'something_new' },
      ]),
      'importer',
      isProposed,
    );
    expect(needsItemHref(known!, 'importer')).toBe('/notifications');
    expect(needsItemText(known!, 'importer')).toEqual({
      title: 'PO-0160 is not registered yet',
      detail: 'Keel does not know your company yet. Ask Keel to register it; the app tries again',
    });
    expect(needsItemText(unknown!, 'importer').detail).toBe('Keel could not register it. It tries again when you open the app');
  });
});
