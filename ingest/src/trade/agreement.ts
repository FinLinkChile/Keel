// Two-source agreement for the Keel Trade documents. T3.5, issue #22.
// The parser and the quarantined LLM read the same document independently. A manipulated LLM
// can return a wrong value inside a valid schema; disagreeing with the parser exposes it.
// In Keel Trade a disagreement holds the operation: there is no tier 3 for a document.
import type { CommercialInvoiceExtraction, Hex, TransportDocumentExtraction } from "@keel/schemas";
import { blNumberHash } from "@keel/schemas/hash";
import {
  extractCommercialInvoice,
  ExtractionError,
  extractTransportDocument,
  type ExtractionFailure,
  type ExtractorProvider,
} from "../extractor";
import type { PaymentDestination } from "../parser";
import type { HiddenReason } from "../pdf/hidden";
import {
  parseCommercialInvoice,
  parseTransportDocument,
  TradeParseError,
  type ParsedCommercialInvoice,
  type ParsedTransportDocument,
  type TradeParsedField,
  type TradeParseFailure,
} from "./parser";

// Every typed field is compared, not only the four of T3.5 (document number, on board date,
// amount, currency): the ports and the parties also reach the engine, so a model that bends
// any of them must be caught here too.
export const TRANSPORT_COMPARED_FIELDS = [
  "doc_type",
  "document_number",
  "on_board_date",
  "port_of_loading",
  "port_of_discharge",
] as const satisfies readonly (keyof TransportDocumentExtraction)[];

export const INVOICE_COMPARED_FIELDS = [
  "invoice_number",
  "order_number",
  "amount_minor",
  "currency",
  "incoterm",
  "importer_tax_id",
  "hs_code",
] as const satisfies readonly (keyof CommercialInvoiceExtraction)[];

export interface TradeFieldDiff {
  field: string;
  parser: string | number;
  llm: string | number;
}

interface Readings<T> {
  // Always the parser's values, with both sources' warning flags combined
  extraction: T;
  destinations: PaymentDestination[];
  hiddenReasons: HiddenReason[];
}

type Read<T, Extra> =
  | ({ status: "ready" } & Readings<T> & Extra)
  | ({ status: "held"; reason: "disagreement"; diffs: TradeFieldDiff[] } & Readings<T> & Extra);

type Failed =
  | { status: "held"; reason: "parser_failed"; failure: TradeParseFailure; field?: TradeParsedField }
  | { status: "held"; reason: "extractor_failed"; failure: ExtractionFailure };

// The transport document carries the key the carrier's attestation is matched by (T3.7)
export type TransportReading = Read<TransportDocumentExtraction, { blNumberHash: Hex }> | Failed;
export type CommercialInvoiceReading = Read<CommercialInvoiceExtraction, object> | Failed;

function compare<T extends Record<string, unknown>, F extends keyof T & string>(
  parsed: Readings<T>,
  llm: T,
  fields: readonly F[],
  flags: (keyof T & string)[],
) {
  const p = parsed.extraction;
  const diffs: TradeFieldDiff[] = fields
    .filter((f) => p[f] !== llm[f])
    .map((field) => ({ field, parser: p[field] as string | number, llm: llm[field] as string | number }));
  const extraction = { ...p };
  for (const flag of flags) (extraction as Record<string, unknown>)[flag] = Boolean(p[flag]) || Boolean(llm[flag]);
  const readings: Readings<T> = { extraction, destinations: parsed.destinations, hiddenReasons: parsed.hiddenReasons };
  return diffs.length === 0
    ? { status: "ready" as const, ...readings }
    : { status: "held" as const, reason: "disagreement" as const, diffs, ...readings };
}

// `carrier` comes from the signed order, never from the document
export function compareTransport(parsed: ParsedTransportDocument, llm: TransportDocumentExtraction, carrier: Hex) {
  return {
    ...compare(parsed, llm, TRANSPORT_COMPARED_FIELDS, ["hidden_text_detected"]),
    blNumberHash: blNumberHash(carrier, parsed.extraction.document_number),
  };
}

export function compareCommercialInvoice(parsed: ParsedCommercialInvoice, llm: CommercialInvoiceExtraction) {
  return compare(parsed, llm, INVOICE_COMPARED_FIELDS, ["mentions_account_change", "hidden_text_detected"]);
}

export interface TransportReadOptions {
  // The carrier fixed in the order, for blNumberHash
  carrier: Hex;
  // Checked after the parser and before the model, so a reused bill of lading costs no LLM
  // call. Returns a hold reason, or undefined to go on.
  beforeModel?: (
    blNumberHash: Hex,
  ) => "bl_used_by_other_order" | "duplicate_document_number" | undefined | Promise<"bl_used_by_other_order" | "duplicate_document_number" | undefined>;
}

// Parser first, then the model: an unreadable document never reaches the LLM.
async function twoSources<P, L, R>(
  parse: () => Promise<P>,
  extract: () => Promise<L>,
  combine: (parsed: P, llm: L) => R,
  beforeModel?: (parsed: P) => R | undefined | Promise<R | undefined>,
): Promise<R | Failed> {
  let parsed: P;
  try {
    parsed = await parse();
  } catch (e) {
    if (e instanceof TradeParseError) return { status: "held", reason: "parser_failed", failure: e.reason, field: e.field };
    throw e;
  }
  const early = await beforeModel?.(parsed);
  if (early !== undefined) return early;
  let llm: L;
  try {
    llm = await extract();
  } catch (e) {
    if (e instanceof ExtractionError) return { status: "held", reason: "extractor_failed", failure: e.reason };
    throw e;
  }
  return combine(parsed, llm);
}

export type EarlyTransportOutcome =
  | { status: "held"; reason: "bl_used_by_other_order"; blNumberHash: Hex }
  | { status: "duplicate"; reason: "duplicate_document_number"; blNumberHash: Hex };

export async function readTransportDocument(
  pdf: Uint8Array,
  extractor: ExtractorProvider,
  options: TransportReadOptions,
): Promise<TransportReading | EarlyTransportOutcome> {
  return twoSources<ParsedTransportDocument, TransportDocumentExtraction, TransportReading | EarlyTransportOutcome>(
    () => parseTransportDocument(pdf),
    () => extractTransportDocument(pdf, extractor),
    (parsed, llm) => compareTransport(parsed, llm, options.carrier),
    async (parsed) => {
      const key = blNumberHash(options.carrier, parsed.extraction.document_number);
      const verdict = await options.beforeModel?.(key);
      if (verdict === "bl_used_by_other_order") return { status: "held", reason: verdict, blNumberHash: key };
      if (verdict === "duplicate_document_number") return { status: "duplicate", reason: verdict, blNumberHash: key };
      return undefined;
    },
  );
}

export async function readCommercialInvoice(pdf: Uint8Array, extractor: ExtractorProvider): Promise<CommercialInvoiceReading> {
  return twoSources(() => parseCommercialInvoice(pdf), () => extractCommercialInvoice(pdf, extractor), compareCommercialInvoice);
}
