// One uploaded Keel Trade document, end to end. Checks run cheapest first, so a flood costs no
// LLM calls: signature and party, PDF, duplicate file, order rate limit, parser, bill of lading
// already used, model, two-source agreement, declared type, account alert, acceptance.
// Nothing here pays, releases funds or changes an order: the result is a reading for the engine
// (Area 2) and, at most, an alert for Area 4.
//
// Two halves, so the same pipeline serves a synchronous upload (the local server, the bytes in
// the request) and an asynchronous one (aws: a presigned upload, read when the file lands):
//   admitTradeUpload  the upload is recorded against the order, or refused as a duplicate or
//                     over the daily limit. Needs the authorization, not the bytes.
//   readTradeDocument the bytes of an admitted upload, read by both sources and accepted.
import type { Hex, RequiredDocType } from "@keel/schemas";
import type { ExtractorProvider } from "../extractor";
import { MAX_PDF_BYTES } from "../pdf/text";
import { MAX_DOCUMENTS_PER_ORDER_PER_DAY, type IngestRepo } from "../repo";
import { ALERT_REMINDER, detectAccountAlert, type AccountAlert } from "./accountAlert";
import { readCommercialInvoice, readTransportDocument, type CommercialInvoiceReading, type TransportReading } from "./agreement";
import { authorizeUpload, type OrderRegistry, type Party, type TradeOrderEntry, type UploadAuth, type UploadRejection, type UploadRequest } from "./upload";

export type TradeQuarantineReason = "not_pdf" | "too_large" | "rate_limited";

export interface Received {
  orderId: Hex;
  docType: RequiredDocType;
  fileHash: Hex;
  uploader: Hex;
  party: Party;
}

type Reading = Exclude<TransportReading | CommercialInvoiceReading, { reason: "parser_failed" | "extractor_failed" }>;

export type TradeOutcome =
  | { status: "rejected"; reason: UploadRejection }
  | ({ status: "quarantined"; reason: TradeQuarantineReason } & Received)
  // The same file again, or another file of a bill of lading already accepted for this order
  | ({ status: "duplicate"; reason: "same_file" | "duplicate_document_number" } & Received)
  | ({ status: "held"; reason: "bl_used_by_other_order"; blNumberHash: Hex } & Received)
  // The parser reads a transport document of another type than the one the uploader declared
  | ({ status: "held"; reason: "doc_type_mismatch"; found: RequiredDocType } & Received)
  | (Extract<TransportReading | CommercialInvoiceReading, { reason: "parser_failed" | "extractor_failed" }> & Received)
  // Ready or held for disagreement, with the alert if the document mentions another account
  | (Reading & Received & { alert?: AccountAlert & { id: number } });

export interface TradeReceiveOptions {
  store: IngestRepo;
  chainId: number;
  now?: () => Date;
}

// Identified by content, not by the declared type or file name, which the uploader controls
const isPdf = (bytes: Uint8Array) => Buffer.from(bytes.subarray(0, 1024)).includes("%PDF-");

export const receivedOf = (auth: Extract<UploadAuth, { status: "authorized" }>): Received => ({
  orderId: auth.order.orderId,
  docType: auth.docType,
  fileHash: auth.fileHash,
  uploader: auth.uploader,
  party: auth.party,
});

// Only authorized uploads count against an order, so nobody can spend another order's quota
export async function admitTradeUpload(
  received: Received,
  store: IngestRepo,
): Promise<Extract<TradeOutcome, { status: "duplicate" | "quarantined" }> | undefined> {
  const admission = await store.admitUpload(received, MAX_DOCUMENTS_PER_ORDER_PER_DAY);
  if (admission === "duplicate") return { status: "duplicate", reason: "same_file", ...received };
  if (admission === "rate_limited") return { status: "quarantined", reason: "rate_limited", ...received };
  return undefined;
}

