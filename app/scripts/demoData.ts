// Builds the data files the other services need from the app's mock, the single source of the
// demo: the order registry of ingest and the order and registry files of the agent (Area 2).
// Inputs are public wallet addresses only; this never reads or writes a key.
//
// The shapes replicate, without importing them:
//   ingest  TradeOrderEntry          ingest/src/trade/upload.ts      (area3/trade-ingest)
//   agent   StoredOrder, Registry    engine/src/agent/store.ts       (area2/agent-service)
//   agent   canonical JSON           engine/src/canonical.ts: keys sorted, bigints as decimal text
import type { Hex, OrderTerms, PurchaseOrder } from '@keel/schemas';
import { getAddress, isAddress } from 'viem';

import { isClosed } from '../src/data/orderLine';
import { bindWallets, mockData } from '../src/data/mock';
import type { Role } from '../src/data/types';

export type Wallets = Partial<Record<Role, Hex>>;

// ingest: who may upload the documents of an order and where the exporter is paid
export type TradeOrderEntry = {
  orderId: Hex;
  payoutAddress: Hex;
  carrier: Hex;
  uploaders: { address: Hex; party: Role }[];
};

// agent: orders/<orderId>/order.json
export type StoredOrder = { order: PurchaseOrder; terms: OrderTerms; label: string };

// agent: registry.json
export type Registry = {
  parties: { address: Hex; taxId?: string; account?: string }[];
  // Total amounts of earlier settled orders, by exporter address (lowercase)
  history: Record<string, bigint[]>;
};

export type DemoData = {
  ingestOrders: TradeOrderEntry[];
  agentOrders: StoredOrder[];
  registry: Registry;
};

// Same as engine/src/canonical.ts
export function canonical(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as object)
        .sort()
        .map((k) => [k, canonical((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

export const toFileText = (value: unknown) => `${JSON.stringify(canonical(value), null, 2)}\n`;

export function checkWallet(role: Role, value: string | undefined): Hex | undefined {
  if (value === undefined) return undefined;
  if (!isAddress(value, { strict: false })) throw new Error(`--${role} is not an address: ${value}`);
  return getAddress(value.toLowerCase());
}

// botAccounts: the account slugs of the bot directory (bot/examples/recipients.json)
export async function demoData(wallets: Wallets, botAccounts: readonly string[]): Promise<DemoData> {
  if (!wallets.exporter && !wallets.importer) throw new Error('give at least one test wallet (--exporter or --importer)');
  bindWallets(wallets);
  try {
    const all = await mockData.orders();
    // Settled, refunded and cancelled orders only feed the history
    const orders = all.filter((o) => !isClosed(o));
    const importer = (await mockData.party((await mockData.account('importer')).party))!;

    const ingestOrders: TradeOrderEntry[] = [];
    for (const o of orders) {
      const uploaders: TradeOrderEntry['uploaders'] = [];
      if (wallets.importer && o.po.importer === importer.address) uploaders.push({ address: o.po.importer, party: 'importer' });
      if (wallets.exporter && o.po.exporter === getAddress(wallets.exporter.toLowerCase()))
        uploaders.push({ address: o.po.exporter, party: 'exporter' });
      // Only orders a test wallet can upload to; the others have no one to sign
      if (uploaders.length > 0)
        ingestOrders.push({ orderId: o.po.orderId, payoutAddress: o.po.payoutAddress, carrier: o.po.carrier, uploaders });
    }

    const agentOrders = orders.map((o) => ({ order: o.po, terms: o.terms, label: o.label }));

    const ids = new Set<string>();
    for (const o of orders) for (const a of [o.po.importer, o.po.exporter, o.po.arbiter]) ids.add(a);
    const parties: Registry['parties'] = [];
    for (const address of ids) {
      const p = (await mockData.partyByAddress(address as Hex))!;
      parties.push({
        address: p.address,
        ...(p.taxId && { taxId: p.taxId }),
        ...(botAccounts.includes(p.id) && { account: p.id }),
      });
    }
    const history: Registry['history'] = {};
    for (const o of all.filter((x) => x.stage === 'settled')) {
      const key = o.po.exporter.toLowerCase();
      (history[key] ??= []).push(o.po.totalAmount);
    }

    return { ingestOrders, agentOrders, registry: { parties, history } };
  } finally {
    bindWallets({});
  }
}
