import { EIP712_TYPES, type Hex, keelDomain, type OrderTerms, type PurchaseOrder, type ShipmentAttestation } from "@keel/schemas";
import { blNumberHash, bytes32Text, docsHash, requiredDocsHash, structHash, termsHash } from "@keel/schemas/hash";
import { keccak256, recoverTypedDataAddress, toBytes } from "viem";
import { describe, expect, it } from "vitest";
import { type DocumentContext, type DocumentExtractions, documentInputsHash, evaluateDocuments } from "./documents";
import { loadPolicySigner } from "./keys";
import { signDocumentDecision } from "./pdr";

const word = (label: string): Hex => keccak256(toBytes(label));
const address = (n: number): Hex => `0x${n.toString(16).padStart(40, "0")}`;
const DAY = 24 * 60 * 60;
const ON_BOARD = 1_792_886_400; // 2026-10-25 00:00 UTC
const FILES = [word("bl.pdf"), word("invoice.pdf")];

const terms: OrderTerms = {
  orderNumber: "PO20260042",
  currency: "USD",
  invoiceAmountMinor: 1_000_000n,
  hsCodes: ["130231"],
  documentHash: word("order.pdf"),
};

const order: PurchaseOrder = {
  orderId: word("PO20260042"),
  importer: address(0xa1),
  exporter: address(0xb2),
  payoutAddress: address(0xb3),
  token: address(0xc4),
  totalAmount: 10_000_000_000n,
  advanceBps: 5000,
  shipmentDeadline: BigInt(ON_BOARD + 5 * DAY),
  disputeWindow: BigInt(7 * DAY),
  carrier: address(0xd5),
  arbiter: address(0xe6),
  documentVerifier: address(0xe7),
  incoterm: bytes32Text("CIF"),
  termsHash: termsHash(terms),
  requiredDocsHash: requiredDocsHash(["BILL_OF_LADING", "COMMERCIAL_INVOICE"]),
  nonce: 7n,
};

const attestation: ShipmentAttestation = {
  orderId: order.orderId,
  blNumberHash: blNumberHash("EGLV123456789"),
  onBoardDate: BigInt(ON_BOARD),
  portOfLoading: bytes32Text("CNSZX"),
  docsHash: docsHash(FILES),
};

const extractions: DocumentExtractions = {
  transport: {
    doc_type: "BILL_OF_LADING",
    document_number: "EGLV123456789",
    on_board_date: ON_BOARD + 15 * 60 * 60, // same day, later hour
    port_of_loading: "CNSZX",
    port_of_discharge: "CLVAP",
    hidden_text_detected: false,
  },
  invoice: {
    invoice_number: "INV20261001",
    order_number: "PO20260042",
    amount_minor: 1_000_000,
    currency: "USD",
    incoterm: "CIF",
    importer_tax_id: "76123456K",
    hs_code: "130231",
    mentions_account_change: false,
    hidden_text_detected: false,
  },
};

const context: DocumentContext = {
  now: ON_BOARD + 2 * DAY,
  fileHashes: FILES,
  terms,
  importerTaxId: "76123456K",
  policyHash: word("rules-v1"),
  decisionTtlSeconds: 3600,
};

const transport = (over: Partial<DocumentExtractions["transport"]>) => ({ ...extractions, transport: { ...extractions.transport, ...over } });
const invoice = (over: Partial<DocumentExtractions["invoice"]>) => ({ ...extractions, invoice: { ...extractions.invoice, ...over } });
const failures = (e: ReturnType<typeof evaluateDocuments>) => e.rules.filter((r) => !r.ok).map((r) => `${r.rule}:${r.reason}`);

