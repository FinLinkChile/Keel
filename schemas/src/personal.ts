// Interfaces of Keel Personal (bill payments), frozen on Monday Oct 12.
// Re-exported from ./index.ts. Do not build Keel Trade components on them.
import { z } from "zod";
import type { Hex } from "./index";

// Order matters: the index is the uint8 `aliasId` of PaymentIntent.
export const ALIAS_IDS = ["ARRIENDO", "LUZ", "INTERNET", "GASTOS_COMUNES"] as const;
export type AliasId = (typeof ALIAS_IDS)[number];

export const aliasIndex = (alias: AliasId): number => ALIAS_IDS.indexOf(alias);

// No free text: enums, numbers and regex-validated fields only (D3).
// There is no issuer name, notes or destination address on purpose.
export const InvoiceExtraction = z
  .object({
    alias_id: z.enum(ALIAS_IDS),
    // Normalized RUT: no dots, no hyphen
    issuer_tax_id: z.string().regex(/^[0-9]{7,8}[0-9K]$/),
    invoice_number: z.string().regex(/^[0-9]{1,12}$/),
    // YYYYMM
    period: z.string().regex(/^20[0-9]{2}(0[1-9]|1[0-2])$/),
    amount_clp: z.number().int().positive(),
    // Unix timestamp, seconds
    due_date: z.number().int().positive(),
    mentions_account_change: z.boolean(),
    hidden_text_detected: z.boolean(),
  })
  .strict();
export type InvoiceExtraction = z.infer<typeof InvoiceExtraction>;

export interface PaymentIntent {
  aliasId: number;
  // Resolved from the alias table, never from the document
  recipient: Hex;
  // 6 decimals
  amountUsdc: bigint;
  // keccak256(abi.encode(rut, folio, period)), with normalized values
  invoiceKey: Hex;
  deadline: bigint;
  nonce: bigint;
}

// Mirrors KeelHash.sol (and KeelHashing.sol until PDRGate moves to KeelHash). PolicyDecision,
// shared by both modes, is in EIP712_TYPES.
export const PERSONAL_EIP712_TYPES = {
  PaymentIntent: [
    { name: "aliasId", type: "uint8" },
    { name: "recipient", type: "address" },
    { name: "amountUsdc", type: "uint256" },
    { name: "invoiceKey", type: "bytes32" },
    { name: "deadline", type: "uint64" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

// Events and errors of PDRGate, the Personal gate, as its ABI declares them.
// engine/src/pdr.test.ts checks them against the compiled contract.
export const PERSONAL_GATE_EVENTS = [
  "PaymentExecuted",
  "PaymentHeld",
  "BeneficiaryChangeQueued",
  "BeneficiaryChangeVetoed",
  // Declared by IPDRGate but never emitted: revoking the agent is a Roles event
  "AgentRoleRevoked",
  "GatePaused",
  "GateUnpaused",
  "PolicySignerSet",
  "PolicyHashSet",
  "CosignerSet",
  // Inherited from OpenZeppelin EIP712 (ERC-5267)
  "EIP712DomainChanged",
] as const;
export type PersonalGateEvent = (typeof PERSONAL_GATE_EVENTS)[number];

export const PERSONAL_GATE_ERRORS = [
  "IntentMismatch",
  "CalldataMismatch",
  "BadPolicySignature",
  "MissingCosignature",
  "StalePolicy",
  "Expired",
  "NonceUsed",
  "InvoiceAlreadyPaid",
  "GateIsPaused",
  "InvalidTier",
  "OnlySafe",
  // Inherited from OpenZeppelin ShortStrings: only possible at deployment
  "InvalidShortString",
  "StringTooLong",
] as const;
export type PersonalGateError = (typeof PERSONAL_GATE_ERRORS)[number];

export const BASE_SEPOLIA_CHAIN_ID = 84532;

export const PAYMENT_STATES = [
  "pagado",
  "retenido",
  "en_aprobacion",
  "cambio_en_cola",
  "bloqueado",
] as const;
export type PaymentState = (typeof PAYMENT_STATES)[number];
