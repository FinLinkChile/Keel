import { describe, expect, it } from "vitest";
import { blNumberHash } from "@keel/schemas/hash";
import { NormalizationError } from "../normalize";
import { IngestStore, MAX_DOCUMENTS_PER_ORDER_PER_DAY } from "../store";
import { renderCommercialInvoice, renderTransport } from "../testing/renderTrade";
import { LEGIT_SETS, testAccount } from "../testing/tradeCorpus";
import { CORPUS_CHAIN_ID, corpusOrders, honestModel, upload } from "../testing/tradeCorpusRunner";
import { ExtractionError } from "../extractor";
import { toCommercialInvoiceExtraction, toTransportExtraction } from "../extractor/trade";
import { detectAccountAlert } from "./accountAlert";
import { readTransportDocument } from "./agreement";
import { amountToMinor, findDate, normalizeDocumentNumber, resolvePlace } from "./normalize";
import { parseCommercialInvoice, parseTransportDocument, TradeParseError } from "./parser";
import { authorizeUpload, fileHash, uploadDomain, UPLOAD_TYPES } from "./upload";

const [O1, O2] = LEGIT_SETS as [(typeof LEGIT_SETS)[0], (typeof LEGIT_SETS)[0]];

const parseFailure = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
  } catch (e) {
    if (e instanceof TradeParseError) return { reason: e.reason, field: e.field };
    throw e;
  }
  throw new Error("expected TradeParseError");
};

const extractionFailure = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    if (e instanceof ExtractionError) return e.reason;
    throw e;
  }
  return "no error";
};

describe("trade normalization", () => {
  it("reads amounts in minor units without floats, and refuses a comma as decimal mark", () => {
    expect(amountToMinor("25,000.00")).toBe(2_500_000);
    expect(amountToMinor("25000.5")).toBe(2_500_050);
    expect(amountToMinor("19900")).toBe(1_990_000);
    for (const bad of ["25.000,00", "1,00", "-5", "0", "12.345"]) expect(() => amountToMinor(bad)).toThrow(NormalizationError);
  });

  it("compacts the document number the same way for both readers", () => {
    expect(normalizeDocumentNumber("olsu-2610 4471")).toBe("OLSU26104471");
    expect(normalizeDocumentNumber("176-1234 5675")).toBe("17612345675");
    expect(() => normalizeDocumentNumber("AB-1")).toThrow(NormalizationError);
  });

  it("reads only unambiguous dates, and rejects impossible ones", () => {
    const oct12 = Date.UTC(2026, 9, 12) / 1000;
    expect(findDate("12-OCT-2026")).toBe(oct12);
    expect(findDate("OCT 12, 2026")).toBe(oct12);
    expect(findDate("OCT.12,2026")).toBe(oct12);
    expect(findDate("2026-10-12")).toBe(oct12);
    expect(findDate("12 OCTOBER 2026")).toBe(oct12);
    expect(findDate("10/12/2026")).toBeUndefined();
    expect(() => findDate("31-SEP-2026")).toThrow(NormalizationError);
  });

  it("resolves corridor ports to their UN/LOCODE, preferring a printed code and longer names", () => {
    expect(resolvePlace("NINGBO, CHINA")).toBe("CNNGB");
    expect(resolvePlace("SHANGHAI PUDONG (PVG)")).toBe("CNPVG");
    expect(resolvePlace("SHANGHAI, CHINA")).toBe("CNSHA");
    expect(resolvePlace("PORT OF SHANGHAI (CNSHA)")).toBe("CNSHA");
    expect(resolvePlace("SAN ANTONIO, CHILE")).toBe("CLSAI");
    expect(resolvePlace("LOS ANGELES, USA")).toBeUndefined();
  });
});