describe("evaluateDocuments (trigger 2)", () => {
  it("conforming documents produce the DocumentDecision to sign", () => {
    const result = evaluateDocuments(order, attestation, extractions, context);
    expect(failures(result)).toEqual([]);
    expect(result.conforms).toBe(true);
    expect(result.decision).toEqual({
      orderId: order.orderId,
      attestationHash: structHash("ShipmentAttestation", attestation),
      docsHash: attestation.docsHash,
      policyHash: context.policyHash,
      inputsHash: result.inputsHash,
      expiresAt: BigInt(context.now + 3600),
    });
  });

  // Each case breaks exactly one thing and must fail exactly one rule
  it.each<[string, PurchaseOrder, ShipmentAttestation, DocumentExtractions, DocumentContext, string]>([
    ["an attestation for another order", order, { ...attestation, orderId: word("other") }, extractions, context, "attestation-order:ATTESTATION_OTHER_ORDER"],
    ["a different BL number", order, attestation, transport({ document_number: "EGLV999999999" }), context, "document-number:DOCUMENT_NUMBER_MISMATCH"],
    ["an on board date on another day", order, attestation, transport({ on_board_date: ON_BOARD - DAY }), context, "on-board-date:ON_BOARD_DATE_MISMATCH"],
    ["a different port of loading", order, attestation, transport({ port_of_loading: "CNSHA" }), context, "port-of-loading:PORT_MISMATCH"],
    ["an air waybill when the order requires a bill of lading", order, attestation, transport({ doc_type: "AIR_WAYBILL" }), context, "required-documents:REQUIRED_DOCS_MISMATCH"],
    ["files other than the ones the carrier attested", order, attestation, extractions, { ...context, fileHashes: [FILES[0]!, word("forged.pdf")] }, "docs-package:DOCS_PACKAGE_MISMATCH"],
    ["another purchase order number", order, attestation, invoice({ order_number: "PO20260043" }), context, "order-number:ORDER_NUMBER_MISMATCH"],
    ["another invoice amount", order, attestation, invoice({ amount_minor: 1_200_000 }), context, "invoice-amount:AMOUNT_MISMATCH"],
    ["the same amount in another currency", order, attestation, invoice({ currency: "CNY" }), context, "invoice-amount:AMOUNT_MISMATCH"],
    ["another importer", order, attestation, invoice({ importer_tax_id: "771234560" }), context, "importer:IMPORTER_MISMATCH"],
    ["another incoterm", order, attestation, invoice({ incoterm: "FOB" }), context, "incoterm:INCOTERM_MISMATCH"],
    ["other goods", order, attestation, invoice({ hs_code: "080810" }), context, "goods:GOODS_MISMATCH"],
    ["an invoice that mentions an account change", order, attestation, invoice({ mentions_account_change: true }), context, "account-change:ACCOUNT_CHANGE_MENTIONED"],
    ["hidden text in the bill of lading", order, attestation, transport({ hidden_text_detected: true }), context, "hidden-text:HIDDEN_TEXT"],
    ["hidden text in the invoice", order, attestation, invoice({ hidden_text_detected: true }), context, "hidden-text:HIDDEN_TEXT"],
  ])("holds the balance for %s", (_case, o, att, ex, ctx, expected) => {
    const result = evaluateDocuments(o, att, ex, ctx);
    expect(failures(result)).toEqual([expected]);
    expect(result.conforms).toBe(false);
    expect(result.decision).toBeUndefined();
  });

  it("holds a shipment loaded after the deadline, even if the carrier attested that date", () => {
    const late = ON_BOARD + 6 * DAY;
    const result = evaluateDocuments(order, { ...attestation, onBoardDate: BigInt(late) }, transport({ on_board_date: late }), context);
    expect(failures(result)).toEqual(["on-board-date:ON_BOARD_AFTER_DEADLINE"]);
  });

  it("fails closed without the signed terms: every rule that needs them fails", () => {
    const result = evaluateDocuments(order, attestation, extractions, { ...context, terms: null });
    expect(failures(result)).toEqual([
      "terms-signed:TERMS_MISSING",
      "order-number:TERMS_MISSING",
      "invoice-amount:TERMS_MISSING",
      "goods:TERMS_MISSING",
    ]);
    expect(result.decision).toBeUndefined();
  });

  it("ignores terms that are not the ones both parties signed, even if the invoice matches them", () => {
    const forged = { ...terms, invoiceAmountMinor: 1_200_000n };
    const result = evaluateDocuments(order, attestation, invoice({ amount_minor: 1_200_000 }), { ...context, terms: forged });
    expect(failures(result)).toEqual([
      "terms-signed:TERMS_NOT_SIGNED",
      "order-number:TERMS_NOT_SIGNED",
      "invoice-amount:TERMS_NOT_SIGNED",
      "goods:TERMS_NOT_SIGNED",
    ]);
  });

  it("rejects an extraction outside the schema instead of evaluating it", () => {
    const injected = { ...extractions, invoice: { ...extractions.invoice, payout_address: address(0x666) } };
    expect(() => evaluateDocuments(order, attestation, injected as never, context)).toThrow();
  });

  it("the inputs hash is stable and changes with any extracted field", () => {
    const reordered = { invoice: extractions.invoice, transport: extractions.transport };
    expect(documentInputsHash(reordered, context)).toBe(documentInputsHash(extractions, context));
    expect(documentInputsHash(invoice({ invoice_number: "INV20261002" }), context)).not.toBe(documentInputsHash(extractions, context));
  });

  it("only the document verifier of the order signs the DocumentDecision", async () => {
    const decision = evaluateDocuments(order, attestation, extractions, context).decision!;
    const signer = loadPolicySigner({ POLICY_SIGNER_PRIVATE_KEY: word("policy") });
    const domain = keelDomain(1, address(0xe5c));
    await expect(signDocumentDecision(decision, domain, signer, order.documentVerifier)).rejects.toThrow("not the document verifier");
    const signed = await signDocumentDecision(decision, domain, signer, signer.address);
    const recovered = await recoverTypedDataAddress({
      domain,
      types: { DocumentDecision: EIP712_TYPES.DocumentDecision },
      primaryType: "DocumentDecision",
      message: decision,
      signature: signed.signature,
    });
    expect(recovered).toBe(signer.address);
  });
});
