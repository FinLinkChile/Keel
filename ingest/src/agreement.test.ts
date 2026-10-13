import { describe, expect, it } from "vitest";
import { ALIAS_IDS } from "@keel/schemas";
import { readInvoice } from "./agreement";
import { ExtractionError, type ExtractorProvider, type InvoiceDocument } from "./extractor";
import type { AliasTable } from "./parser";
import { renderInvoice, sampleSpec, type InvoiceSpec } from "./testing/renderInvoice";

const [ALIAS, OTHER_ALIAS] = [ALIAS_IDS[0], ALIAS_IDS[1]];
const aliases: AliasTable = [{ alias: ALIAS, rut: "761234560", emailDomain: "aduanasperez.cl" }];

// The n-th RUT token in the redacted text: 0 is the issuer, 1 the customer
const rutToken = (doc: InvoiceDocument, n = 0) => [...doc.text.matchAll(/\[RUT_[0-9a-f]{8}\]/g)][n]![0];

const honest = (doc: InvoiceDocument) => ({
  alias_id: ALIAS,
  issuer_tax_id: rutToken(doc),
  invoice_number: "4521",
  period: "202610",
  amount_clp: 45990,
  due_date: "2026-10-20",
  mentions_account_change: false,
  hidden_text_detected: false,
});

const model = (reply: (doc: InvoiceDocument) => object): ExtractorProvider => ({
  provider: "fake",
  model: "fake-1",
  complete: async (doc) => JSON.stringify(reply(doc)),
});

const read = async (llm: ExtractorProvider, spec: Partial<InvoiceSpec> = {}) =>
  readInvoice(await renderInvoice({ ...sampleSpec(), ...spec }), aliases, llm);

describe("readInvoice", () => {
  it("is ready when both readers agree", async () => {
    const result = await read(model(honest));
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.extraction.amount_clp).toBe(45990);
    expect(result.extraction.issuer_tax_id).toBe("761234560");
  });

  it("escalates to tier 3 with both values when the amount differs", async () => {
    const result = await read(model((doc) => ({ ...honest(doc), amount_clp: 4599 })));
    expect(result).toMatchObject({
      status: "escalated",
      tier: 3,
      diffs: [{ field: "amount_clp", parser: 45990, llm: 4599 }],
    });
    // The value that moves forward is the deterministic one
    if (result.status === "escalated") expect(result.extraction.amount_clp).toBe(45990);
  });

  it("catches a manipulated model that picks the customer's RUT as issuer", async () => {
    const result = await read(model((doc) => ({ ...honest(doc), issuer_tax_id: rutToken(doc, 1) })));
    expect(result).toMatchObject({
      status: "escalated",
      diffs: [{ field: "issuer_tax_id", parser: "761234560", llm: "123456785" }],
    });
  });

  it("escalates when the model's category does not match the registered alias", async () => {
    const result = await read(model((doc) => ({ ...honest(doc), alias_id: OTHER_ALIAS })));
    expect(result).toMatchObject({ status: "escalated", diffs: [{ field: "alias_id" }] });
  });

  it("keeps a warning raised by either reader", async () => {
    const result = await read(model((doc) => ({ ...honest(doc), hidden_text_detected: true })));
    expect(result.status).toBe("ready");
    if (result.status === "ready") expect(result.extraction.hidden_text_detected).toBe(true);
  });

  it("holds the invoice when the parser cannot read it", async () => {
    const result = await read(model(honest), { issuerRut: "10.000.013-K" });
    expect(result).toEqual({ status: "held", reason: "parser_failed", failure: "unknown_issuer", field: "issuer_tax_id" });
  });

  it("holds the invoice when the model fails, even if the parser succeeded", async () => {
    const refusing: ExtractorProvider = {
      provider: "fake",
      model: "fake-1",
      complete: async () => {
        throw new ExtractionError("refused");
      },
    };
    expect(await read(refusing)).toEqual({ status: "held", reason: "extractor_failed", failure: "refused" });
  });

  it("propagates errors that are not reading failures", async () => {
    const buggy: ExtractorProvider = {
      provider: "fake",
      model: "fake-1",
      complete: async () => {
        throw new TypeError("bug");
      },
    };
    await expect(read(buggy)).rejects.toThrow(TypeError);
  });
});
