// Carrier forms (CSAV, Hapag-Lloyd style): fine print on the back, labels at the top of each box
// and the value next to the label or under it. Built by renderCarrierForm, no carrier's file.
import { describe, expect, it } from "vitest";
import { ExtractionError, extractTransportDocument, MAX_LLM_INPUT_CHARS, type ExtractorProvider } from "../extractor";
import { splitByVisibility } from "../pdf/hidden";
import { isTermsPage, withoutTermsPages } from "../pdf/pages";
import { readTextRuns, toLines } from "../pdf/text";
import { renderCarrierForm } from "../testing/renderTrade";
import { findDate } from "./normalize";
import { parseTransportDocument, TradeParseError } from "./parser";

const FILLED = {
  number: "AOLNGB26100447",
  onBoardDate: "15 OCT 2026",
  portOfLoading: "NINGBO, CHINA",
  portOfDischarge: "SAN ANTONIO, CHILE",
};
const EXPECTED = {
  doc_type: "BILL_OF_LADING",
  document_number: "AOLNGB26100447",
  on_board_date: findDate("15 OCT 2026"),
  port_of_loading: "CNNGB",
  port_of_discharge: "CLSAI",
  hidden_text_detected: false,
};

const parseFailure = async (pdf: Uint8Array) => {
  try {
    await parseTransportDocument(pdf);
  } catch (e) {
    if (e instanceof TradeParseError) return { reason: e.reason, field: e.field };
    throw e;
  }
  throw new Error("expected TradeParseError");
};

describe("carrier forms", () => {
  it.each(["inline", "below"] as const)("reads every field with the value %s its label", async (values) => {
    const parsed = await parseTransportDocument(await renderCarrierForm({ ...FILLED, values }));
    expect(parsed.extraction).toEqual(EXPECTED);
  });

  it("does not take a label under an empty box as its value", async () => {
    const blank = await renderCarrierForm({ values: "below", referenceUnderNumber: true });
    expect(await parseFailure(blank)).toEqual({ reason: "missing_field", field: "document_number" });
  });

  it("holds a blank form instead of reading the port labels of the fine print", async () => {
    const blank = await renderCarrierForm({ values: "inline", number: FILLED.number, onBoardDate: FILLED.onBoardDate });
    expect(await parseFailure(blank)).toEqual({ reason: "invalid_field", field: "port_of_loading" });
  });

  it("tells the terms page from the form page", async () => {
    const runs = await readTextRuns(await renderCarrierForm({ ...FILLED, values: "below" }));
    const page = (n: number) => toLines(runs.filter((r) => r.page === n));
    expect(isTermsPage(page(1))).toBe(true);
    expect(isTermsPage(page(2))).toBe(false);
    expect(new Set(withoutTermsPages(runs).map((r) => r.page))).toEqual(new Set([2]));
    // A document of prose only keeps its pages
    const proseOnly = runs.filter((r) => r.page === 1);
    expect(withoutTermsPages(proseOnly)).toHaveLength(proseOnly.length);
  });

  it("sends the model the form page only, under the input limit the whole file exceeds", async () => {
    const pdf = await renderCarrierForm({ ...FILLED, values: "below" });
    expect(toLines(await readTextRuns(pdf)).join("\n").length).toBeGreaterThan(MAX_LLM_INPUT_CHARS);
    let sent = "";
    const model: ExtractorProvider = {
      provider: "anthropic",
      model: "test",
      complete: async (request) => {
        sent = request.text;
        return "{}";
      },
    };
    const failure = await extractTransportDocument(pdf, model).catch((e: unknown) => (e instanceof ExtractionError ? e.reason : e));
    expect(failure).not.toBe("input_too_large");
    expect(sent).toContain("B/L-No.:");
    expect(sent).not.toContain("TERMS AND CONDITIONS");
  });

  it("drops hidden runs with no letter or digit, and keeps reporting the rest", async () => {
    const runs = await readTextRuns(await renderCarrierForm({ ...FILLED, values: "inline" }));
    expect(splitByVisibility(runs).hidden).toEqual([]);
    const tiny = runs.map((r) => (r.text.includes("SHIPPED ON BOARD") ? { ...r, size: 2 } : r));
    expect(splitByVisibility(tiny).hidden.map((h) => h.reason)).toEqual(["tiny_font"]);
  });
});
