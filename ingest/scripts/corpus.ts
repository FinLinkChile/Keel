// Renders the document corpora (T3.8) for Area 5 to measure: Keel Trade to
// redteam/corpus/trade and Keel Personal to redteam/corpus/personal, one PDF per document and a
// manifest with each case's conditions and expected result.
// Deterministic: the same specs give the same bytes. Usage: npm run corpus -w ingest
import { mkdir, rm, writeFile } from "node:fs/promises";
import { fileHash, uploadDomain, UPLOAD_TYPES } from "../src/trade/upload";
import { ADVERSARIAL_CASES, corpusAttestation, corpusPurchaseOrder, LEGIT_SETS, type LegitSet } from "../src/testing/tradeCorpus";
import { CORPUS_CHAIN_ID, renderFile } from "../src/testing/tradeCorpusRunner";
import { PERSONAL_ALIASES, PERSONAL_CASES, PERSONAL_LEGIT, renderCase } from "../src/testing/personalCorpus";
import { renderInvoice } from "../src/testing/renderInvoice";

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

// Keel Personal: the bills are committed; the emails that carry them are built at run time,
// because DKIM keys are generated per run. `delivery`, `attachments` and `setup` say how.
const personalDir = new URL("../../redteam/corpus/personal/", import.meta.url);
await rm(personalDir, { recursive: true, force: true });
await mkdir(new URL("legit/", personalDir), { recursive: true });
await mkdir(new URL("adversarial/", personalDir), { recursive: true });
const personalDocs: Record<string, unknown>[] = [];
const savePersonal = async (path: string, bytes: Uint8Array) => {
  await writeFile(new URL(path, personalDir), bytes);
  return fileHash(bytes);
};
for (const l of PERSONAL_LEGIT) {
  const path = `legit/${l.id}-${l.issuer.alias.toLowerCase()}-${l.truth.period}.pdf`;
  personalDocs.push({
    id: l.id,
    kind: "legit",
    alias: l.issuer.alias,
    path,
    fileHash: await savePersonal(path, await renderInvoice(l.spec)),
    delivery: "signed",
    truth: l.truth,
    expected: { status: "ready" },
  });
}
for (const pc of PERSONAL_CASES) {
  const path = `adversarial/${pc.id}.pdf`;
  personalDocs.push({
    id: pc.id,
    kind: "adversarial",
    title: pc.title,
    alias: pc.base.issuer.alias,
    path,
    fileHash: await savePersonal(path, await renderCase(pc)),
    delivery: pc.delivery ?? "signed",
    ...(pc.attachments ? { attachments: pc.attachments } : {}),
    setup: pc.setup ?? [],
    truth: { ...pc.base.truth, ...pc.truth },
    expected: pc.expected,
  });
}
await writeFile(
  new URL("manifest.json", personalDir),
  JSON.stringify(
    {
      description:
        "Keel Personal bill corpus (T3.8). Every company and person is fictitious. Each bill arrives by email: `delivery` says how the email is built (signed by the registered domain, forged, look-alike domain, or a signed email whose attachment was swapped), `attachments` overrides the single PDF, and `setup` lists what was received before (`base`: the legitimate bill of the same issuer and period, `same_email`: this very email). `expected` is the ingest outcome with an honest reader. Run in CI by ingest/src/personalCorpus.test.ts.",
      aliases: PERSONAL_ALIASES,
      documents: personalDocs,
    },
    null,
    2,
  ) + "\n",
);
console.log(`wrote ${personalDocs.length} documents to ${personalDir.pathname}`);