describe("trade parser", () => {
  it("reads the three transport layouts and the commercial invoice of the corpus", async () => {
    for (const set of LEGIT_SETS.slice(0, 5)) {
      expect((await parseTransportDocument(await renderTransport(set.transport))).extraction).toEqual(set.truth.transport);
      expect((await parseCommercialInvoice(await renderCommercialInvoice(set.invoice))).extraction).toEqual(set.truth.invoice);
    }
  });

  it("keeps the registered bank account as a destination, for the alert to compare", async () => {
    const parsed = await parseCommercialInvoice(await renderCommercialInvoice(O1.invoice));
    expect(parsed.destinations).toEqual(O1.order.entry.knownDestinations);
  });

  it("holds a place outside the corridor table rather than guessing its code", async () => {
    const pdf = await renderTransport({ ...O1.transport, portOfLoading: "LOS ANGELES, USA" });
    expect(await parseFailure(() => parseTransportDocument(pdf))).toEqual({ reason: "invalid_field", field: "port_of_loading" });
  });

  it("does not read an item quantity or package count as the total", async () => {
    const pdf = await renderCommercialInvoice({ ...O1.invoice, notes: ["TOTAL PACKAGES: 20", "TOTAL QUANTITY 500"] });
    expect((await parseCommercialInvoice(pdf)).extraction.amount_minor).toBe(O1.truth.invoice.amount_minor);
  });

  it("holds a document without a title it knows", async () => {
    const pdf = await renderTransport({ ...O1.transport, title: "PACKING LIST" });
    expect(await parseFailure(() => parseTransportDocument(pdf))).toMatchObject({ reason: "unknown_document_type" });
  });
});

describe("trade extractor contract", () => {
  const transportOut = {
    doc_type: "BILL_OF_LADING",
    document_number: "olsu-2610-4471",
    on_board_date: "2026-10-12",
    port_of_loading: "cnngb",
    port_of_discharge: "CLSAI",
    hidden_text_detected: false,
  };
  const invoiceOut = {
    invoice_number: "NB-2026-0915",
    order_number: "PO-4410",
    total_amount: "20000.00",
    currency: "USD",
    incoterm: "FOB",
    importer_tax_id: "76.543.210-3",
    hs_code: "8467.21",
    mentions_account_change: false,
    hidden_text_detected: false,
  };

  it("normalizes the model output into the shared schemas", () => {
    expect(toTransportExtraction(JSON.stringify(transportOut))).toEqual(O1.truth.transport);
    expect(toCommercialInvoiceExtraction(JSON.stringify(invoiceOut))).toEqual(O1.truth.invoice);
  });

  it("folds look-alike characters the model copies as printed, like the parser does", () => {
    expect(toTransportExtraction(JSON.stringify({ ...transportOut, document_number: "OLSU-26¹0-4471" })).document_number).toBe("OLSU26104471");
    expect(toCommercialInvoiceExtraction(JSON.stringify({ ...invoiceOut, importer_tax_id: "76.54³.210-3" })).importer_tax_id).toBe("765432103");
  });

  it("rejects a destination address or any field outside the schema", () => {
    const withPayee = { ...invoiceOut, beneficiary_account: "DE89370400440532013000" };
    expect(extractionFailure(() => toCommercialInvoiceExtraction(JSON.stringify(withPayee)))).toBe("invalid_output");
  });

  it("rejects bad formats: a port that is not a UN/LOCODE, a European amount, a wrong RUT check digit", () => {
    for (const raw of [
      JSON.stringify({ ...transportOut, port_of_loading: "NINGBO" }),
      JSON.stringify({ ...invoiceOut, total_amount: "20.000,00" }),
      JSON.stringify({ ...invoiceOut, importer_tax_id: "76.543.210-K" }),
      JSON.stringify({ ...invoiceOut, incoterm: "DDP" }),
    ]) {
      const fn = raw.includes("doc_type") ? toTransportExtraction : toCommercialInvoiceExtraction;
      expect(extractionFailure(() => fn(raw))).toBe("invalid_output");
    }
  });
});

