// Runs the Keel Trade corpus through the real ingest pipeline (signature, store, parser,
// extractor, agreement, alert). The extractor is a parameter: an honest double in CI
// (trade/corpus.test.ts), the configured LLM in scripts/corpus-run.ts.
import type { CommercialInvoiceExtraction, Hex, RequiredDocType, TransportDocumentExtraction } from "@keel/schemas";
import type { ExtractorProvider } from "../extractor";
import { IngestStore } from "../store";
import { receiveTradeDocument, type TradeOutcome } from "../trade/receive";
import { staticOrders, uploadDomain, UPLOAD_TYPES, fileHash } from "../trade/upload";
import { renderCommercialInvoice, renderTransport } from "./renderTrade";
import { ADVERSARIAL_CASES, LEGIT_SETS, testAccount, type AdversarialCase, type Expected, type LegitSet } from "./tradeCorpus";

export const CORPUS_CHAIN_ID = 31337;
export const corpusOrders = staticOrders(LEGIT_SETS.map((s) => s.order.entry));

type File = AdversarialCase["file"];

export async function renderFile(file: File): Promise<Uint8Array> {
  if (file.kind === "bytes") return file.bytes;
  return file.kind === "transport" ? renderTransport(file.spec) : renderCommercialInvoice(file.spec);
}

const isoDate = (unix: number) => new Date(unix * 1000).toISOString().slice(0, 10);

// A model that reads correctly: it returns `truth` in the shape the LLM schema asks for, and
// the buyer's RUT as the token the redacted text carries, as a well-behaved model would.
export function honestModel(truth: TransportDocumentExtraction | CommercialInvoiceExtraction): ExtractorProvider {
  return {
    provider: "honest-double",
    model: "truth",
    complete: async (request) => {
      if ("doc_type" in truth) return JSON.stringify({ ...truth, on_board_date: isoDate(truth.on_board_date) });
      const { amount_minor, ...rest } = truth;
      const rutToken = /\[RUT_[0-9a-f]{8}\]/.exec(request.text)?.[0] ?? truth.importer_tax_id;
      return JSON.stringify({ ...rest, total_amount: (amount_minor / 100).toFixed(2), importer_tax_id: rutToken });
    },
  };
}

export interface UploadOptions {
  signer?: ReturnType<typeof testAccount>;
  signedBytes?: Uint8Array;
  issuedAtOffsetSeconds?: number;
  now?: Date;
}

export async function upload(
  store: IngestStore,
  extractor: ExtractorProvider,
  set: LegitSet,
  docType: RequiredDocType,
  bytes: Uint8Array,
  options: UploadOptions = {},
): Promise<TradeOutcome> {
  const now = options.now ?? new Date();
  const signer = options.signer ?? testAccount(`${set.id}:exporter`);
  const issuedAt = Math.floor(now.getTime() / 1000) + (options.issuedAtOffsetSeconds ?? 0);
  const signature = await signer.signTypedData({
    domain: uploadDomain(CORPUS_CHAIN_ID),
    types: UPLOAD_TYPES,
    primaryType: "DocumentUpload",
    message: { orderId: set.order.orderId, docType, fileHash: fileHash(options.signedBytes ?? bytes), issuedAt: BigInt(issuedAt) },
  });
  return receiveTradeDocument(
    { orderId: set.order.orderId, docType, issuedAt, signature, file: bytes },
    corpusOrders,
    extractor,
    { store, chainId: CORPUS_CHAIN_ID, now: () => now },
  );
}

const legitDoc = (set: LegitSet, which: "transport" | "invoice") =>
  which === "transport"
    ? { docType: set.order.requiredDocs[0]!, file: { kind: "transport", spec: set.transport } as File, truth: set.truth.transport }
    : { docType: "COMMERCIAL_INVOICE" as const, file: { kind: "invoice", spec: set.invoice } as File, truth: set.truth.invoice };

export interface CaseResult {
  id: string;
  title: string;
  outcome: TradeOutcome;
  expected: Expected;
  mismatches: string[];
}

