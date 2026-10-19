import { describe, expect, it } from "vitest";
import { encodeAbiParameters, keccak256 } from "viem";
import { invoiceKey } from "./invoiceKey";
import {
  NormalizationError,
  normalizeInvoiceNumber,
  normalizePeriod,
  normalizeRut,
  rutCheckDigit,
} from "./normalize";

describe("normalizeRut", () => {
  it("computes the modulo 11 check digit, including 0 and K", () => {
    expect(rutCheckDigit("76123456")).toBe("0");
    expect(rutCheckDigit("10000013")).toBe("K");
    expect(rutCheckDigit("12345678")).toBe("5");
  });

  it("removes dots, hyphen and spaces, and uppercases K", () => {
    expect(normalizeRut("76.123.456-0")).toBe("761234560");
    expect(normalizeRut("10.000.013-k")).toBe("10000013K");
    expect(normalizeRut(" 12345678 5 ")).toBe("123456785");
  });

  it("rejects a wrong check digit or a malformed RUT", () => {
    expect(() => normalizeRut("76.123.456-K")).toThrow(NormalizationError);
    expect(() => normalizeRut("123")).toThrow(NormalizationError);
    expect(() => normalizeRut("76123456X")).toThrow(NormalizationError);
  });
});

describe("normalizeInvoiceNumber", () => {
  it("strips leading zeros", () => {
    expect(normalizeInvoiceNumber("000123")).toBe("123");
    expect(normalizeInvoiceNumber("123")).toBe("123");
  });

  it("rejects non digits and all zeros", () => {
    expect(() => normalizeInvoiceNumber("12a")).toThrow(NormalizationError);
    expect(() => normalizeInvoiceNumber("0000")).toThrow(NormalizationError);
  });
});

describe("normalizePeriod", () => {
  it("accepts the common formats and returns YYYYMM", () => {
    for (const raw of ["202610", "2026-10", "2026/10", "10-2026", "10/2026"]) {
      expect(normalizePeriod(raw)).toBe("202610");
    }
    expect(normalizePeriod("3/2026")).toBe("202603");
  });

  it("rejects invalid months", () => {
    expect(() => normalizePeriod("202613")).toThrow(NormalizationError);
    expect(() => normalizePeriod("13/2026")).toThrow(NormalizationError);
  });
});

describe("invoiceKey", () => {
  const base = { issuer_tax_id: "761234560", invoice_number: "4521", period: "202610" };

  it("is keccak256(abi.encode(rut, folio, period)) over normalized values", () => {
    const expected = keccak256(
      encodeAbiParameters(
        [{ type: "string" }, { type: "string" }, { type: "string" }],
        ["761234560", "4521", "202610"],
      ),
    );
    expect(invoiceKey(base)).toBe(expected);
  });

  it("gives the same key for the same invoice written differently", () => {
    const same = { issuer_tax_id: "76.123.456-0", invoice_number: "0004521", period: "10/2026" };
    expect(invoiceKey(same)).toBe(invoiceKey(base));
  });

  it("changes when any identifying field changes", () => {
    expect(invoiceKey({ ...base, invoice_number: "4522" })).not.toBe(invoiceKey(base));
    expect(invoiceKey({ ...base, period: "202611" })).not.toBe(invoiceKey(base));
    expect(invoiceKey({ ...base, issuer_tax_id: "123456785" })).not.toBe(invoiceKey(base));
  });

  it("does not collide when characters move between fields", () => {
    const a = invoiceKey({ ...base, invoice_number: "12", period: "202610" });
    const b = invoiceKey({ ...base, invoice_number: "1", period: "202610" });
    expect(a).not.toBe(b);
  });
});
