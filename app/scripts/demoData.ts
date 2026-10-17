// Builds the data files the other services need from the app's mock, the single source of the
// demo: the order registry of ingest and the order and registry files of the agent (Area 2).
// Inputs are public wallet addresses only; this never reads or writes a key.
//
// The shapes replicate, without importing them:
//   ingest  TradeOrderEntry          ingest/src/trade/upload.ts      (area3/trade-ingest)
//   agent   StoredOrder, Registry    engine/src/agent/store.ts       (area2/agent-service)
//   agent   canonical JSON           engine/src/canonical.ts: keys sorted, bigints as decimal text
//   bot     order book               bot/src/adapters/config/orders-file.ts (BOT_ORDERS_FILE)
import type { Hex, OrderTerms, PurchaseOrder } from '@keel/schemas';
import { getAddress, isAddress } from 'viem';

import { isClosed } from '../src/data/orderLine';
import { bindWallets, mockData } from '../src/data/mock';
import type { Order, Role } from '../src/data/types';

export type Wallets = Partial<Record<Role, Hex>>;

// ingest: who may upload the documents of an order and where the exporter is paid
export type TradeOrderEntry = {
  orderId: Hex;
  payoutAddress: Hex;
  carrier: Hex;
  uploaders: { address: Hex; party: Role }[];
  // The exporter's registered bank account, so its own invoice raises no unknown_destination
  knownDestinations?: { kind: 'bank_account'; value: string }[];
};

// As ingest normalizes the account it finds in a document (findTradeDestinations)
export const compactAccount = (account: string) => account.replace(/[\s-]/g, '');

// agent: orders/<orderId>/order.json
export type StoredOrder = { order: PurchaseOrder; terms: OrderTerms; label: string };

// agent: registry.json
export type Registry = {
  parties: { address: Hex; taxId?: string; account?: string }[];
  // Total amounts of earlier settled orders, by exporter address (lowercase)
  history: Record<string, bigint[]>;
};

// bot: BOT_ORDERS_FILE, the label and the bot accounts of each order, by orderId
export type BotOrders = {
  orders: Record<string, { label: string; importer: string; exporter: string; arbiter?: string; shipmentDeadline: number }>;
};

export type DemoData = {
  ingestOrders: TradeOrderEntry[];
  agentOrders: StoredOrder[];
  registry: Registry;
  botOrders: BotOrders;
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

// Every order whose importer and exporter have an account in the bot directory, closed ones
// included: the bot also tells how an order ended. Orders with an unknown party are left out,
// because the bot refuses an order book that names an account it does not know.
async function botOrderBook(orders: Order[], botAccounts: readonly string[]): Promise<BotOrders> {
  const account = async (a: Hex) => {
    const p = await mockData.partyByAddress(a);
    return p && botAccounts.includes(p.id) ? p.id : undefined;
  };
  const book: BotOrders = { orders: {} };
  for (const o of orders) {
    const [importer, exporter, arbiter] = await Promise.all([account(o.po.importer), account(o.po.exporter), account(o.po.arbiter)]);
    if (!importer || !exporter) continue;
    book.orders[o.po.orderId] = {
      label: o.label,
      importer,
      exporter,
      ...(arbiter && { arbiter }),
      shipmentDeadline: Number(o.po.shipmentDeadline),
    };
  }
  return book;
}

// botAccounts: the account slugs of the bot directory (bot/examples/recipients.json)
// withoutWallets: only for bot/examples, which use the mock's default addresses
// importerSafe: the importer of every order. The importer wallet is a key that owns it, so the
// key is the uploader in ingest, not the Safe.
export async function demoData(
  wallets: Wallets,
  botAccounts: readonly string[],
  opts: { withoutWallets?: boolean; importerSafe?: Hex } = {},
): Promise<DemoData> {
  if (!opts.withoutWallets && !wallets.exporter && !wallets.importer)
    throw new Error('give at least one test wallet (--exporter or --importer)');
  bindWallets(wallets, opts.importerSafe);
  try {
    const all = await mockData.orders();
    // Settled, refunded and cancelled orders only feed the history
    const orders = all.filter((o) => !isClosed(o));
    const importer = (await mockData.party((await mockData.account('importer')).party))!;

    const ingestOrders: TradeOrderEntry[] = [];
    for (const o of orders) {
      const uploaders: TradeOrderEntry['uploaders'] = [];
      if (wallets.importer && o.po.importer === importer.address)
        uploaders.push({ address: getAddress(wallets.importer.toLowerCase()), party: 'importer' });
      if (wallets.exporter && o.po.exporter === getAddress(wallets.exporter.toLowerCase()))
        uploaders.push({ address: o.po.exporter, party: 'exporter' });
      // Only orders a test wallet can upload to; the others have no one to sign
      if (uploaders.length === 0) continue;
      const bankAccount = (await mockData.partyByAddress(o.po.exporter))?.bankAccount;
      ingestOrders.push({
        orderId: o.po.orderId,
        payoutAddress: o.po.payoutAddress,
        carrier: o.po.carrier,
        uploaders,
        ...(bankAccount && { knownDestinations: [{ kind: 'bank_account' as const, value: compactAccount(bankAccount) }] }),
      });
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

    return { ingestOrders, agentOrders, registry: { parties, history }, botOrders: await botOrderBook(all, botAccounts) };
  } finally {
    bindWallets({});
  }
}