describe("two-source agreement", () => {
  it("holds the document with both values when the model disagrees, and keeps the parser's", async () => {
    const pdf = await renderTransport(O1.transport);
    const bent = honestModel({ ...O1.truth.transport, on_board_date: O1.truth.transport.on_board_date - 86_400 });
    const reading = await readTransportDocument(pdf, bent, { carrier: O1.order.entry.carrier });
    expect(reading).toMatchObject({
      status: "held",
      reason: "disagreement",
      diffs: [{ field: "on_board_date", parser: O1.truth.transport.on_board_date, llm: O1.truth.transport.on_board_date - 86_400 }],
    });
    if ("extraction" in reading) expect(reading.extraction.on_board_date).toBe(O1.truth.transport.on_board_date);
  });

  it("computes blNumberHash from the order's carrier and the normalized document number (T3.7)", async () => {
    const reading = await readTransportDocument(await renderTransport(O1.transport), honestModel(O1.truth.transport), {
      carrier: O1.order.entry.carrier,
    });
    expect(reading).toMatchObject({ status: "ready", blNumberHash: blNumberHash(O1.order.entry.carrier, "OLSU26104471") });
  });

  it("checks a reused bill of lading before calling the model", async () => {
    let calls = 0;
    const counting = { ...honestModel(O1.truth.transport), complete: async () => (calls++, "{}") };
    const reading = await readTransportDocument(await renderTransport(O1.transport), counting, {
      carrier: O1.order.entry.carrier,
      beforeModel: () => "bl_used_by_other_order",
    });
    expect(reading).toMatchObject({ status: "held", reason: "bl_used_by_other_order" });
    expect(calls).toBe(0);
  });
});

describe("account alert (T3.6)", () => {
  const allowed = O1.order.entry;

  it("does not alert on the payout address or a registered account", () => {
    expect(detectAccountAlert(false, [{ kind: "evm_address", value: allowed.payoutAddress }, ...allowed.knownDestinations!], allowed)).toBeNull();
  });

  it("alerts, without proposing any change, on an announcement or an unknown destination", () => {
    const other = { kind: "bank_account" as const, value: "DE89370400440532013000" };
    expect(detectAccountAlert(true, [other], allowed)).toEqual({ triggers: ["announced_in_document", "unknown_destination"], found: [other] });
  });
});

describe("authenticated upload (T3.1)", () => {
  const now = new Date("2026-10-15T12:00:00Z");
  const signed = async (bytes: Uint8Array, signer = testAccount(`${O1.id}:exporter`), docType = "COMMERCIAL_INVOICE") => {
    const issuedAt = Math.floor(now.getTime() / 1000);
    const signature = await signer.signTypedData({
      domain: uploadDomain(CORPUS_CHAIN_ID),
      types: UPLOAD_TYPES,
      primaryType: "DocumentUpload",
      message: { orderId: O1.order.orderId, docType: docType as "COMMERCIAL_INVOICE", fileHash: fileHash(bytes), issuedAt: BigInt(issuedAt) },
    });
    return { orderId: O1.order.orderId, docType, issuedAt, signature, file: bytes };
  };

  it("recovers the representative and their party", async () => {
    const bytes = await renderCommercialInvoice(O1.invoice);
    const importer = testAccount(`${O1.id}:importer`);
    expect(await authorizeUpload(await signed(bytes, importer), corpusOrders, CORPUS_CHAIN_ID, now)).toMatchObject({
      status: "authorized",
      party: "importer",
      fileHash: fileHash(bytes),
    });
  });

  it("rejects an unknown order, an unknown document type, a signature for another chain and garbage", async () => {
    const bytes = await renderCommercialInvoice(O1.invoice);
    const good = await signed(bytes);
    const auth = (req: typeof good, chainId = CORPUS_CHAIN_ID) => authorizeUpload(req, corpusOrders, chainId, now);
    expect(await auth({ ...good, orderId: `0x${"ab".repeat(32)}` })).toEqual({ status: "rejected", reason: "unknown_order" });
    expect(await auth({ ...good, docType: "PACKING_LIST" })).toEqual({ status: "rejected", reason: "unknown_doc_type" });
    expect(await auth(good, 1)).toEqual({ status: "rejected", reason: "not_a_party" });
    expect(await auth({ ...good, signature: `0x${"00".repeat(65)}` })).toEqual({ status: "rejected", reason: "bad_signature" });
  });

  it("does not let a party of one order upload to another", async () => {
    const bytes = await renderCommercialInvoice(O1.invoice);
    const otherOrdersExporter = testAccount(`${O2.id}:exporter`);
    expect(await authorizeUpload(await signed(bytes, otherOrdersExporter), corpusOrders, CORPUS_CHAIN_ID, now)).toEqual({
      status: "rejected",
      reason: "not_a_party",
    });
  });
});

