// Shared interfaces of Keel. Owned by Area 2.
// PROPOSAL until the interface freeze (Wednesday Oct 14, 20:00 CLT). After the freeze,
// any change here must be announced to all five areas.
// Source: docs/interfaces/ and docs/flujo/datos-firmados-e-interfaz.md.
import { z } from "zod";

export * from "./personal";

// ---------------------------------------------------------------------------
// 2.1 Document extraction (output of the quarantined extractor)
// ---------------------------------------------------------------------------

// No free text: enums, numbers and regex-validated fields only (D3).
// There are no names, descriptions, notes, bank details or destination addresses on
// purpose. What people see (supplier name, payout address) comes from the signed order
// and the party registry, never from a document (D12).

export const TRANSPORT_DOC_TYPES = ["BILL_OF_LADING", "AIR_WAYBILL"] as const;
export type TransportDocType = (typeof TRANSPORT_DOC_TYPES)[number];

export const CURRENCIES = ["USD", "EUR", "CNY", "HKD"] as const;
export type Currency = (typeof CURRENCIES)[number];

export const INCOTERMS = ["EXW", "FOB", "CIF", "CFR"] as const;
export type Incoterm = (typeof INCOTERMS)[number];

// UN/LOCODE: two letters of the country and three characters of the place
const unLocode = z.string().regex(/^[A-Z]{2}[A-Z0-9]{3}$/);
const unixSeconds = z.number().int().positive();

export const TransportDocumentExtraction = z
  .object({
    doc_type: z.enum(TRANSPORT_DOC_TYPES),
    // Bill of lading or air waybill number, uppercase, no separators
    document_number: z.string().regex(/^[A-Z0-9]{6,20}$/),
    // Unix timestamp, seconds
    on_board_date: unixSeconds,
    port_of_loading: unLocode,
    port_of_discharge: unLocode,
    hidden_text_detected: z.boolean(),
  })
  .strict()
  .meta({
    title: "TransportDocumentExtraction",
    description:
      "Bill of lading or air waybill read by the quarantined extractor. No free text: enums, numbers and regex-validated fields only.",
  });
export type TransportDocumentExtraction = z.infer<typeof TransportDocumentExtraction>;

export const CommercialInvoiceExtraction = z
  .object({
    invoice_number: z.string().regex(/^[A-Z0-9]{1,20}$/),
    order_number: z.string().regex(/^[A-Z0-9]{1,20}$/),
    // In the minor unit of `currency`
    amount_minor: z.number().int().positive(),
    currency: z.enum(CURRENCIES),
    incoterm: z.enum(INCOTERMS),
    // Normalized RUT: no dots, no hyphen
    importer_tax_id: z.string().regex(/^[0-9]{7,8}[0-9K]$/),
    // Harmonized System code
    hs_code: z.string().regex(/^[0-9]{6,10}$/),
    mentions_account_change: z.boolean(),
    hidden_text_detected: z.boolean(),
  })
  .strict()
  .meta({
    title: "CommercialInvoiceExtraction",
    description:
      "Commercial invoice read by the quarantined extractor. No free text: enums, numbers and regex-validated fields only.",
  });
export type CommercialInvoiceExtraction = z.infer<typeof CommercialInvoiceExtraction>;

// Documents an order can require. `requiredDocsHash` is computed over these names.
export const REQUIRED_DOC_TYPES = [...TRANSPORT_DOC_TYPES, "COMMERCIAL_INVOICE"] as const;
export type RequiredDocType = (typeof REQUIRED_DOC_TYPES)[number];

// ---------------------------------------------------------------------------
// 2.2 Purchase order and shipment attestation (mirror contracts/src/KeelTypes.sol)
// ---------------------------------------------------------------------------

export type Hex = `0x${string}`;

// Signed by importer and exporter over the same EIP-712 digest.
export interface PurchaseOrder {
  orderId: Hex;
  importer: Hex;
  exporter: Hex;
  // Where the exporter is paid. Fixed here, signed by both, never taken from a document.
  payoutAddress: Hex;
  token: Hex;
  // In the minor unit of the token
  totalAmount: bigint;
  // 5000 = 50%
  advanceBps: number;
  // Unix timestamp, seconds. Compared with the on board date.
  shipmentDeadline: bigint;
  // Seconds after the shipment
  disputeWindow: bigint;
  // Who can sign the shipment attestation
  carrier: Hex;
  arbiter: Hex;
  // bytes32 text, see `bytes32Text` in ./hash.ts
  incoterm: Hex;
  // Hash of the full order document, with the proforma
  termsHash: Hex;
  // See `requiredDocsHash` in ./hash.ts
  requiredDocsHash: Hex;
  nonce: bigint;
}

