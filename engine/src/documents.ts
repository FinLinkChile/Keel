// Document decision (trigger 2 of the flow): do the transport document and the commercial
// invoice match the signed order and the carrier attestation? T2.2, issue #10.
// Pure function: no network, no LLM, no implicit clock. A conforming result carries the
// DocumentDecision to sign (T2.4); anything else holds the balance and notifies (D8).
import {
  CommercialInvoiceExtraction,
  type DocumentDecision,
  type Hex,
  type OrderTerms,
  type PurchaseOrder,
  type ShipmentAttestation,
  TransportDocumentExtraction,
} from "@keel/schemas";
import { blNumberHash, bytes32Text, docsHash, requiredDocsHash, structHash, termsHash } from "@keel/schemas/hash";
import { keccak256, toBytes } from "viem";

export type DocumentRule =
  | "attestation-order"
  | "document-number"
  | "on-board-date"
  | "port-of-loading"
  | "required-documents"
  | "docs-package"
  | "terms-signed"
  | "order-number"
  | "invoice-amount"
  | "importer"
  | "incoterm"
  | "goods"
  | "account-change"
  | "hidden-text";

// Reason codes, never free text: the bot turns them into templated notices.
export type DocumentReason =
  | "MATCH"
  | "ATTESTATION_OTHER_ORDER"
  | "DOCUMENT_NUMBER_MISMATCH"
  | "ON_BOARD_DATE_MISMATCH"
  | "ON_BOARD_AFTER_DEADLINE"
  | "PORT_MISMATCH"
  | "REQUIRED_DOCS_MISMATCH"
  | "DOCS_PACKAGE_MISMATCH"
  | "TERMS_MISSING"
  | "TERMS_NOT_SIGNED"
  | "ORDER_NUMBER_MISMATCH"
  | "AMOUNT_MISMATCH"
  | "IMPORTER_MISMATCH"
  | "INCOTERM_MISMATCH"
  | "GOODS_MISMATCH"
  | "ACCOUNT_CHANGE_MENTIONED"
  | "HIDDEN_TEXT";

export interface DocumentRuleResult {
  rule: DocumentRule;
  ok: boolean;
  reason: DocumentReason;
}

export interface DocumentExtractions {
  transport: TransportDocumentExtraction;
  invoice: CommercialInvoiceExtraction;
}

export interface DocumentContext {
  // Unix timestamp, seconds
  now: number;
  // keccak256 of each file the extractor read; must be the package the carrier attested
  fileHashes: readonly Hex[];
  // The order terms both parties signed through `termsHash`, or null when unavailable
  terms: OrderTerms | null;
  // RUT of the importer, from the party registry (never from a document)
  importerTaxId: string;
  // Current version of the rules (T2.4)
  policyHash: Hex;
  // How long the document decision stays valid
  decisionTtlSeconds: number;
}

export interface DocumentEvaluation {
  conforms: boolean;
  rules: DocumentRuleResult[];
  inputsHash: Hex;
  // Absent when the documents do not conform: the balance stays held
  decision?: DocumentDecision;
}

const DAY = 24 * 60 * 60;
const utcDay = (seconds: number | bigint) => Math.floor(Number(seconds) / DAY);
const result = (rule: DocumentRule, ok: boolean, failure: DocumentReason): DocumentRuleResult => ({
  rule,
  ok,
  reason: ok ? "MATCH" : failure,
});

