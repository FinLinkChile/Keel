// Renders the Keel Trade corpus (T3.8) to redteam/corpus/trade: one PDF per document and a
// manifest with each case's upload conditions and expected result, for Area 5 to measure.
// Deterministic: the same specs give the same bytes. Usage: npm run corpus -w ingest
import { mkdir, rm, writeFile } from "node:fs/promises";
import { fileHash, uploadDomain, UPLOAD_TYPES } from "../src/trade/upload";
import { ADVERSARIAL_CASES, corpusAttestation, corpusPurchaseOrder, LEGIT_SETS, type LegitSet } from "../src/testing/tradeCorpus";
import { CORPUS_CHAIN_ID, renderFile } from "../src/testing/tradeCorpusRunner";

const dir = new URL("../../redteam/corpus/trade/", import.meta.url);
await rm(dir, { recursive: true, force: true });
await mkdir(new URL("legit/", dir), { recursive: true });
await mkdir(new URL("adversarial/", dir), { recursive: true });

const documents: Record<string, unknown>[] = [];
const legitFiles = new Map<string, { transport: string; invoice: string }>();
for (const set of LEGIT_SETS) {
  legitFiles.set(set.id, {
    transport: fileHash(await renderFile({ kind: "transport", spec: set.transport })),
    invoice: fileHash(await renderFile({ kind: "invoice", spec: set.invoice })),
  });
}
// The package the engine evaluates: this document with the set's other legitimate document
const enginePackage = (set: LegitSet, which: "transport" | "invoice", hash: string) => {
  const legit = legitFiles.get(set.id)!;
  return which === "transport" ? [hash, legit.invoice] : [legit.transport, hash];
};
const save = async (path: string, bytes: Uint8Array) => {
  await writeFile(new URL(path, dir), bytes);
  return fileHash(bytes);
};

for (const set of LEGIT_SETS) {
  for (const which of ["transport", "invoice"] as const) {
    const docType = which === "transport" ? set.order.requiredDocs[0]! : "COMMERCIAL_INVOICE";
    const file = which === "transport" ? ({ kind: "transport", spec: set.transport } as const) : ({ kind: "invoice", spec: set.invoice } as const);
    const path = `legit/${set.id}-${docType.toLowerCase()}.pdf`;
    documents.push({
      id: `${set.id}-${which}`,
      kind: "legit",
      order: set.id,
      docType,
      path,
      fileHash: await save(path, await renderFile(file)),
      truth: which === "transport" ? set.truth.transport : set.truth.invoice,
      expected: { status: "ready", conforms: true, engine: { decision: "release", reasons: [] } },
      enginePackage: Object.values(legitFiles.get(set.id)!),
    });
  }
}

for (const c of ADVERSARIAL_CASES) {
  const path = `adversarial/${c.id}.pdf`;
  const hash = fileHash(await renderFile(c.file));
  const which = c.file.kind === "invoice" ? "invoice" : "transport";
  const truth = c.file.kind === "bytes" ? undefined : { ...(which === "invoice" ? c.set.truth.invoice : c.set.truth.transport), ...c.truth };
  documents.push({
    id: c.id,
    kind: "adversarial",
    title: c.title,
    order: c.set.id,
    docType: c.docType,
    path,
    fileHash: await save(path, await renderFile(c.file)),
    // What an honest reader extracts from the visible document
    ...(truth ? { truth } : {}),
    ...(c.expected.engine ? { enginePackage: enginePackage(c.set, which, hash) } : {}),
    upload: {
      signer: c.upload?.signer === "outsider" ? "outsider" : "exporter",
      ...(c.upload?.signedFile ? { signedFileHash: fileHash(await renderFile(c.upload.signedFile)) } : {}),
      ...(c.upload?.issuedAtOffsetSeconds ? { issuedAtOffsetSeconds: c.upload.issuedAtOffsetSeconds } : {}),
    },
    setup: (c.setup ?? []).map(([set, which]) => `${set.id}-${which}`),
    expected: c.expected,
  });
}

const bigintSafe = (_k: string, v: unknown) => (typeof v === "bigint" ? v.toString() : v);
const manifest = {
  description:
    "Keel Trade document corpus (T3.8). Every company, person and key is fictitious. `expected.status` is the ingest outcome with an honest reader. `expected.conforms` says whether the document's data match the signed order and the carrier's attestation. `expected.engine` is what evaluateDocuments should decide on `enginePackage` (this document with the set's other legitimate one), given the document's `truth` and an attestation of that package: it also holds on fraud signals such as hidden text or a mentioned account change. Regenerate with `npm run corpus -w ingest`; ingest/src/trade/corpus.test.ts checks these files.",
  uploadSignature: { domain: uploadDomain(CORPUS_CHAIN_ID), types: UPLOAD_TYPES, keys: "ingest/src/testing/tradeCorpus.ts (testKey)" },
  // Per order: the signed PurchaseOrder and OrderTerms, the importer's RUT from the party registry,
  // and the carrier's attestation of the legitimate package. For an adversarial document, the
  // engine label assumes the carrier attested `enginePackage` instead (same fields, its docsHash).
  orders: LEGIT_SETS.map((s) => {
    const files = legitFiles.get(s.id)!;
    return {
      id: s.id,
      ...s.order,
      purchaseOrder: corpusPurchaseOrder(s),
      attestation: corpusAttestation(s, [files.transport, files.invoice] as `0x${string}`[]),
      attestationFields: s.order.attestation,
    };
  }),
  documents,
};
await writeFile(new URL("manifest.json", dir), JSON.stringify(manifest, bigintSafe, 2) + "\n");
console.log(`wrote ${documents.length} documents to ${dir.pathname}`);
