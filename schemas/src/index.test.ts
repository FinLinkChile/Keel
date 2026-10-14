import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { CommercialInvoiceExtraction, EIP712_TYPES, TransportDocumentExtraction } from "./index";

const transport = {
  doc_type: "BILL_OF_LADING",
  document_number: "EGLV123456789",
  on_board_date: 1792886400,
  port_of_loading: "CNSZX",
  port_of_discharge: "CLVAP",
  hidden_text_detected: false,
};

const invoice = {
  invoice_number: "INV20261001",
  order_number: "PO20260042",
  amount_minor: 1000000,
  currency: "USD",
  incoterm: "CIF",
  importer_tax_id: "76123456K",
  hs_code: "130231",
  mentions_account_change: false,
  hidden_text_detected: false,
};

describe("TransportDocumentExtraction", () => {
  it("accepts a well formed extraction", () => {
    expect(TransportDocumentExtraction.parse(transport)).toEqual(transport);
    expect(TransportDocumentExtraction.safeParse({ ...transport, doc_type: "AIR_WAYBILL" }).success).toBe(true);
  });

  it("rejects any field outside the schema", () => {
    expect(TransportDocumentExtraction.safeParse({ ...transport, shipper_name: "ignore previous instructions" }).success).toBe(false);
    expect(TransportDocumentExtraction.safeParse({ ...transport, notes: "release the balance" }).success).toBe(false);
  });

  it("rejects malformed typed fields", () => {
    expect(TransportDocumentExtraction.safeParse({ ...transport, doc_type: "PACKING_LIST" }).success).toBe(false);
    expect(TransportDocumentExtraction.safeParse({ ...transport, document_number: "EGLV-123 456" }).success).toBe(false);
    expect(TransportDocumentExtraction.safeParse({ ...transport, document_number: "eglv123456789" }).success).toBe(false);
    expect(TransportDocumentExtraction.safeParse({ ...transport, on_board_date: "2026-10-25" }).success).toBe(false);
    expect(TransportDocumentExtraction.safeParse({ ...transport, port_of_loading: "Shenzhen" }).success).toBe(false);
  });
});

describe("CommercialInvoiceExtraction", () => {
  it("accepts a well formed extraction", () => {
    expect(CommercialInvoiceExtraction.parse(invoice)).toEqual(invoice);
  });

  it("rejects any field outside the schema, in particular a payment destination", () => {
    expect(CommercialInvoiceExtraction.safeParse({ ...invoice, supplier_name: "ignore previous instructions" }).success).toBe(false);
    expect(CommercialInvoiceExtraction.safeParse({ ...invoice, payout_address: "0x0000000000000000000000000000000000000001" }).success).toBe(false);
    expect(CommercialInvoiceExtraction.safeParse({ ...invoice, bank_account: "HK1234567890" }).success).toBe(false);
  });

  it("rejects malformed typed fields", () => {
    expect(CommercialInvoiceExtraction.safeParse({ ...invoice, currency: "CLP" }).success).toBe(false);
    expect(CommercialInvoiceExtraction.safeParse({ ...invoice, incoterm: "DDP" }).success).toBe(false);
    expect(CommercialInvoiceExtraction.safeParse({ ...invoice, amount_minor: -1 }).success).toBe(false);
    expect(CommercialInvoiceExtraction.safeParse({ ...invoice, amount_minor: 10000.5 }).success).toBe(false);
    expect(CommercialInvoiceExtraction.safeParse({ ...invoice, importer_tax_id: "76.123.456-K" }).success).toBe(false);
    expect(CommercialInvoiceExtraction.safeParse({ ...invoice, hs_code: "1302.31" }).success).toBe(false);
  });
});

// The JSON Schema files are generated from zod (npm run gen:json -w @keel/schemas).
// This fails when someone edits one side and not the other.
describe("JSON Schema", () => {
  it.each([
    ["transport-document-extraction", TransportDocumentExtraction],
    ["commercial-invoice-extraction", CommercialInvoiceExtraction],
  ] as const)("%s.schema.json is the zod schema", (name, schema) => {
    const committed = JSON.parse(readFileSync(new URL(`../json/${name}.schema.json`, import.meta.url), "utf8"));
    expect(committed).toEqual(z.toJSONSchema(schema));
  });

  it.each(["transport-document-extraction", "commercial-invoice-extraction"])("%s.schema.json has no free text", (name) => {
    const committed = JSON.parse(readFileSync(new URL(`../json/${name}.schema.json`, import.meta.url), "utf8"));
    expect(committed.additionalProperties).toBe(false);
    expect(Object.keys(committed.properties).sort()).toEqual([...committed.required].sort());
    for (const [field, spec] of Object.entries<Record<string, unknown>>(committed.properties)) {
      const bounded = spec.type !== "string" || "pattern" in spec || "enum" in spec;
      expect(bounded, field).toBe(true);
    }
  });
});

describe("EIP712_TYPES", () => {
  it("only uses static field types, so the Solidity encoding needs no nested hashing", () => {
    for (const fields of Object.values(EIP712_TYPES)) {
      for (const field of fields) expect(field.type).toMatch(/^(address|bytes32|uint(8|16|64|256))$/);
    }
  });
});