// The fields of an outcome that the corpus labels, compared with the expectation.
export function compareOutcome(outcome: TradeOutcome, expected: Expected): string[] {
  const out: string[] = [];
  if (outcome.status !== expected.status) out.push(`status ${outcome.status} != ${expected.status}`);
  const reason = "reason" in outcome ? outcome.reason : undefined;
  if (expected.reason !== undefined && reason !== expected.reason) out.push(`reason ${reason} != ${expected.reason}`);
  if (expected.status === "ready" && reason !== undefined) out.push(`unexpected reason ${reason}`);
  const failure = "failure" in outcome ? outcome.failure : undefined;
  if (expected.failure !== undefined && failure !== expected.failure) out.push(`failure ${failure} != ${expected.failure}`);
  if ("extraction" in outcome) {
    const hidden = outcome.extraction.hidden_text_detected;
    if (hidden !== (expected.hiddenText ?? false)) out.push(`hidden_text_detected ${hidden}`);
    const triggers = "alert" in outcome && outcome.alert ? outcome.alert.triggers : [];
    if (JSON.stringify(triggers) !== JSON.stringify(expected.alert ?? [])) out.push(`alert ${JSON.stringify(triggers)}`);
  }
  return out;
}

// Not as expected, but more conservative: not accepted where acceptance was expected, or accepted
// with every expected warning and more. A real model may be stricter than the labels; that costs a
// manual review, never money.
export function isStricter(outcome: TradeOutcome, expected: Expected, mismatches: string[]): boolean {
  if (mismatches.length === 0) return false;
  if (expected.status === "ready") {
    if (outcome.status !== "ready") return true;
    if (!("extraction" in outcome) || mismatches.some((m) => m.startsWith("extraction"))) return false;
    const hiddenOk = outcome.extraction.hidden_text_detected || !expected.hiddenText;
    const triggers: string[] = "alert" in outcome && outcome.alert ? outcome.alert.triggers : [];
    return hiddenOk && (expected.alert ?? []).every((t) => triggers.includes(t));
  }
  return false;
}

const LEGIT_EXPECTED: Expected = { status: "ready", conforms: true };

// One fresh store per case, so cases do not depend on each other. `model` returns the
// extractor for a document, given what an honest reader would extract from it.
export async function runCorpus(
  model: (truth: TransportDocumentExtraction | CommercialInvoiceExtraction) => ExtractorProvider,
): Promise<{ legit: CaseResult[]; adversarial: CaseResult[]; packages: { id: string; docsHash?: Hex; ok: boolean }[] }> {
  const legit: CaseResult[] = [];
  const packages: { id: string; docsHash?: Hex; ok: boolean }[] = [];
  for (const set of LEGIT_SETS) {
    const store = new IngestStore(":memory:");
    for (const which of ["transport", "invoice"] as const) {
      const doc = legitDoc(set, which);
      const outcome = await upload(store, model(doc.truth), set, doc.docType, await renderFile(doc.file));
      const mismatches = compareOutcome(outcome, LEGIT_EXPECTED);
      if ("extraction" in outcome && JSON.stringify(outcome.extraction) !== JSON.stringify(doc.truth)) {
        mismatches.push(`extraction ${JSON.stringify(outcome.extraction)}`);
      }
      legit.push({ id: `${set.id}-${which}`, title: `${set.id} ${doc.docType}`, outcome, expected: LEGIT_EXPECTED, mismatches });
    }
    const pkg = store.tradePackage(set.order.orderId, set.order.requiredDocs);
    packages.push({ id: set.id, ok: pkg.status === "complete", docsHash: pkg.status === "complete" ? pkg.docsHash : undefined });
    store.close();
  }

  const adversarial: CaseResult[] = [];
  for (const c of ADVERSARIAL_CASES) {
    const store = new IngestStore(":memory:");
    // The state the attack starts from, read honestly whatever model is under test
    for (const [set, which] of c.setup ?? []) {
      const doc = legitDoc(set, which);
      const r = await upload(store, honestModel(doc.truth), set, doc.docType, await renderFile(doc.file));
      if (r.status !== "ready") throw new Error(`${c.id}: setup document of ${set.id} was ${r.status}`);
    }
    const base = c.file.kind === "invoice" ? c.set.truth.invoice : c.set.truth.transport;
    const truth = { ...base, ...c.truth } as TransportDocumentExtraction | CommercialInvoiceExtraction;
    const outcome = await upload(store, model(truth), c.set, c.docType, await renderFile(c.file), {
      signer: c.upload?.signer === "outsider" ? testAccount("outsider") : undefined,
      signedBytes: c.upload?.signedFile ? await renderFile(c.upload.signedFile) : undefined,
      issuedAtOffsetSeconds: c.upload?.issuedAtOffsetSeconds,
    });
    adversarial.push({ id: c.id, title: c.title, outcome, expected: c.expected, mismatches: compareOutcome(outcome, c.expected) });
    store.close();
  }
  return { legit, adversarial, packages };
}
