// Property-based tests (fast-check): rules that must hold over the whole input domain.
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { invoiceKey } from "./invoiceKey";
import { foldHomoglyphs, normalizeInvoiceNumber, normalizePeriod, normalizeRut, rutCheckDigit } from "./normalize";
import { ParseError, parseInvoiceText } from "./parser";
import { redactForLlm, rehydrate } from "./privacy";

const rutBody = fc.integer({ min: 1_000_000, max: 99_999_999 }).map(String);
const withDots = (body: string) => body.replace(/\B(?=(\d{3})+(?!\d))/g, ".");

// Every way a valid RUT is written on a document
const writtenRut = rutBody.chain((body) => {
  const dv = rutCheckDigit(body);
  return fc.record({
    body: fc.constant(body),
    dv: fc.constant(dv),
    text: fc
      .tuple(fc.boolean(), fc.constantFrom("-", " - ", ""), fc.boolean())
      .map(([dots, sep, lower]) => `${dots ? withDots(body) : body}${sep}${lower ? dv.toLowerCase() : dv}`),
  });
});

describe("normalizeRut", () => {
  it("maps every written form of a valid RUT to body + check digit", () => {
    fc.assert(fc.property(writtenRut, ({ body, dv, text }) => normalizeRut(text) === body + dv));
  });

  it("is idempotent", () => {
    fc.assert(fc.property(writtenRut, ({ text }) => normalizeRut(normalizeRut(text)) === normalizeRut(text)));
  });

  it("rejects every wrong check digit", () => {
    const wrong = rutBody.chain((body) =>
      fc.constantFrom(..."0123456789K".split("").filter((d) => d !== rutCheckDigit(body))).map((d) => `${body}-${d}`),
    );
    fc.assert(
      fc.property(wrong, (text) => {
        try {
          normalizeRut(text);
          return false;
        } catch {
          return true;
        }
      }),
    );
    expect(rutCheckDigit("1000000")).toBe("9");
  });
});

describe("invoiceKey", () => {
  const invoice = fc.record({
    rut: writtenRut,
    folio: fc.integer({ min: 1, max: 999_999_999 }),
    zeros: fc.integer({ min: 0, max: 3 }),
    year: fc.integer({ min: 2000, max: 2099 }),
    month: fc.integer({ min: 1, max: 12 }),
  });

  it("does not depend on how the same invoice is written", () => {
    fc.assert(
      fc.property(invoice, ({ rut, folio, zeros, year, month }) => {
        const mm = String(month).padStart(2, "0");
        const canonical = invoiceKey({ issuer_tax_id: rut.body + rut.dv, invoice_number: String(folio), period: `${year}${mm}` });
        const written = invoiceKey({
          issuer_tax_id: rut.text,
          invoice_number: "0".repeat(zeros) + folio,
          period: `${month}/${year}`,
        });
        return canonical === written;
      }),
    );
  });

  it("separates different invoices of the same issuer", () => {
    fc.assert(
      fc.property(invoice, fc.integer({ min: 1, max: 999_999_999 }), ({ rut, folio, year, month }, other) => {
        fc.pre(other !== folio);
        const period = `${year}${String(month).padStart(2, "0")}`;
        const a = invoiceKey({ issuer_tax_id: rut.text, invoice_number: String(folio), period });
        const b = invoiceKey({ issuer_tax_id: rut.text, invoice_number: String(other), period });
        return a !== b;
      }),
    );
  });
});

describe("normalizers", () => {
  it("normalizeInvoiceNumber and normalizePeriod are idempotent", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 999_999_999_999 }), (n) => {
        const once = normalizeInvoiceNumber(String(n));
        return normalizeInvoiceNumber(once) === once;
      }),
    );
    fc.assert(
      fc.property(fc.integer({ min: 2000, max: 2099 }), fc.integer({ min: 1, max: 12 }), (y, m) => {
        const once = normalizePeriod(`${m}/${y}`);
        return normalizePeriod(once) === once;
      }),
    );
  });

  it("foldHomoglyphs is idempotent on any text", () => {
    fc.assert(
      fc.property(fc.string({ unit: "grapheme" }), (s) => {
        const once = foldHomoglyphs(s).text;
        return foldHomoglyphs(once).text === once;
      }),
    );
  });
});

describe("privacy", () => {
  it("rehydrate(redact(text)) restores any text exactly", () => {
    fc.assert(
      fc.property(fc.string({ unit: "grapheme" }), (s) => {
        const { text, tokenMap } = redactForLlm(s);
        return rehydrate(text, tokenMap) === s;
      }),
    );
  });

  it("no RUT survives redaction, wherever it appears in the text", () => {
    fc.assert(
      fc.property(fc.string(), writtenRut.filter((r) => r.text.includes("-")), fc.string(), (before, rut, after) => {
        const { text } = redactForLlm(`${before} ${rut.text} ${after}`);
        return !text.includes(rut.text);
      }),
    );
  });
});

describe("parser robustness", () => {
  it("never fails with anything but a ParseError, whatever the text", () => {
    fc.assert(
      fc.property(fc.array(fc.string({ unit: "grapheme" }), { maxLength: 12 }), fc.array(fc.string()), (visible, hidden) => {
        try {
          parseInvoiceText({ visibleLines: visible, hiddenLines: hidden, hiddenReasons: [] }, []);
        } catch (e) {
          return e instanceof ParseError;
        }
        return true;
      }),
    );
  });
});
