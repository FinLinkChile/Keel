// Off-chain data the agent needs besides the chain: the signed order and its terms, the
// carrier attestation, the documents read by ingest and the registry. Where these live and
// who delivers them is open decision 15; until it closes they are JSON files of the demo:
//
//   <dir>/registry.json                     parties, known suppliers, amount history
//   <dir>/orders/<orderId>/order.json       { order, terms }        (app, Area 4)
//   <dir>/orders/<orderId>/shipment.json    { attestation, sigCarrier } (carrier)
//   <dir>/orders/<orderId>/documents.json   { extractions, fileHashes } (ingest, Area 3)
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { EIP712_TYPES, type Hex, OrderTerms, type PurchaseOrder, type ShipmentAttestation } from "@keel/schemas";
import { canonical } from "../canonical";
import type { DocumentExtractions } from "../documents";
import type { KnownSupplier } from "../funding";
import { reviveStruct } from "../verify";

export interface StoredOrder {
  order: PurchaseOrder;
  terms: OrderTerms;
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
  // Registered parties; the importer's RUT is what the invoice is checked against
  parties: { address: Hex; taxId?: string }[];
  knownSuppliers: KnownSupplier[];
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

// Raw JSON from a data file, before revival
type Raw = any;

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
    if (!raw) return null;
    return {
      order: reviveStruct(EIP712_TYPES.PurchaseOrder, raw.order),
      terms: OrderTerms.parse({ ...raw.terms, invoiceAmountMinor: BigInt(raw.terms.invoiceAmountMinor) }),
    };
  }

  shipment(orderId: Hex): StoredShipment | null {
    const raw = this.read("orders", orderId, "shipment.json");
    return raw && { attestation: reviveStruct(EIP712_TYPES.ShipmentAttestation, raw.attestation), sigCarrier: raw.sigCarrier };
  }

  documents(orderId: Hex): StoredDocuments | null {
    return this.read("orders", orderId, "documents.json");
  }

  registry(): Registry {
    const raw = this.read("registry.json") ?? {};
    const history = Object.fromEntries(
      Object.entries((raw.history ?? {}) as Record<string, string[]>).map(([k, v]) => [k.toLowerCase(), v.map((a) => BigInt(a))]),
    );
    return { parties: raw.parties ?? [], knownSuppliers: raw.knownSuppliers ?? [], history };
  }
}

// Writes one of the files above, bigints as decimal strings. For the app, the carrier stub and tests.
export function writeStoreFile(dir: string, path: string[], value: unknown): void {
  const file = join(dir, ...path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(canonical(value), null, 2)}\n`);
}