describe("flood protection and the package (T3.2, T3.7)", () => {
  it(`quarantines the upload after ${MAX_DOCUMENTS_PER_ORDER_PER_DAY} in a day, before reading it`, async () => {
    const store = new IngestStore(":memory:");
    let calls = 0;
    const model = { ...honestModel(O1.truth.invoice), complete: async () => (calls++, "{}") };
    for (let i = 0; i < MAX_DOCUMENTS_PER_ORDER_PER_DAY; i++) {
      await upload(store, model, O1, "COMMERCIAL_INVOICE", await renderCommercialInvoice({ ...O1.invoice, seed: `s${i}` }));
    }
    const before = calls;
    const outcome = await upload(store, model, O1, "COMMERCIAL_INVOICE", await renderCommercialInvoice({ ...O1.invoice, seed: "last" }));
    expect(outcome).toMatchObject({ status: "quarantined", reason: "rate_limited" });
    expect(calls).toBe(before);
  });

  it("treats a B/L number as unique per carrier, like the contract", async () => {
    const O3 = LEGIT_SETS[2]!;
    expect(O3.order.entry.carrier).not.toBe(O1.order.entry.carrier);
    const store = new IngestStore(":memory:");
    const bl = await renderTransport(O1.transport);
    await upload(store, honestModel(O1.truth.transport), O1, "BILL_OF_LADING", bl);
    // Same number, another carrier: not the B/L already used, so it is read (and the engine
    // will find it does not match O3's attestation)
    const outcome = await upload(store, honestModel(O1.truth.transport), O3, "BILL_OF_LADING", bl);
    expect(outcome).toMatchObject({ status: "ready", blNumberHash: blNumberHash(O3.order.entry.carrier, "OLSU26104471") });
  });

  it("reports the same file again as a duplicate", async () => {
    const store = new IngestStore(":memory:");
    const bytes = await renderCommercialInvoice(O1.invoice);
    await upload(store, honestModel(O1.truth.invoice), O1, "COMMERCIAL_INVOICE", bytes);
    expect(await upload(store, honestModel(O1.truth.invoice), O1, "COMMERCIAL_INVOICE", bytes)).toMatchObject({
      status: "duplicate",
      reason: "same_file",
    });
  });

  it("leaves the package incomplete until every required document is accepted, and ambiguous with two invoices", async () => {
    const store = new IngestStore(":memory:");
    const model = honestModel(O1.truth.invoice);
    await upload(store, model, O1, "COMMERCIAL_INVOICE", await renderCommercialInvoice(O1.invoice));
    expect(await store.tradePackage(O1.order.orderId, O1.order.requiredDocs)).toEqual({ status: "incomplete", missing: ["BILL_OF_LADING"] });
    await upload(store, honestModel(O1.truth.transport), O1, "BILL_OF_LADING", await renderTransport(O1.transport));
    expect(await store.tradePackage(O1.order.orderId, O1.order.requiredDocs)).toMatchObject({
      status: "complete",
      blNumberHash: blNumberHash(O1.order.entry.carrier, "OLSU26104471"),
    });
    await upload(store, model, O1, "COMMERCIAL_INVOICE", await renderCommercialInvoice({ ...O1.invoice, seed: "v2" }));
    expect(await store.tradePackage(O1.order.orderId, O1.order.requiredDocs)).toEqual({ status: "ambiguous", docType: "COMMERCIAL_INVOICE" });
  });

  it("groups alerts into one digest", async () => {
    const store = new IngestStore(":memory:");
    const since = new Date(0);
    const announcing = { ...O1.invoice, notes: ["Please note our new bank account details."] };
    await upload(store, honestModel({ ...O1.truth.invoice, mentions_account_change: true }), O1, "COMMERCIAL_INVOICE", await renderCommercialInvoice(announcing));
    expect(await store.alertDigest(since)).toMatchObject([
      { orderId: O1.order.orderId, triggers: ["announced_in_document"], reminder: "payout_changes_only_with_new_signed_order" },
    ]);
  });
});
