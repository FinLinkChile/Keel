// Off-chain data the agent needs besides the chain: the signed order and its terms, the
// carrier attestation, the documents read by ingest and the registry. Where these live and
// who delivers them is open decision 15; until it closes they are JSON files of the demo:
//
//   <dir>/registry.json                     parties, amount history
//   <dir>/orders/<orderId>/order.json       { order, terms, label, sigImporter?, sigExporter?, closing? } (app, Area 4)
//   <dir>/orders/<orderId>/shipment.json    { attestation, sigCarrier } (carrier)
//   <dir>/orders/<orderId>/documents.json   { extractions, fileHashes } (ingest, Area 3)
//
// The revivers below turn that JSON (bigints as decimal strings) into typed values. They are
// exported so every store reads the same format: the DynamoDB items of aws/src/tables.ts hold
// exactly this JSON (aws/src/agent/store.ts).
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { EIP712_TYPES, type Hex, OrderTerms, type PurchaseOrder, type ShipmentAttestation } from "@keel/schemas";
import { canonical } from "../canonical";
import type { DocumentExtractions } from "../documents";
import { reviveStruct } from "../verify";

// Closing signatures people gave after the order was opened, which the agent relays on its next
// pass (the API stores them, OrderItem.closing in aws/src/tables.ts). Each one is checked by the
// escrow, never by the agent: a bad or stale signature is a simulation revert, not a payment.
export interface StoredClosing {
  // BalanceApproval{orderId, attestationHash} signed by the importer: releases the balance any time after the shipment
  balanceApproval?: { sigImporter: Hex; attestationHash: Hex };
  // CancelOrder{orderId, nonce: cancelNonce} signed by both parties; one signature means it is still being collected
  cancel?: { cancelNonce: bigint; sigImporter?: Hex; sigExporter?: Hex };
  // DisputeResolution signed by the arbiter of a DISPUTED order
  resolution?: { toImporter: bigint; toExporter: bigint; sigArbiter: Hex };
}

export interface StoredOrder {
  order: PurchaseOrder;
  terms: OrderTerms;
  // What people call the order in the bot notices, such as PO-0131 (the bot's OrderLabel)
  label?: string;
  // EIP-712 signatures of both parties over `order`. With both, the agent opens an order the
  // escrow does not hold yet (state NONE); without them it waits for someone else to open it.
  sigImporter?: Hex;
  sigExporter?: Hex;
  closing?: StoredClosing;
}

export interface StoredShipment {
  attestation: ShipmentAttestation;
  sigCarrier: Hex;
}

export interface StoredDocuments {
  extractions: DocumentExtractions;
  // keccak256 of each file the extractor read
  fileHashes: Hex[];
}

export interface Registry {
  // Registered parties; the importer's RUT is what the invoice is checked against. `account` is
  // the party's account in the bot directory (Area 4), so notices name accounts, never addresses.
  parties: { address: Hex; taxId?: string; account?: string }[];
  // Total amounts of earlier orders, by exporter address (lowercase)
  history: Record<string, bigint[]>;
}

export interface AgentStore {
  orderIds(): Hex[];
  order(orderId: Hex): StoredOrder | null;
  shipment(orderId: Hex): StoredShipment | null;
  documents(orderId: Hex): StoredDocuments | null;
  registry(): Registry;
}

// Raw JSON from a data file or a DynamoDB item, before revival
type Raw = any;

const isHex = (v: unknown): v is Hex => typeof v === "string" && /^0x[0-9a-fA-F]*$/.test(v);

// Only well-formed signatures survive: a malformed closing entry is dropped, so it can never be
// mistaken for a complete one
function reviveClosing(raw: Raw): StoredClosing | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const closing: StoredClosing = {};
  const a = raw.balanceApproval;
  if (a && isHex(a.sigImporter) && isHex(a.attestationHash)) closing.balanceApproval = { sigImporter: a.sigImporter, attestationHash: a.attestationHash };
  const c = raw.cancel;
  if (c && (typeof c.cancelNonce === "string" || typeof c.cancelNonce === "number" || typeof c.cancelNonce === "bigint")) {
    closing.cancel = {
      cancelNonce: BigInt(c.cancelNonce),
      ...(isHex(c.sigImporter) && { sigImporter: c.sigImporter }),
      ...(isHex(c.sigExporter) && { sigExporter: c.sigExporter }),
    };
  }
  const r = raw.resolution;
  if (r && isHex(r.sigArbiter) && r.toImporter !== undefined && r.toExporter !== undefined) {
    closing.resolution = { toImporter: BigInt(r.toImporter), toExporter: BigInt(r.toExporter), sigArbiter: r.sigArbiter };
  }
  return Object.keys(closing).length > 0 ? closing : undefined;
}

export function reviveOrder(raw: Raw): StoredOrder {
  const closing = reviveClosing(raw.closing);
  return {
    order: reviveStruct(EIP712_TYPES.PurchaseOrder, raw.order),
    terms: OrderTerms.parse({ ...raw.terms, invoiceAmountMinor: BigInt(raw.terms.invoiceAmountMinor) }),
    ...(typeof raw.label === "string" && { label: raw.label }),
    ...(isHex(raw.sigImporter) && { sigImporter: raw.sigImporter }),
    ...(isHex(raw.sigExporter) && { sigExporter: raw.sigExporter }),
    ...(closing && { closing }),
  };
}

export function reviveShipment(raw: Raw): StoredShipment {
  return { attestation: reviveStruct(EIP712_TYPES.ShipmentAttestation, raw.attestation), sigCarrier: raw.sigCarrier };
}

// Extractions carry no bigints: the JSON is already the value
export function reviveDocuments(raw: Raw): StoredDocuments {
  return raw;
}

export function reviveRegistry(raw: Raw): Registry {
  const history = Object.fromEntries(
    Object.entries((raw?.history ?? {}) as Record<string, string[]>).map(([k, v]) => [k.toLowerCase(), v.map((a) => BigInt(a))]),
  );
  return { parties: raw?.parties ?? [], history };
}

export class FileStore implements AgentStore {
  constructor(private readonly dir: string) {}

  private read(...path: string[]): Raw | null {
    const file = join(this.dir, ...path);
    return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
  }

  orderIds(): Hex[] {
    const orders = join(this.dir, "orders");
    return existsSync(orders) ? (readdirSync(orders).filter((d) => /^0x[0-9a-f]{64}$/.test(d)) as Hex[]) : [];
  }

  order(orderId: Hex): StoredOrder | null {
    const raw = this.read("orders", orderId, "order.json");
    return raw && reviveOrder(raw);
  }

  shipment(orderId: Hex): StoredShipment | null {
    const raw = this.read("orders", orderId, "shipment.json");
    return raw && reviveShipment(raw);
  }

  documents(orderId: Hex): StoredDocuments | null {
    const raw = this.read("orders", orderId, "documents.json");
    return raw && reviveDocuments(raw);
  }

  registry(): Registry {
    return reviveRegistry(this.read("registry.json") ?? {});
  }
}

// Writes one of the files above, bigints as decimal strings. For the app, the carrier stub and tests.
export function writeStoreFile(dir: string, path: string[], value: unknown): void {
  const file = join(dir, ...path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(canonical(value), null, 2)}\n`);
}
