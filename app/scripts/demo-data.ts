/// <reference types="node" />
// npm run demo-data -w app -- --exporter 0x… [--importer 0x… --safe 0x…] [--out <dir>]
// --importer is the key that owns the importer's Safe; --safe is the Safe, the importer of the orders
//
// Writes, from the app's mock and the given test wallets (public addresses from Wallet check):
//   <out>/ingest-orders.json                    INGEST_ORDERS_FILE for ingest
//   <out>/agent/registry.json                   agent registry (parties, history)
//   <out>/agent/orders/<orderId>/order.json     agent order files ({ order, terms, label })
//   <out>/bot-orders.json                       BOT_ORDERS_FILE for the bot (orderId -> label)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { getAddress, isAddress } from 'viem';

import { checkWallet, demoData, toFileText } from './demoData';

const { values } = parseArgs({
  options: {
    exporter: { type: 'string' },
    importer: { type: 'string' },
    safe: { type: 'string' },
    out: { type: 'string', default: 'demo-data' },
  },
});

const repo = resolve(__dirname, '../..');
const botAccounts = Object.keys(JSON.parse(readFileSync(join(repo, 'bot/examples/recipients.json'), 'utf8')).accounts);

function checkSafe(value: string) {
  if (!isAddress(value, { strict: false })) throw new Error(`--safe is not an address: ${value}`);
  return getAddress(value.toLowerCase());
}

async function main() {
  const wallets = { exporter: checkWallet('exporter', values.exporter), importer: checkWallet('importer', values.importer) };
  const importerSafe = values.safe ? checkSafe(values.safe) : undefined;
  const data = await demoData(wallets, botAccounts, { importerSafe });

  const out = resolve(values.out!);
  const write = (path: string[], value: unknown) => {
    const file = join(out, ...path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, toFileText(value));
    console.log('wrote', file);
  };

  write(['ingest-orders.json'], data.ingestOrders);
  write(['agent', 'registry.json'], data.registry);
  for (const o of data.agentOrders) write(['agent', 'orders', o.order.orderId, 'order.json'], o);
  // The bot reads it as is, in its own key order (not canonical)
  const botFile = join(out, 'bot-orders.json');
  writeFileSync(botFile, `${JSON.stringify(data.botOrders, null, 2)}
`);
  console.log('wrote', botFile);
  console.log(`${data.ingestOrders.length} orders in the ingest registry, ${data.agentOrders.length} orders for the agent`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
