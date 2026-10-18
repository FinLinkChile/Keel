// Writes the documents of PO-0142, the order of act 1 of the demo, for the wallets of the app:
// the two PDFs to upload from the phone, what ingest reads from them (documents.json) and, with
// the escrow address, the carrier's signed attestation (shipment.json), in the folder layout of
// the agent (engine/src/agent/store.ts). The order id depends on the wallets, so give the same
// ones as app's demo-data.
//
// Usage: npm run demo-docs -w ingest -- --importer 0x... --exporter 0x... [--out dir]
//          [--escrow 0x... --chain-id 84532]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { getAddress, isAddress } from "viem";
import type { Hex } from "@keel/schemas";
import { DEMO_ORDER, demoCarrier, demoDocuments, demoOrderId, demoShipment } from "../src/testing/demoOrder";

const { values } = parseArgs({
  options: {
    importer: { type: "string" },
    exporter: { type: "string" },
    out: { type: "string", default: "demo-docs" },
    escrow: { type: "string" },
    "chain-id": { type: "string", default: "84532" },
  },
});

const address = (name: string, value: string | undefined): Hex => {
  if (!value || !isAddress(value, { strict: false })) {
    console.error(`--${name} must be an address (the test wallet of the app)`);
    process.exit(1);
  }
  return getAddress(value.toLowerCase()).toLowerCase() as Hex;
};

const importer = address("importer", values.importer);
const exporter = address("exporter", values.exporter);
const out = resolve(process.env.INIT_CWD ?? process.cwd(), values.out!);
const orderId = demoOrderId(importer, exporter);

// bigints as decimal text, like the agent's data files
const json = (value: unknown) => `${JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2)}\n`;
const write = (path: string, text: string | Uint8Array) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  console.log(`wrote ${path}`);
};

const docs = await demoDocuments();
write(join(out, "documents", `${DEMO_ORDER.label}-bill-of-lading.pdf`), docs.transportPdf);
write(join(out, "documents", `${DEMO_ORDER.label}-commercial-invoice.pdf`), docs.invoicePdf);
const orderDir = join(out, "agent", "orders", orderId);
write(join(orderDir, "documents.json"), json({ extractions: docs.extractions, fileHashes: docs.fileHashes }));

// The carrier the signed order names, when app's demo-data already wrote the order
const orderFile = join(orderDir, "order.json");
let carrier = demoCarrier().address.toLowerCase() as Hex;
if (existsSync(orderFile)) {
  carrier = (JSON.parse(readFileSync(orderFile, "utf8")).order.carrier as string).toLowerCase() as Hex;
} else {
  console.log(`no order.json at ${orderFile}: run app's demo-data first with the same wallets`);
}
const mine = demoCarrier().address.toLowerCase();
if (carrier !== mine) {
  console.log(`warning: the order names ${carrier} as carrier but the demo carrier key is ${mine}.`);
  console.log("Set the address of Harbor Line in app/src/data/mock.ts to the second one, or the attestation will not verify.");
}

if (values.escrow) {
  const chainId = Number(values["chain-id"]);
  const { attestation, sigCarrier } = await demoShipment(docs, { orderId, carrier, chainId, escrow: address("escrow", values.escrow) });
  write(join(orderDir, "shipment.json"), json({ attestation, sigCarrier }));
} else {
  console.log("no --escrow: shipment.json not written (the attestation is signed for one escrow contract)");
}
console.log(`order ${DEMO_ORDER.label} = ${orderId}`);
