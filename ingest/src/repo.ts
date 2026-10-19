// The persistence port of ingest. Every check that protects against a flood or a replay lives
// behind it: message and invoice deduplication, the per-sender and per-order limits, one pending
// change per alias, one order per bill of lading. Two implementations keep the same semantics:
// IngestStore (node:sqlite, local server and tests) and the DynamoDB repo of aws/src/ingest.
// Both run the shared contract suite in ./testing/repoContract.ts.
// The repo stores hashes, domains, aliases, typed readings and change requests; never email
// bodies, document text or files.
import type { AliasId, Hex, RequiredDocType } from "@keel/schemas";
import { docsHash } from "@keel/schemas/hash";
import type { ChangeRequest } from "./beneficiaryChange";
import type { AccountAlert } from "./trade/accountAlert";
import type { Party } from "./trade/upload";

export const MAX_EMAILS_PER_SENDER_PER_DAY = 20;
// Keel Trade: authorized uploads per order and party in a day, so one party cannot spend the
// other's quota. A legitimate order needs two or three per party.
export const MAX_DOCUMENTS_PER_ORDER_PER_DAY = 10;
export const CHANGE_COOLDOWN_DAYS = 7;
export const DAY_MS = 24 * 60 * 60 * 1000;

export const CHANGE_RESOLUTIONS = ["approved", "rejected", "vetoed"] as const;
export type ChangeResolution = (typeof CHANGE_RESOLUTIONS)[number];

export interface StoredChangeRequest extends ChangeRequest {
  id: number;
  status: "pending" | ChangeResolution;
  resolvedAt?: string;
}

export type TradePackage =
  | { status: "complete"; docsHash: Hex; blNumberHash?: Hex; documents: { docType: RequiredDocType; fileHash: Hex; extraction: object }[] }
  | { status: "incomplete"; missing: RequiredDocType[] }
  // Two accepted documents of the same type: a person decides which one counts
  | { status: "ambiguous"; docType: RequiredDocType };

// One authorized upload: who uploaded which file to which order, declared as which type
export interface UploadEntry {
  orderId: Hex;
  fileHash: Hex;
  docType: RequiredDocType;
  uploader: Hex;
  party: Party;
}

export interface StoredUpload extends UploadEntry {
  receivedAt: string;
  // Set by the asynchronous reader (aws extractor): when a reading started and how it ended
  readClaimedAt?: string;
  readStatus?: string;
}

// "duplicate": this exact file was already admitted to this order. "rate_limited": this party
// already has MAX_DOCUMENTS_PER_ORDER_PER_DAY admitted uploads to the order in the window;
// nothing is recorded.
export type UploadAdmission = "admitted" | "duplicate" | "rate_limited";

export interface AcceptedDocument {
  orderId: Hex;
  fileHash: Hex;
  docType: RequiredDocType;
  blHash?: Hex;
  extraction: object;
}

// How a reading ends when the model failed in a way that does not depend on the file (a provider
// error, a timeout, a 429) and the retries ran out: the same file may be uploaded again.
export const READ_EXTRACTOR_FAILED = "held:extractor_failed";

export type StoredDocument = Pick<AcceptedDocument, "docType" | "blHash" | "extraction">;

export interface IngestRepo {
  // Keel Personal ------------------------------------------------------------------------

  // false if this exact message was already received
  recordEmail(messageHash: string, fromDomain: string): Promise<boolean>;
  // Messages accepted from this domain in the current window (one day)
  emailsFromSender(fromDomain: string): Promise<number>;
  hasInvoice(invoiceKey: string): Promise<boolean>;
  recordInvoice(invoiceKey: string, messageHash: string): Promise<void>;
  pendingChange(aliasId: AliasId): Promise<StoredChangeRequest | undefined>;
  // A rejected or vetoed change blocks new requests for the alias for CHANGE_COOLDOWN_DAYS
  inCooldown(aliasId: AliasId): Promise<boolean>;
  // The stored request, or undefined if the alias already has one pending
  addChangeRequest(request: ChangeRequest): Promise<StoredChangeRequest | undefined>;
  // false unless the request exists and was pending
  resolveChange(id: number, resolution: ChangeResolution): Promise<boolean>;
  // Requests created since `since`, oldest first, with their current status
  changeDigest(since: Date): Promise<StoredChangeRequest[]>;

