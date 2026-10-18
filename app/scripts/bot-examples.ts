/// <reference types="node" />
// npm run bot-examples -w app
//
// Rewrites the order ids of bot/examples from the app's mock with its default addresses, so the
// demo notices name the same orders as the app, ingest and the agent. Keeps the orders the
// examples already have (by label) and only changes orderRef in the notices.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { demoData } from './demoData';

const dir = resolve(__dirname, '../../bot/examples');
const read = (f: string) => JSON.parse(readFileSync(join(dir, f), 'utf8'));
const write = (f: string, value: unknown) => writeFileSync(join(dir, f), `${JSON.stringify(value, null, 2)}\n`);

async function main() {
  const botAccounts = Object.keys(read('recipients.json').accounts);
  // The default mock addresses: no test wallet stands in for a party here
  const { botOrders } = await demoData({}, botAccounts, { withoutWallets: true });

  const current = read('orders.json') as { orders: Record<string, { label: string }> };
  const labels = new Set(Object.values(current.orders).map((o) => o.label));
  const orders = Object.fromEntries(Object.entries(botOrders.orders).filter(([, o]) => labels.has(o.label)));
  if (Object.keys(orders).length !== labels.size) throw new Error('an order of bot/examples is missing from the mock');
  write('orders.json', { orders });

  const idOf = new Map(Object.entries(orders).map(([id, o]) => [o.label, id]));
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json') && x !== 'orders.json' && x !== 'recipients.json')) {
    const notices = read(f) as { orderRef?: string; orderLabel?: string }[];
    if (!notices.some((n) => n.orderRef)) continue;
    for (const n of notices) if (n.orderRef) n.orderRef = idOf.get(n.orderLabel!)!;
    write(f, notices);
    console.log('updated', f);
  }
  console.log('wrote orders.json with', Object.keys(orders).length, 'orders');
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