// Decided by Area 2 (Oct 14): the terms behind `termsHash`. `termsHash` is the EIP-712 hash of
// these terms (see `termsHash` in ./hash.ts), so both parties sign them through the
// order. They are what the engine compares the commercial invoice against at trigger 2.
export const OrderTerms = z
  .object({
    // Same format as `order_number` in the invoice extraction
    orderNumber: z.string().regex(/^[A-Z0-9]{1,20}$/),
    currency: z.enum(CURRENCIES),
    // Amount of the commercial invoice, in the minor unit of `currency`
    invoiceAmountMinor: z.bigint().positive(),
    // Harmonized System codes of the goods
    hsCodes: z.array(z.string().regex(/^[0-9]{6,10}$/)).min(1),
    // keccak256 of the full order document, with the proforma
    documentHash: z.string().regex(/^0x[0-9a-f]{64}$/),
  })
  .strict();
export type OrderTerms = z.infer<typeof OrderTerms>;

export const TERMS_EIP712_TYPES = {
  OrderTerms: [
    { name: "orderNumber", type: "string" },
    { name: "currency", type: "string" },
    { name: "invoiceAmountMinor", type: "uint256" },
    { name: "hsCodes", type: "string[]" },
    { name: "documentHash", type: "bytes32" },
  ],
} as const;

// Signed by the carrier fixed in the order.
export interface ShipmentAttestation {
  orderId: Hex;
  // See `blNumberHash` in ./hash.ts
  blNumberHash: Hex;
  // Unix timestamp, seconds
  onBoardDate: bigint;
  // UN/LOCODE as bytes32 text
  portOfLoading: Hex;
  // See `docsHash` in ./hash.ts
  docsHash: Hex;
}

// Signed by importer and exporter to cancel by mutual agreement.
export interface CancelOrder {
  orderId: Hex;
  nonce: bigint;
}

// Signed by the arbiter. The escrow only pays `importer` and `payoutAddress`, and the
// two amounts must add up to exactly the remaining balance.
// Not in docs/flujo/datos-firmados-e-interfaz.md yet: to be confirmed at the freeze.
export interface DisputeResolution {
  orderId: Hex;
  toImporter: bigint;
  toExporter: bigint;
}

// ---------------------------------------------------------------------------
// 2.3 Funding intent and decisions (the PDR of Keel)
// ---------------------------------------------------------------------------

export interface FundIntent {
  orderId: Hex;
  // The TradeEscrow contract
  escrow: Hex;
  token: Hex;
  // Equal to the totalAmount of the order
  amount: bigint;
  deadline: bigint;
  nonce: bigint;
}

export interface PolicyDecision {
  // EIP-712 hash of FundIntent
  intentHash: Hex;
  // keccak256 of the exact calldata the Safe executes
  calldataHash: Hex;
  // Current version of the rules
  policyHash: Hex;
  // Order, supplier registry, allowance used
  inputsHash: Hex;
  // 1 or 3 (tiers 0, 2 and 4 never reach the gate)
  tier: 1 | 3;
  expiresAt: bigint;
}

export interface DocumentDecision {
  orderId: Hex;
  // EIP-712 hash of ShipmentAttestation
  attestationHash: Hex;
  // Hash of the document package that was read
  docsHash: Hex;
  policyHash: Hex;
  // Extractions of the transport document and the invoice
  inputsHash: Hex;
  expiresAt: bigint;
}

export const EIP712_TYPES = {
  PurchaseOrder: [
    { name: "orderId", type: "bytes32" },
    { name: "importer", type: "address" },
    { name: "exporter", type: "address" },
    { name: "payoutAddress", type: "address" },
    { name: "token", type: "address" },
    { name: "totalAmount", type: "uint256" },
    { name: "advanceBps", type: "uint16" },
    { name: "shipmentDeadline", type: "uint64" },
    { name: "disputeWindow", type: "uint64" },
    { name: "carrier", type: "address" },
    { name: "arbiter", type: "address" },
    { name: "incoterm", type: "bytes32" },
    { name: "termsHash", type: "bytes32" },
    { name: "requiredDocsHash", type: "bytes32" },
    { name: "nonce", type: "uint256" },
  ],
  ShipmentAttestation: [
    { name: "orderId", type: "bytes32" },
    { name: "blNumberHash", type: "bytes32" },
    { name: "onBoardDate", type: "uint64" },
    { name: "portOfLoading", type: "bytes32" },
    { name: "docsHash", type: "bytes32" },
  ],
  CancelOrder: [
    { name: "orderId", type: "bytes32" },
    { name: "nonce", type: "uint256" },
  ],
  DisputeResolution: [
    { name: "orderId", type: "bytes32" },
    { name: "toImporter", type: "uint256" },
    { name: "toExporter", type: "uint256" },
  ],
  FundIntent: [
    { name: "orderId", type: "bytes32" },
    { name: "escrow", type: "address" },
    { name: "token", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "deadline", type: "uint64" },
    { name: "nonce", type: "uint256" },
  ],
  PolicyDecision: [
    { name: "intentHash", type: "bytes32" },
    { name: "calldataHash", type: "bytes32" },
    { name: "policyHash", type: "bytes32" },
    { name: "inputsHash", type: "bytes32" },
    { name: "tier", type: "uint8" },
    { name: "expiresAt", type: "uint64" },
  ],
  DocumentDecision: [
    { name: "orderId", type: "bytes32" },
    { name: "attestationHash", type: "bytes32" },
    { name: "docsHash", type: "bytes32" },
    { name: "policyHash", type: "bytes32" },
    { name: "inputsHash", type: "bytes32" },
    { name: "expiresAt", type: "uint64" },
  ],
} as const;

