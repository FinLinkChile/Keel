// Shared interfaces of Keel. Owned by Area 2.
// DRAFT until the interface freeze (Monday Oct 12, 20:00 CLT). After the freeze,
// any change here must be announced to all five areas.
import { z } from "zod";

// ---------------------------------------------------------------------------
// 2.1 Invoice extraction (output of the quarantined extractor)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// 2.2 Intent and 2.3 Decision (mirror contracts/src/KeelTypes.sol)
// ---------------------------------------------------------------------------

export type Hex = `0x${string}`;

export interface PaymentIntent {
  aliasId: number;
  // Resolved from the alias table, never from the document
  recipient: Hex;
  // 6 decimals
  amountUsdc: bigint;
  // keccak256(issuerTaxId, invoiceNumber, period)
  invoiceKey: Hex;
  deadline: bigint;
  nonce: bigint;
}

export interface PolicyDecision {
  // EIP-712 hash of PaymentIntent
  intentHash: Hex;
  // keccak256 of the exact USDC.transfer calldata
  calldataHash: Hex;
  // Current version of the rules
  policyHash: Hex;
  // FX rate, sources, allowlist version
  inputsHash: Hex;
  // 1 or 3 (tiers 0, 2 and 4 never reach the gate)
  tier: 1 | 3;
  expiresAt: bigint;
}

export const EIP712_TYPES = {
  PaymentIntent: [
    { name: "aliasId", type: "uint8" },
    { name: "recipient", type: "address" },
    { name: "amountUsdc", type: "uint256" },
    { name: "invoiceKey", type: "bytes32" },
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
} as const;

export const BASE_SEPOLIA_CHAIN_ID = 84532;

// `verifyingContract` is the deployed PDRGate address.
export const keelDomain = (chainId: number, verifyingContract: Hex) =>
  ({ name: "Keel", version: "1", chainId, verifyingContract }) as const;

// ---------------------------------------------------------------------------
// 2.4 Events and typed errors (fixed names)
// ---------------------------------------------------------------------------

export const GATE_EVENTS = [
  "PaymentExecuted",
  "PaymentHeld",
  "BeneficiaryChangeQueued",
  "BeneficiaryChangeVetoed",
  "AgentRoleRevoked",
  "GatePaused",
] as const;
export type GateEvent = (typeof GATE_EVENTS)[number];

export const GATE_ERRORS = [
  "IntentMismatch",
  "CalldataMismatch",
  "BadPolicySignature",
  "MissingCosignature",
  "StalePolicy",
  "Expired",
  "NonceUsed",
  "InvoiceAlreadyPaid",
  "GateIsPaused",
] as const;
export type GateError = (typeof GATE_ERRORS)[number];

// ---------------------------------------------------------------------------
// Payment states and permission tiers
// ---------------------------------------------------------------------------

export const PAYMENT_STATES = [
  "pagado",
  "retenido",
  "en_aprobacion",
  "cambio_en_cola",
  "bloqueado",
] as const;
export type PaymentState = (typeof PAYMENT_STATES)[number];

export type Tier = 0 | 1 | 2 | 3 | 4;
