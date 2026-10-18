// Maps what ingest produces for a Keel Trade document upload (TradeOutcome, ingest/src/trade/
// receive.ts) to the bot's Notices. Same rules as the email mapper: written against ingest's
// types, type-only imports, and the notices it returns still go through NotifyService validation.
//
// The outcome is read through a strict copy of its shape: every field that is read is validated
// (enums, hashes, ids), and the rest is never looked at. Nothing a document says is copied:
// - the destinations in `alert.found` are attacker-chosen accounts and never leave this file;
// - the readings of the model and the parser only travel as `diffs`, which the notice schema
//   and domain/diffs.ts check again field by field;
// - no file name, address of the uploader or free text is read at all.
//
// One outcome can give more than one notice: a disagreement and an account alert, for instance.
//
// Not mapped on purpose (logged by ingest, nothing to tell a person):
// - "rejected": a failed signature or an unknown order, before anything was read;
// - "quarantined": not a PDF or too many uploads, so spam never becomes notifications;
// - "duplicate": nothing new happened;
// - "ready" without an alert or hidden text: the engine decides, and its own notices follow.
import { CURRENCIES, REQUIRED_DOC_TYPES } from "@keel/schemas";
import { z } from "zod";
import { TRADE_DIFF_FIELDS, type Notice, type TradeDiff } from "../../domain/notice";
import type { OrderBook, OrderEntry } from "../config/orders-file";

export interface TradeMapperOptions {
  orders: OrderBook;
  // Unix ms
  now: () => number;
}

// The order is not in BOT_ORDERS_FILE: nobody can be told. The route answers mapper_failed.
export class UnknownOrderError extends Error {
  constructor() {
    super("unknown_order");
    this.name = "UnknownOrderError";
  }
}

// ---------------------------------------------------------------------------
// The shape of TradeOutcome, as far as the bot reads it
// ---------------------------------------------------------------------------

const Hash = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
// Same values as ALERT_TRIGGERS and ALERT_REMINDER in ingest/src/trade/accountAlert.ts
export const ALERT_TRIGGER_VALUES = ["announced_in_document", "unknown_destination"] as const;
export const ALERT_REMINDER_VALUE = "payout_changes_only_with_new_signed_order";
// Same values as UPLOAD_REJECTIONS in ingest/src/trade/upload.ts and TradeQuarantineReason
const REJECTIONS = ["too_large", "unknown_order", "unknown_doc_type", "bad_signature", "stale_signature", "not_a_party"] as const;
const QUARANTINES = ["not_pdf", "too_large", "rate_limited"] as const;

// Plain objects: ingest may add fields, and parsing drops them, so none can be read by mistake.
const Received = {
  orderId: Hash,
  docType: z.enum(REQUIRED_DOC_TYPES),
  fileHash: Hash,
  party: z.enum(["importer", "exporter"]),
};
const FieldDiff = z.object({ field: z.string(), parser: z.union([z.string(), z.number()]), llm: z.union([z.string(), z.number()]) });
const Alert = z.object({
  id: z.number().int().nonnegative(),
  triggers: z.array(z.enum(ALERT_TRIGGER_VALUES)).min(1),
  reminder: z.literal(ALERT_REMINDER_VALUE),
});

export const TradeOutcomeShape = z.union([
  z.object({ status: z.literal("rejected"), reason: z.enum(REJECTIONS) }),
  z.object({ status: z.literal("quarantined"), reason: z.enum(QUARANTINES), ...Received }),
  z.object({ status: z.literal("duplicate"), reason: z.enum(["same_file", "duplicate_document_number"]), ...Received }),
  z.object({ status: z.literal("held"), reason: z.literal("bl_used_by_other_order"), ...Received }),
  z.object({ status: z.literal("held"), reason: z.literal("doc_type_mismatch"), ...Received }),
  z.object({ status: z.literal("held"), reason: z.enum(["parser_failed", "extractor_failed"]), ...Received }),
  z.object({
    status: z.literal("held"),
    reason: z.literal("disagreement"),
    ...Received,
    diffs: z.array(FieldDiff).min(1),
    extraction: z.unknown(),
    alert: Alert.optional(),
  }),
  z.object({ status: z.literal("ready"), ...Received, extraction: z.unknown(), alert: Alert.optional() }),
]);
export type TradeOutcomeShape = z.infer<typeof TradeOutcomeShape>;

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