// Reads the bytes of an admitted upload. The caller has checked that keccak256(file) is
// received.fileHash: the hash the uploader signed.
export async function readTradeDocument(
  file: Uint8Array,
  received: Received,
  order: TradeOrderEntry,
  extractor: ExtractorProvider,
  options: { store: IngestRepo; now?: () => Date },
): Promise<TradeOutcome> {
  const { store } = options;
  const now = options.now ?? (() => new Date());
  if (file.byteLength > MAX_PDF_BYTES) return { status: "quarantined", reason: "too_large", ...received };
  if (!isPdf(file)) return { status: "quarantined", reason: "not_pdf", ...received };

  let reading: TransportReading | CommercialInvoiceReading;
  if (received.docType === "COMMERCIAL_INVOICE") {
    reading = await readCommercialInvoice(file, extractor);
  } else {
    const r = await readTransportDocument(file, extractor, {
      carrier: order.carrier,
      beforeModel: async (bl) => {
        const owner = await store.orderForBl(bl);
        if (owner === undefined) return undefined;
        return owner.toLowerCase() === received.orderId.toLowerCase() ? "duplicate_document_number" : "bl_used_by_other_order";
      },
    });
    if (r.status === "duplicate") return { status: "duplicate", reason: r.reason, ...received };
    if (r.status === "held" && r.reason === "bl_used_by_other_order") {
      return { status: "held", reason: r.reason, blNumberHash: r.blNumberHash, ...received };
    }
    reading = r as TransportReading;
  }
  if ("failure" in reading) return { ...reading, ...received };

  if ("blNumberHash" in reading && reading.extraction.doc_type !== received.docType) {
    return { status: "held", reason: "doc_type_mismatch", found: reading.extraction.doc_type, ...received };
  }

  const mentions = "mentions_account_change" in reading.extraction && reading.extraction.mentions_account_change;
  const detected = detectAccountAlert(mentions, reading.destinations, order);
  let alert: (AccountAlert & { id: number }) | undefined;
  if (detected) {
    const body: AccountAlert = {
      orderId: received.orderId,
      docType: received.docType,
      triggers: detected.triggers,
      found: detected.found,
      source: { channel: "app", uploader: received.uploader, party: received.party },
      documentHash: received.fileHash,
      reminder: ALERT_REMINDER,
      createdAt: now().toISOString(),
    };
    alert = { ...body, id: await store.addAlert(body) };
  }

  if (reading.status === "ready") {
    const accepted = await store.acceptDocument({
      orderId: received.orderId,
      fileHash: received.fileHash,
      docType: received.docType,
      blHash: "blNumberHash" in reading ? reading.blNumberHash : undefined,
      extraction: reading.extraction,
    });
    // Lost a race with another order for the same bill of lading
    if (!accepted && "blNumberHash" in reading) {
      return { status: "held", reason: "bl_used_by_other_order", blNumberHash: reading.blNumberHash, ...received };
    }
  }
  return { ...reading, ...received, ...(alert ? { alert } : {}) };
}

// The synchronous upload: the bytes arrive with the signature
export async function receiveTradeDocument(
  req: UploadRequest,
  orders: OrderRegistry,
  extractor: ExtractorProvider,
  options: TradeReceiveOptions,
): Promise<TradeOutcome> {
  const { store } = options;
  const now = options.now ?? (() => new Date());
  if (req.file.byteLength > MAX_PDF_BYTES) {
    // Refused before hashing or recovering anything, with nothing recorded
    return { status: "rejected", reason: "too_large" };
  }
  const auth = await authorizeUpload(req, orders, options.chainId, now());
  if (auth.status === "rejected") return auth;
  const received = receivedOf(auth);
  if (!isPdf(req.file)) return { status: "quarantined", reason: "not_pdf", ...received };
  const refused = await admitTradeUpload(received, store);
  if (refused) return refused;
  return readTradeDocument(req.file, received, auth.order, extractor, { store, now });
}