  // Keel Trade ---------------------------------------------------------------------------

  // Atomic: the duplicate check, the per-order-and-party limit and the record happen together,
  // so two concurrent uploads cannot both take the last slot of the day.
  admitUpload(u: UploadEntry, max?: number): Promise<UploadAdmission>;
  // Admitted uploads to this order in the current window: of one party, or of both
  uploadsForOrder(orderId: Hex, party?: Party): Promise<number>;
  upload(orderId: Hex, fileHash: Hex): Promise<StoredUpload | undefined>;
  // The asynchronous reader takes an admitted upload before reading it. false if it is unknown,
  // already read, or being read by someone else whose claim is younger than staleAfterMs.
  claimReading(orderId: Hex, fileHash: Hex, staleAfterMs: number): Promise<boolean>;
  finishReading(orderId: Hex, fileHash: Hex, status: string): Promise<void>;
  // Gives the upload back to the reader: drops the claim of a reading that did not finish (a
  // transient failure to retry) and reopens one that finished as READ_EXTRACTOR_FAILED, so the
  // same file can be read again. false when nothing changed (unknown, or finished otherwise).
  releaseReading(orderId: Hex, fileHash: Hex): Promise<boolean>;
  // The order a bill of lading was accepted for, if any
  orderForBl(blHash: Hex): Promise<Hex | undefined>;
  // The record acceptDocument stored for this file of this order, if any. Lets a retried
  // reading finish from what was already accepted instead of reading the file again.
  acceptedDocument(orderId: Hex, fileHash: Hex): Promise<StoredDocument | undefined>;
  // true once this file is accepted for this order (also when it already was); false if the
  // bill of lading was accepted for another file in the meantime
  acceptDocument(d: AcceptedDocument): Promise<boolean>;
  // The document package of an order: one accepted document per required type, and the
  // docsHash the carrier's attestation and the engine's DocumentDecision must carry.
  tradePackage(orderId: Hex, required: readonly RequiredDocType[]): Promise<TradePackage>;
  addAlert(alert: AccountAlert): Promise<number>;
  // Alerts created since `since`, for one summary instead of a notification each
  alertDigest(since: Date): Promise<(AccountAlert & { id: number })[]>;

  // Keel Trade, proforma (T3.9) ----------------------------------------------------------

  recordProformaUpload(importer: Hex, fileHash: Hex): Promise<void>;
  // Authorized proforma uploads of this importer in the current window
  proformaUploadsToday(importer: Hex): Promise<number>;
  proformaReading<T>(importer: Hex, fileHash: Hex): Promise<T | undefined>;
  saveProformaReading(importer: Hex, fileHash: Hex, reading: unknown): Promise<void>;

  // Keel Trade, purchase analysis ---------------------------------------------------------

  // Records a request only while the importer is under `limit` in the current window, checked
  // and written in one step so concurrent requests cannot pass it. false when the limit is reached
  recordInsights(importer: Hex, limit: number): Promise<boolean>;
  // Authorized analysis requests of this importer in the current window
  insightsToday(importer: Hex): Promise<number>;
}

// Shared by both implementations, so the package rule cannot drift between them.
// `rows` are the accepted documents of one order, oldest first.
export function packageFrom(
  rows: readonly { docType: RequiredDocType; fileHash: Hex; blHash?: Hex | null; extraction: object }[],
  required: readonly RequiredDocType[],
): TradePackage {
  const missing = required.filter((t) => !rows.some((r) => r.docType === t));
  if (missing.length > 0) return { status: "incomplete", missing };
  const repeated = required.find((t) => rows.filter((r) => r.docType === t).length > 1);
  if (repeated) return { status: "ambiguous", docType: repeated };
  const documents = required.map((t) => {
    const r = rows.find((row) => row.docType === t)!;
    return { docType: t, fileHash: r.fileHash, extraction: r.extraction };
  });
  const bl = rows.find((r) => required.includes(r.docType) && r.blHash)?.blHash ?? undefined;
  return { status: "complete", docsHash: docsHash(documents.map((d) => d.fileHash)), blNumberHash: bl, documents };
}

// The UTC day a counter belongs to, YYYY-MM-DD
export const utcDay = (d: Date) => d.toISOString().slice(0, 10);
