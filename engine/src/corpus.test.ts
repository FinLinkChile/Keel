// The Keel Trade document corpus of Area 3 (T3.8) through the document rules (T2.2). For every
// document that reaches the engine (ingest outcome "ready"), evaluateDocuments must decide what
// the corpus labels by hand: release or hold, with exactly the labelled reasons. The data are the
// truth of each document paired with the other legitimate document of its order, as if the
// carrier attested that very package. No PDF and no LLM: this tests the engine, not the reading.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { EIP712_TYPES, type Hex, OrderTerms, type PurchaseOrder, type ShipmentAttestation } from "@keel/schemas";
import { docsHash } from "@keel/schemas/hash";
import { keccak256, toBytes } from "viem";
import { describe, expect, it } from "vitest";
import { type DocumentExtractions, evaluateDocuments } from "./documents";

const MANIFEST = fileURLToPath(new URL("../../redteam/corpus/trade/manifest.json", import.meta.url));

// Raw JSON of the manifest, before revival
type Raw = any;

interface CorpusDocument {
  id: string;
  kind: "legit" | "adversarial";
  title?: string;
  order: string;
  docType: string;
  truth: Raw;
  enginePackage?: Hex[];
  expected: { status: string; engine?: { decision: "release" | "hold"; reasons: string[] } };
}

const manifest: { orders: Raw[]; documents: CorpusDocument[] } = JSON.parse(readFileSync(MANIFEST, "utf8"));

// Integers above 16 bits travel as decimal strings in the manifest
function revive<T>(fields: readonly { name: string; type: string }[], raw: Raw): T {
  return Object.fromEntries(
    fields.map(({ name, type }) => {
      const small = type === "uint8" || type === "uint16";
      return [name, type.startsWith("uint") ? (small ? Number(raw[name]) : BigInt(raw[name])) : raw[name]];
    }),
  ) as T;
}

const orders = new Map(manifest.orders.map((o) => [o.id, o]));
const legit = (orderId: string, part: "transport" | "invoice") => manifest.documents.find((d) => d.id === `${orderId}-${part}`)!;
const toEngine = manifest.documents.filter((d) => d.expected.status === "ready");

function evaluate(doc: CorpusDocument) {
  const o = orders.get(doc.order)!;
  const order = revive<PurchaseOrder>(EIP712_TYPES.PurchaseOrder, o.purchaseOrder);
  const isInvoice = doc.docType === "COMMERCIAL_INVOICE";
  const extractions: DocumentExtractions = {
    transport: isInvoice ? legit(doc.order, "transport").truth : doc.truth,
    invoice: isInvoice ? doc.truth : legit(doc.order, "invoice").truth,
  };
  const fileHashes = doc.enginePackage!;
  // The carrier attested this order's shipment over exactly the package the engine reads
  const attestation: ShipmentAttestation = { ...revive<ShipmentAttestation>(EIP712_TYPES.ShipmentAttestation, o.attestation), docsHash: docsHash(fileHashes) };
  return evaluateDocuments(order, attestation, extractions, {
    now: Number(order.shipmentDeadline),
    fileHashes,
    terms: OrderTerms.parse({ ...o.terms, invoiceAmountMinor: BigInt(o.terms.invoiceAmountMinor) }),
    importerTaxId: o.importerTaxId,
    policyHash: keccak256(toBytes("keel-trade corpus")),
    decisionTtlSeconds: 3600,
  });
}

describe("Keel Trade document corpus through the engine (T3.8, T2.2)", () => {
  it("covers every document that reaches the engine, and only those carry an engine label", () => {
    expect(manifest.orders).toHaveLength(12);
    expect(toEngine.filter((d) => d.kind === "legit")).toHaveLength(24);
    expect(toEngine.filter((d) => d.kind === "adversarial")).toHaveLength(19);
    for (const d of manifest.documents) expect(d.expected.engine !== undefined, d.id).toBe(d.expected.status === "ready");
  });

  it.each(toEngine.map((d) => [`${d.id}${d.title ? `: ${d.title}` : ""}`, d] as const))("%s", (_, doc) => {
    const out = evaluate(doc);
    const reasons = [...new Set(out.rules.filter((r) => !r.ok).map((r) => r.reason))].sort();
    expect({ decision: out.conforms ? "release" : "hold", reasons }).toEqual({
      decision: doc.expected.engine!.decision,
      reasons: [...doc.expected.engine!.reasons].sort(),
    });
    // A release always comes with a decision the escrow can verify; a hold never does
    expect(out.decision !== undefined).toBe(out.conforms);
  });
});
