// Invoice ingestion. Owned by Area 3.
export { invoiceKey } from "./invoiceKey";
export {
  foldHomoglyphs,
  NormalizationError,
  normalizeInvoiceNumber,
  normalizePeriod,
  normalizeRut,
} from "./normalize";
export {
  findPaymentDestinations,
  mentionsAccountChange,
  parseInvoice,
  ParseError,
  PARSE_FAILURES,
  type AliasEntry,
  type AliasTable,
  type ParsedInvoice,
  type ParseFailure,
  type PaymentDestination,
} from "./parser";
export { HIDDEN_REASONS, type HiddenReason } from "./pdf/hidden";

import type { InvoiceExtraction } from "@keel/schemas";

// Quarantined LLM extractor: no tools, strict schema output. T3.4, issue #21.
export async function extractInvoice(_pdf: Uint8Array): Promise<InvoiceExtraction> {
  throw new Error("not implemented: T3.4 (#21)");
}
