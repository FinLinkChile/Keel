// Test data: one Keel Trade order whose documents conform, with everything around it.
import type { Hex, OrderTerms, PurchaseOrder, ShipmentAttestation } from "@keel/schemas";
import { blNumberHash, bytes32Text, docsHash, requiredDocsHash, structHash, termsHash } from "@keel/schemas/hash";
import { keccak256, toBytes } from "viem";
import type { DocumentContext, DocumentExtractions } from "../documents";
import type { FundingContext } from "../funding";

export const word = (label: string): Hex => keccak256(toBytes(label));
export const address = (n: number): Hex => `0x${n.toString(16).padStart(40, "0")}`;

const DAY = 24 * 60 * 60;
export const ON_BOARD = 1_792_886_400; // 2026-10-25 00:00 UTC
const FILES = [word("bl.pdf"), word("invoice.pdf")];

export const terms: OrderTerms = {
  orderNumber: "PO20260042",
  currency: "USD",
  invoiceAmountMinor: 1_000_000n,
  hsCodes: ["130231"],
  documentHash: word("order.pdf"),
};

export const order: PurchaseOrder = {
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

export const attestation: ShipmentAttestation = {
  orderId: order.orderId,
  blNumberHash: blNumberHash(order.carrier, "EGLV123456789"),
  onBoardDate: BigInt(ON_BOARD),
  portOfLoading: bytes32Text("CNSZX"),
  docsHash: docsHash(FILES),
};

export const extractions: DocumentExtractions = {
  transport: {
    doc_type: "BILL_OF_LADING",
    document_number: "EGLV123456789",
    on_board_date: ON_BOARD + 15 * 60 * 60,
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

export const documentContext: Omit<DocumentContext, "policyHash"> = {
  now: ON_BOARD + 2 * DAY,
  fileHashes: FILES,
  terms,
  importerTaxId: "76123456K",
  decisionTtlSeconds: 3600,
};

// Funding happens before the shipment: a deadline 30 days ahead of `now`
export const FUNDING_NOW = ON_BOARD - 30 * DAY;

export const fundingContext: FundingContext = {
  now: FUNDING_NOW,
  safe: order.importer,
  escrow: address(0xf7),
  escrowOrder: { state: "OPEN", orderHash: structHash("PurchaseOrder", order) },
  registeredParties: [order.importer, order.exporter, order.carrier, order.arbiter, order.documentVerifier],
  knownSuppliers: [{ exporter: order.exporter, payoutAddress: order.payoutAddress }],
  allowance: { token: order.token, remaining: 50_000_000_000n },
  history: [9_000_000_000n, 11_000_000_000n],
  nonce: 1n,
};
