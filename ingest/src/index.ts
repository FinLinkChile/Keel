// Invoice ingestion. Owned by Area 3.
export { invoiceKey } from "./invoiceKey";
export {
  foldHomoglyphs,
  NormalizationError,
  normalizeInvoiceNumber,
  normalizePeriod,
  normalizeRut,
} from "./normalize";

import type { InvoiceExtraction } from "@keel/schemas";

// Deterministic parser: PDF text plus regular expressions. T3.3, issue #20.
export async function parseInvoice(_pdf: Uint8Array): Promise<InvoiceExtraction> {
  throw new Error("not implemented: T3.3 (#20)");
}

// Quarantined LLM extractor: no tools, strict schema output. T3.4, issue #21.
export async function extractInvoice(_pdf: Uint8Array): Promise<InvoiceExtraction> {
  throw new Error("not implemented: T3.4 (#21)");
}