export interface Eip712Messages {
  PurchaseOrder: PurchaseOrder;
  ShipmentAttestation: ShipmentAttestation;
  CancelOrder: CancelOrder;
  DisputeResolution: DisputeResolution;
  FundIntent: FundIntent;
  PolicyDecision: PolicyDecision;
  DocumentDecision: DocumentDecision;
}
export type Eip712Type = keyof Eip712Messages;

// `verifyingContract` is the contract that checks the signature: PDRGate for
// PolicyDecision, TradeEscrow for everything else. The chain is not fixed here:
// the closed network is an open decision (docs/decisiones/abiertas.md, #1).
export const keelDomain = (chainId: number, verifyingContract: Hex) =>
  ({ name: "Keel", version: "1", chainId, verifyingContract }) as const;
export type KeelDomain = ReturnType<typeof keelDomain>;

// ---------------------------------------------------------------------------
// 2.4 Events and typed errors (fixed names)
// ---------------------------------------------------------------------------

export const GATE_EVENTS = ["FundingExecuted", "OperationHeld", "AgentRoleRevoked", "GatePaused"] as const;
export type GateEvent = (typeof GATE_EVENTS)[number];

export const GATE_ERRORS = [
  "IntentMismatch",
  "CalldataMismatch",
  "BadPolicySignature",
  "MissingCosignature",
  "StalePolicy",
  "Expired",
  "NonceUsed",
  "GateIsPaused",
] as const;
export type GateError = (typeof GATE_ERRORS)[number];

export const ESCROW_EVENTS = [
  "OrderOpened",
  "OrderFunded",
  "AdvanceReleased",
  "ShipmentAccepted",
  "BalanceReleased",
  "Refunded",
  "DisputeRaised",
  "DisputeResolved",
  "OrderCancelled",
] as const;
export type EscrowEvent = (typeof ESCROW_EVENTS)[number];

export const ESCROW_ERRORS = [
  "InvalidState",
  "OrderExists",
  "BadImporterSignature",
  "BadExporterSignature",
  "BadCarrierSignature",
  "BadDocumentDecision",
  "ShipmentTooLate",
  "BillOfLadingAlreadyUsed",
  "DeadlineNotReached",
  "NotParty",
  "BadResolution",
  "TokenNotAllowed",
  "AmountMismatch",
] as const;
export type EscrowError = (typeof ESCROW_ERRORS)[number];

// ---------------------------------------------------------------------------
// Order states and permission tiers
// ---------------------------------------------------------------------------

// On-chain states of the escrow (docs/flujo/estados-del-escrow.md). SETTLED, REFUNDED,
// RESOLVED and CANCELLED are final. The uint8 values belong to TradeEscrow (Area 1).
export const ESCROW_STATES = [
  "OPEN",
  "FUNDED",
  "ADVANCE_PAID",
  "SETTLED",
  "REFUNDED",
  "DISPUTED",
  "RESOLVED",
  "CANCELLED",
] as const;
export type EscrowState = (typeof ESCROW_STATES)[number];

export const FINAL_ESCROW_STATES = ["SETTLED", "REFUNDED", "RESOLVED", "CANCELLED"] as const satisfies readonly EscrowState[];

// Off-chain states that go along with the escrow ones when an operation does not go
// through. Each of them notifies the reason, the due date and the manual alternative (D8).
export const HOLD_STATES = ["retenida", "en_aprobacion", "cambio_en_cola", "bloqueada"] as const;
export type HoldState = (typeof HOLD_STATES)[number];

export type Tier = 0 | 1 | 2 | 3 | 4;
