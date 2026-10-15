// Renders the Keel Trade corpus (T3.8) to redteam/corpus/trade: one PDF per document and a
// manifest with each case's upload conditions and expected result, for Area 5 to measure.
// Deterministic: the same specs give the same bytes. Usage: npm run corpus -w ingest
import { mkdir, rm, writeFile } from "node:fs/promises";
import { fileHash, uploadDomain, UPLOAD_TYPES } from "../src/trade/upload";
import { ADVERSARIAL_CASES, LEGIT_SETS } from "../src/testing/tradeCorpus";
import { CORPUS_CHAIN_ID, renderFile } from "../src/testing/tradeCorpusRunner";

const dir = new URL("../../redteam/corpus/trade/", import.meta.url);
await rm(dir, { recursive: true, force: true });
await mkdir(new URL("legit/", dir), { recursive: true });
await mkdir(new URL("adversarial/", dir), { recursive: true });

const documents: Record<string, unknown>[] = [];
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
      expected: { status: "ready", conforms: true },
    });
  }
}

for (const c of ADVERSARIAL_CASES) {
  const path = `adversarial/${c.id}.pdf`;
  documents.push({
    id: c.id,
    kind: "adversarial",
    title: c.title,
    order: c.set.id,
    docType: c.docType,
    path,
    fileHash: await save(path, await renderFile(c.file)),
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
    "Keel Trade document corpus (T3.8). Every company, person and key is fictitious. `expected` is the ingest outcome with an honest reader; `conforms` says whether the document matches the signed order and the carrier's attestation, for the engine. Regenerate with `npm run corpus -w ingest`; ingest/src/trade/corpus.test.ts checks these files.",
  uploadSignature: { domain: uploadDomain(CORPUS_CHAIN_ID), types: UPLOAD_TYPES, keys: "ingest/src/testing/tradeCorpus.ts (testKey)" },
  orders: LEGIT_SETS.map((s) => ({ id: s.id, ...s.order })),
  documents,
};
await writeFile(new URL("manifest.json", dir), JSON.stringify(manifest, bigintSafe, 2) + "\n");
console.log(`wrote ${documents.length} documents to ${dir.pathname}`);
