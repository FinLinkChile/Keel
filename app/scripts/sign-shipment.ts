/// <reference types="node" />
// npm run sign-shipment -w app -- --order <orderId> --chain-id <n> --escrow 0x… (--doc <file>… | --docs-hash 0x…)
//   [--orders <dir>] [--bl-number OLSU26104471] [--port CNNGB] [--on-board <unix>]
//
// Signs the carrier's ShipmentAttestation of one demo order and writes
//   <orders>/<orderId>/shipment.json    { attestation, sigCarrier }, the format the agent reads
// The carrier key is a test key read from KEEL_CARRIER_ENV (default ~/keel-carrier.env,
// DEMO_CARRIER_PRIVATE_KEY), outside the repository. It is never printed.
// The attestation must match the documents ingest read: use the bill of lading number, the port
// and the exact files that were uploaded. A bill of lading number is single use per carrier.
// onBoardDate (default now) must be after the order was funded and not after its shipment deadline.
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import type { Hex } from '@keel/schemas';
import { docsHash } from '@keel/schemas/hash';
import { isAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import { toFileText } from './demoData';
import { buildAttestation, fileHashOf, signShipment, type OrderFile } from './signShipment';

const { values } = parseArgs({
  options: {
    orders: { type: 'string', default: 'demo-data/agent/orders' },
    order: { type: 'string' },
    'chain-id': { type: 'string' },
    escrow: { type: 'string' },
    doc: { type: 'string', multiple: true },
    // The document number of the demo bill of lading (redteam/corpus/trade/legit/T01-bill_of_lading.pdf)
    'bl-number': { type: 'string', default: 'OLSU26104471' },
    port: { type: 'string', default: 'CNNGB' },
    'on-board': { type: 'string' },
  },
});

function carrierKey(): Hex {
  const file = process.env.KEEL_CARRIER_ENV ?? join(homedir(), 'keel-carrier.env');
  const line = readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .find((l) => l.startsWith('DEMO_CARRIER_PRIVATE_KEY='));
  const key = line?.slice(line.indexOf('=') + 1).trim();
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error(`no DEMO_CARRIER_PRIVATE_KEY in ${file}`);
  return key as Hex;
}

async function main() {
  const { order, escrow } = values;
  if (!order || !/^0x[0-9a-fA-F]{64}$/.test(order)) throw new Error('--order <orderId> is required');
  if (!escrow || !isAddress(escrow, { strict: false })) throw new Error('--escrow <TradeEscrow address> is required');
  const chainId = Number(values['chain-id']);
  if (!Number.isInteger(chainId) || chainId <= 0) throw new Error('--chain-id <n> is required');

  if (!values.doc?.length) throw new Error('give the uploaded files with --doc <file> (repeat it for each file)');
  const fileHashes = values.doc.map((f) => fileHashOf(readFileSync(f)));

  const now = BigInt(Math.floor(Date.now() / 1000));
  const onBoardDate = values['on-board'] ? BigInt(values['on-board']) : now;
  const dir = join(resolve(values.orders!), order);
  const file = JSON.parse(readFileSync(join(dir, 'order.json'), 'utf8')) as OrderFile;
  if (file.order.orderId.toLowerCase() !== order.toLowerCase()) throw new Error('order.json belongs to another order');

  const attestation = buildAttestation(file, { blNumber: values['bl-number']!, portOfLoading: values.port!, fileHashes, onBoardDate, now });
  const signed = await signShipment(privateKeyToAccount(carrierKey()), file, attestation, { chainId, escrow: escrow as Hex });

  const out = join(dir, 'shipment.json');
  writeFileSync(out, toFileText(signed));
  console.log('wrote', out);
  console.log('docsHash', docsHash(fileHashes));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
