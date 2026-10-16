// One uploaded Keel Trade document, end to end. Checks run cheapest first, so a flood costs no
// LLM calls: signature and party, PDF, duplicate file, order rate limit, parser, bill of lading
// already used, model, two-source agreement, declared type, account alert, acceptance.
// Nothing here pays, releases funds or changes an order: the result is a reading for the engine
// (Area 2) and, at most, an alert for Area 4.
import type { Hex, RequiredDocType } from "@keel/schemas";
import type { ExtractorProvider } from "../extractor";
import { MAX_PDF_BYTES } from "../pdf/text";
import { MAX_DOCUMENTS_PER_ORDER_PER_DAY, type IngestStore } from "../store";
import { ALERT_REMINDER, detectAccountAlert, type AccountAlert } from "./accountAlert";
import { readCommercialInvoice, readTransportDocument, type CommercialInvoiceReading, type TransportReading } from "./agreement";
import { authorizeUpload, type OrderRegistry, type Party, type UploadRejection, type UploadRequest } from "./upload";

export type TradeQuarantineReason = "not_pdf" | "too_large" | "rate_limited";

interface Received {
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
  store: IngestStore;
  chainId: number;
  now?: () => Date;
}

// Identified by content, not by the declared type or file name, which the uploader controls
const isPdf = (bytes: Uint8Array) => Buffer.from(bytes.subarray(0, 1024)).includes("%PDF-");

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
  const received: Received = {
    orderId: auth.order.orderId,
    docType: auth.docType,
    fileHash: auth.fileHash,
    uploader: auth.uploader,
    party: auth.party,
  };
  if (!isPdf(req.file)) return { status: "quarantined", reason: "not_pdf", ...received };

  // Only authorized uploads count against an order, so nobody can spend another order's quota
  if (!store.recordUpload(received)) return { status: "duplicate", reason: "same_file", ...received };
  if (store.uploadsForOrder(received.orderId) > MAX_DOCUMENTS_PER_ORDER_PER_DAY) {
    return { status: "quarantined", reason: "rate_limited", ...received };
  }

  let reading: TransportReading | CommercialInvoiceReading;
  if (auth.docType === "COMMERCIAL_INVOICE") {
    reading = await readCommercialInvoice(req.file, extractor);
  } else {
    const r = await readTransportDocument(req.file, extractor, {
      carrier: auth.order.carrier,
      beforeModel: (bl) => {
        const owner = store.orderForBl(bl);
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

  if ("blNumberHash" in reading && reading.extraction.doc_type !== auth.docType) {
    return { status: "held", reason: "doc_type_mismatch", found: reading.extraction.doc_type, ...received };
  }

  const mentions = "mentions_account_change" in reading.extraction && reading.extraction.mentions_account_change;
  const detected = detectAccountAlert(mentions, reading.destinations, auth.order);
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
    alert = { ...body, id: store.addAlert(body) };
  }

  if (reading.status === "ready") {
    const accepted = store.acceptDocument({
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
