import { encodeAbiParameters, keccak256 } from "viem";
import type { Hex, InvoiceExtraction } from "@keel/schemas";
import { normalizeInvoiceNumber, normalizePeriod, normalizeRut } from "./normalize";

type KeyFields = Pick<InvoiceExtraction, "issuer_tax_id" | "invoice_number" | "period">;

// keccak256(abi.encode(string rut, string folio, string period)) over normalized values.
// Solidity equivalent: keccak256(abi.encode(rut, folio, period)).
// Identifies the invoice, not the file: re-rendering the PDF does not change it.
export function invoiceKey(fields: KeyFields): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "string" }, { type: "string" }, { type: "string" }],
      [
        normalizeRut(fields.issuer_tax_id),
        normalizeInvoiceNumber(fields.invoice_number),
        normalizePeriod(fields.period),
      ],
    ),
  );
}
