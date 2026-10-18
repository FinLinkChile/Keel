// Two-source agreement. T3.5, issue #22.
// The deterministic parser and the quarantined LLM read the same invoice independently.
// A manipulated LLM can return a wrong value inside a valid schema; disagreeing with the
// parser is what exposes it. Nothing is paid on a single reading.
import type { Hex, InvoiceExtraction } from "@keel/schemas";
import { extractInvoice, ExtractionError, type ExtractionFailure, type ExtractorProvider } from "./extractor";
import { invoiceKey } from "./invoiceKey";
import {
  parseInvoice,
  ParseError,
  type AliasTable,
  type ParsedField,
  type ParsedInvoice,
  type ParseFailure,
  type PaymentDestination,
} from "./parser";
import type { HiddenReason } from "./pdf/hidden";

// alias_id is not in the T3.5 list: it is compared because the parser derives it from the
// registered RUT while the LLM infers it from what is charged, so a mismatch is a signal.
export const COMPARED_FIELDS = ["issuer_tax_id", "invoice_number", "period", "amount_clp", "alias_id"] as const;
export type ComparedField = (typeof COMPARED_FIELDS)[number];

export interface FieldDiff {
  field: ComparedField;
  parser: string | number;
  llm: string | number;
}

interface Readings {
  // Always the parser's values, with both sources' warning flags combined
  extraction: InvoiceExtraction;
  invoiceKey: Hex;
  destinations: PaymentDestination[];
  hiddenReasons: HiddenReason[];
}

export type InvoiceReading =
  | ({ status: "ready" } & Readings)
  | ({ status: "escalated"; tier: 3; diffs: FieldDiff[] } & Readings)
  | { status: "duplicate"; invoiceKey: Hex }
  | { status: "held"; reason: "parser_failed"; failure: ParseFailure; field?: ParsedField }
  | { status: "held"; reason: "extractor_failed"; failure: ExtractionFailure };

export interface ReadOptions {
  // Checked after the parser and before the model, so a resent invoice costs no LLM call
  isDuplicate?: (invoiceKey: Hex) => boolean | Promise<boolean>;
}

export function compareReadings(
  parsed: Pick<ParsedInvoice, "extraction" | "destinations" | "hiddenReasons">,
  llm: InvoiceExtraction,
): Extract<InvoiceReading, { status: "ready" | "escalated" }> {
  const p = parsed.extraction;
  const diffs: FieldDiff[] = COMPARED_FIELDS.filter((f) => p[f] !== llm[f]).map((field) => ({
    field,
    parser: p[field],
    llm: llm[field],
  }));
  const readings: Readings = {
    extraction: {
      ...p,
      mentions_account_change: p.mentions_account_change || llm.mentions_account_change,
      hidden_text_detected: p.hidden_text_detected || llm.hidden_text_detected,
    },
    invoiceKey: invoiceKey(p),
    destinations: parsed.destinations,
    hiddenReasons: parsed.hiddenReasons,
  };
  return diffs.length === 0 ? { status: "ready", ...readings } : { status: "escalated", tier: 3, diffs, ...readings };
}

// Parser first, then the model: an unreadable or duplicate invoice never reaches the LLM.
// Any failure holds the invoice with a typed reason; errors that are not ours (bugs) propagate.
export async function readInvoice(
  pdf: Uint8Array,
  aliases: AliasTable,
  extractor: ExtractorProvider,
  options: ReadOptions = {},
): Promise<InvoiceReading> {
  let parsed: ParsedInvoice;
  try {
    parsed = await parseInvoice(pdf, aliases);
  } catch (e) {
    if (e instanceof ParseError) return { status: "held", reason: "parser_failed", failure: e.reason, field: e.field };
    throw e;
  }

  const key = invoiceKey(parsed.extraction);
  if (await options.isDuplicate?.(key)) return { status: "duplicate", invoiceKey: key };

  let llm: InvoiceExtraction;
  try {
    llm = await extractInvoice(pdf, extractor);
  } catch (e) {
    if (e instanceof ExtractionError) return { status: "held", reason: "extractor_failed", failure: e.reason };
    throw e;
  }
  return compareReadings(parsed, llm);
}
