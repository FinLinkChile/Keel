// Invoice ingestion. Owned by Area 3.
import type { Hex, InvoiceExtraction } from "@keel/schemas";

// Deterministic parser: PDF text plus regular expressions. T3.3, issue #20.
export async function parseInvoice(_pdf: Uint8Array): Promise<InvoiceExtraction> {
  throw new Error("not implemented: T3.3 (#20)");
}

// Quarantined LLM extractor: no tools, temperature 0, strict schema output. T3.4, issue #21.
export async function extractInvoice(_pdf: Uint8Array): Promise<InvoiceExtraction> {
  throw new Error("not implemented: T3.4 (#21)");
}

// keccak256(issuer_tax_id, invoice_number, period) over normalized values. T3.7, issue #24.
export function invoiceKey(_extraction: InvoiceExtraction): Hex {
  throw new Error("not implemented: T3.7 (#24)");
}