const seconds = (ms: number) => Math.floor(ms / 1000);
const DIFF_FIELDS: readonly string[] = TRADE_DIFF_FIELDS;
const CURRENCY_VALUES: readonly string[] = CURRENCIES;

// What the extraction says, read defensively: it comes from a document, so a value of the wrong
// type is ignored instead of failing the whole outcome and losing the alert.
function readExtraction(extraction: unknown) {
  const e = (typeof extraction === "object" && extraction !== null ? extraction : {}) as Record<string, unknown>;
  const amount = e.amount_minor;
  return {
    hiddenText: e.hidden_text_detected === true,
    currency: typeof e.currency === "string" && CURRENCY_VALUES.includes(e.currency) ? (e.currency as (typeof CURRENCIES)[number]) : undefined,
    amountMinor: typeof amount === "number" && Number.isSafeInteger(amount) && amount > 0 ? amount : undefined,
  };
}

// Values the notice schema accepts: a string is cut to its limit (domain/diffs.ts decides if it
// can be shown, and almost never does) and a number that is not finite is emptied.
const diffValue = (v: string | number): string | number => (typeof v === "number" ? (Number.isFinite(v) ? v : "") : v.slice(0, 200));

export function mapTradeOutcome(raw: unknown, opts: TradeMapperOptions): Notice[] {
  const outcome = TradeOutcomeShape.parse(raw);
  if (outcome.status === "rejected" || outcome.status === "quarantined" || outcome.status === "duplicate") return [];

  const entry: OrderEntry | undefined = opts.orders.get(outcome.orderId);
  if (!entry) throw new UnknownOrderError();
  const base = {
    mode: "trade" as const,
    occurredAt: seconds(opts.now()),
    orderRef: entry.orderRef,
    orderLabel: entry.label,
    parties: entry.parties,
  };
  // One id per file and reason: the same upload reported twice is sent once
  const key = `ingest:trade:${outcome.fileHash.toLowerCase()}`;
  const notices: Notice[] = [];

  if (outcome.status === "held") {
    switch (outcome.reason) {
      case "bl_used_by_other_order":
        notices.push({ ...base, id: `${key}:bl_reused`, kind: "operation_held", reason: "bl_reused", deadline: entry.shipmentDeadline });
        break;
      case "doc_type_mismatch":
        notices.push({ ...base, id: `${key}:documents_mismatch`, kind: "operation_held", reason: "documents_mismatch", deadline: entry.shipmentDeadline });
        break;
      case "parser_failed":
      case "extractor_failed":
        notices.push({ ...base, id: `${key}:document_unreadable`, kind: "operation_held", reason: "document_unreadable", deadline: entry.shipmentDeadline });
        break;
      case "disagreement": {
        const reading = readExtraction(outcome.extraction);
        // The parser is a and the model is b. A field ingest compares that the bot does not know
        // is dropped; the others still reach the importer.
        const diffs: TradeDiff[] = outcome.diffs
          .filter((d) => DIFF_FIELDS.includes(d.field))
          .map((d) => ({ field: d.field as TradeDiff["field"], a: diffValue(d.parser), b: diffValue(d.llm) }));
        notices.push({
          ...base,
          id: `${key}:two_source_mismatch`,
          kind: "operation_held",
          reason: "two_source_mismatch",
          deadline: entry.shipmentDeadline,
          // Needed to show an amount that disagrees: the currency and amount of the parser
          ...(reading.currency && reading.amountMinor ? { currency: reading.currency, amountMinor: reading.amountMinor } : {}),
          ...(diffs.length > 0 ? { diffs } : {}),
        });
        break;
      }
    }
  }

  // The document has text meant for a machine: a hold of its own, on top of any other
  if ((outcome.status === "ready" || outcome.reason === "disagreement") && "extraction" in outcome && readExtraction(outcome.extraction).hiddenText) {
    notices.push({ ...base, id: `${key}:hidden_text`, kind: "operation_held", reason: "hidden_text", deadline: entry.shipmentDeadline });
  }

  // An alert (the document announces other bank details or carries an account that is not the
  // order's) says only that it happened. The triggers and the reminder code stay in ingest; the
  // message already says the account can only change with a new signed order.
  const alert = (outcome as { alert?: z.infer<typeof Alert> }).alert;
  if (alert) notices.push({ ...base, id: `ingest:trade:alert:${alert.id}`, kind: "account_change_attempt" });
  return notices;
}