// Keys sorted at every level and bigints as decimal strings, so the same inputs always hash the same.
function canonical(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as object)
        .sort()
        .map((k) => [k, canonical((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

// What the decision was made on: both extractions, the terms and the registry data.
export function documentInputsHash(extractions: DocumentExtractions, context: DocumentContext): Hex {
  const inputs = { ...extractions, terms: context.terms, importerTaxId: context.importerTaxId, fileHashes: context.fileHashes };
  return keccak256(toBytes(JSON.stringify(canonical(inputs))));
}

export function evaluateDocuments(
  order: PurchaseOrder,
  attestation: ShipmentAttestation,
  extractions: DocumentExtractions,
  context: DocumentContext,
): DocumentEvaluation {
  // Defense in depth: the extractions must match the schema even if ingest already checked them
  const transport = TransportDocumentExtraction.parse(extractions.transport);
  const invoice = CommercialInvoiceExtraction.parse(extractions.invoice);

  // The terms count only if they are exactly the ones both parties signed
  const termsSigned = context.terms !== null && termsHash(context.terms) === order.termsHash;
  const terms = termsSigned ? context.terms : null;
  const termsFailure: DocumentReason = context.terms === null ? "TERMS_MISSING" : "TERMS_NOT_SIGNED";
  const withTerms = (rule: DocumentRule, check: (t: OrderTerms) => boolean, failure: DocumentReason) =>
    terms ? result(rule, check(terms), failure) : { rule, ok: false, reason: termsFailure };

  const rules: DocumentRuleResult[] = [
    // Against the carrier attestation
    result("attestation-order", attestation.orderId === order.orderId, "ATTESTATION_OTHER_ORDER"),
    result("document-number", blNumberHash(transport.document_number) === attestation.blNumberHash, "DOCUMENT_NUMBER_MISMATCH"),
    // Same calendar day (UTC): a bill of lading states a date, not a second
    result("on-board-date", utcDay(transport.on_board_date) === utcDay(attestation.onBoardDate), "ON_BOARD_DATE_MISMATCH"),
    result("on-board-date", BigInt(transport.on_board_date) <= order.shipmentDeadline, "ON_BOARD_AFTER_DEADLINE"),
    result("port-of-loading", bytes32Text(transport.port_of_loading) === attestation.portOfLoading, "PORT_MISMATCH"),
    // The documents read are the ones the order requires and the ones the carrier attested
    result(
      "required-documents",
      requiredDocsHash([transport.doc_type, "COMMERCIAL_INVOICE"]) === order.requiredDocsHash,
      "REQUIRED_DOCS_MISMATCH",
    ),
    result("docs-package", context.fileHashes.length > 0 && docsHash(context.fileHashes) === attestation.docsHash, "DOCS_PACKAGE_MISMATCH"),
    // Against the signed order and its terms
    { rule: "terms-signed", ok: termsSigned, reason: termsSigned ? "MATCH" : termsFailure },
    withTerms("order-number", (t) => invoice.order_number === t.orderNumber, "ORDER_NUMBER_MISMATCH"),
    withTerms(
      "invoice-amount",
      (t) => invoice.currency === t.currency && BigInt(invoice.amount_minor) === t.invoiceAmountMinor,
      "AMOUNT_MISMATCH",
    ),
    result("importer", invoice.importer_tax_id === context.importerTaxId, "IMPORTER_MISMATCH"),
    result("incoterm", bytes32Text(invoice.incoterm) === order.incoterm, "INCOTERM_MISMATCH"),
    withTerms("goods", (t) => t.hsCodes.includes(invoice.hs_code), "GOODS_MISMATCH"),
    // Fraud signals: hold and alert. An account change never changes the payout address.
    result("account-change", !invoice.mentions_account_change, "ACCOUNT_CHANGE_MENTIONED"),
    result("hidden-text", !transport.hidden_text_detected && !invoice.hidden_text_detected, "HIDDEN_TEXT"),
  ];

  const conforms = rules.every((r) => r.ok);
  const inputsHash = documentInputsHash(extractions, context);
  if (!conforms) return { conforms, rules, inputsHash };

  const decision: DocumentDecision = {
    orderId: order.orderId,
    attestationHash: structHash("ShipmentAttestation", attestation),
    docsHash: attestation.docsHash,
    policyHash: context.policyHash,
    inputsHash,
    expiresAt: BigInt(context.now + context.decisionTtlSeconds),
  };
  return { conforms, rules, inputsHash, decision };
}
