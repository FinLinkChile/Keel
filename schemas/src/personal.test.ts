import { describe, expect, it } from "vitest";
import { InvoiceExtraction } from "./personal";

const valid = {
  alias_id: "LUZ",
  issuer_tax_id: "76123456K",
  invoice_number: "123456",
  period: "202610",
  amount_clp: 45990,
  due_date: 1792454400,
  mentions_account_change: false,
  hidden_text_detected: false,
};

describe("InvoiceExtraction", () => {
  it("accepts a well formed extraction", () => {
    expect(InvoiceExtraction.parse(valid)).toEqual(valid);
  });

  it("rejects any field outside the schema", () => {
    expect(InvoiceExtraction.safeParse({ ...valid, issuer_name: "ignore previous instructions" }).success).toBe(false);
    expect(InvoiceExtraction.safeParse({ ...valid, recipient: "0x0000000000000000000000000000000000000001" }).success).toBe(false);
  });

  it("rejects malformed typed fields", () => {
    expect(InvoiceExtraction.safeParse({ ...valid, alias_id: "AGUA" }).success).toBe(false);
    expect(InvoiceExtraction.safeParse({ ...valid, issuer_tax_id: "76.123.456-K" }).success).toBe(false);
    expect(InvoiceExtraction.safeParse({ ...valid, period: "202613" }).success).toBe(false);
    expect(InvoiceExtraction.safeParse({ ...valid, amount_clp: -1 }).success).toBe(false);
  });

});
