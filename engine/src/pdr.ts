// Issuance and signature of the Policy Decision Record (PDR). T2.4, issue #12.
// The engine never holds a key: the policy signer comes in from outside (T2.7).
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  type DocumentDecision,
  EIP712_TYPES,
  type Hex,
  type KeelDomain,
  type PaymentIntent,
  type PolicyDecision,
  type PurchaseOrder,
  type ShipmentAttestation,
  type Tier,
} from "@keel/schemas";
import { paymentIntentHash, typedDataDigest } from "@keel/schemas/hash";
import { encodeFunctionData, erc20Abi, keccak256, type LocalAccount, recoverTypedDataAddress } from "viem";
import {
  type DocumentContext,
  type DocumentEvaluation,
  type DocumentExtractions,
  type DocumentRuleResult,
  evaluateDocuments,
} from "./documents";
import type { FundingContext } from "./funding";
import type { RuleResult } from "./index";
import { type TradePolicy, tradePolicyHash } from "./policy";

// Anything that signs EIP-712 typed data: a local account in the demo, a KMS or HSM in production.
export type PolicySigner = Pick<LocalAccount, "address" | "signTypedData">;

export interface SignedPolicyDecision {
  decision: PolicyDecision;
  // EIP-712 digest of the decision. PDRGate calls it `pdrHash` and emits it on execution.
  pdrHash: Hex;
  signature: Hex;
  signer: Hex;
  domain: KeelDomain;
}

// Keel Personal: the exact calldata PDRGate builds, abi.encodeCall(IERC20.transfer, (recipient, amount)).
export function paymentCalldata(intent: PaymentIntent): Hex {
  return encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [intent.recipient, intent.amountUsdc] });
}

export interface DecisionInput {
  intentHash: Hex;
  // The exact calldata the Safe will execute. Only its hash goes in the decision.
  calldata: Hex;
  policyHash: Hex;
  inputsHash: Hex;
  tier: Tier;
  expiresAt: bigint;
}

export function buildPolicyDecision(input: DecisionInput): PolicyDecision {
  // Tier 0 only reads, tier 2 goes through the Delay and tier 4 is forbidden: none reaches the gate
  if (input.tier !== 1 && input.tier !== 3) throw new Error(`tier ${input.tier} never reaches the gate`);
  return {
    intentHash: input.intentHash,
    calldataHash: keccak256(input.calldata),
    policyHash: input.policyHash,
    inputsHash: input.inputsHash,
    tier: input.tier,
    expiresAt: input.expiresAt,
  };
}

const policyDecisionTypedData = (domain: KeelDomain, decision: PolicyDecision) => ({
  domain,
  types: { PolicyDecision: EIP712_TYPES.PolicyDecision },
  primaryType: "PolicyDecision" as const,
  message: decision,
});

export async function signPolicyDecision(
  decision: PolicyDecision,
  domain: KeelDomain,
  signer: PolicySigner,
): Promise<SignedPolicyDecision> {
  const typedData = policyDecisionTypedData(domain, decision);
  const signature = await signer.signTypedData(typedData);
  // A misbehaving signer (a KMS returning another key's signature) fails here, not on chain
  const recovered = await recoverTypedDataAddress({ ...typedData, signature });
  if (recovered.toLowerCase() !== signer.address.toLowerCase()) throw new Error("the signature does not recover to the policy signer");
  return { decision, pdrHash: typedDataDigest(domain, "PolicyDecision", decision), signature, signer: signer.address, domain };
}

// Tier 3: what the cosigner's wallet must sign (Area 4). PDRGate checks it over the same digest.
export function cosignRequest(signed: SignedPolicyDecision) {
  if (signed.decision.tier !== 3) throw new Error("only tier 3 needs a cosignature");
  return { pdrHash: signed.pdrHash, typedData: policyDecisionTypedData(signed.domain, signed.decision) };
}

export interface SignedDocumentDecision {
  decision: DocumentDecision;
  // EIP-712 digest of the decision, the hash TradeEscrow will check
  pdrHash: Hex;
  signature: Hex;
  signer: Hex;
  domain: KeelDomain;
}

// Trigger 2: the document verifier fixed in the order signs the DocumentDecision for
// TradeEscrow. Any other key would be rejected by the escrow, so it fails here first.
export async function signDocumentDecision(
  decision: DocumentDecision,
  domain: KeelDomain,
  signer: PolicySigner,
  documentVerifier: Hex,
): Promise<SignedDocumentDecision> {
  if (signer.address.toLowerCase() !== documentVerifier.toLowerCase()) {
    throw new Error("the signer is not the document verifier of this order");
  }
  const typedData = {
    domain,
    types: { DocumentDecision: EIP712_TYPES.DocumentDecision },
    primaryType: "DocumentDecision" as const,
    message: decision,
  };
  const signature = await signer.signTypedData(typedData);
  const recovered = await recoverTypedDataAddress({ ...typedData, signature });
  if (recovered.toLowerCase() !== signer.address.toLowerCase()) throw new Error("the signature does not recover to the document verifier");
  return { decision, pdrHash: typedDataDigest(domain, "DocumentDecision", decision), signature, signer: signer.address, domain };
}

export interface DocumentPdrInput {
  order: PurchaseOrder;
  attestation: ShipmentAttestation;
  extractions: DocumentExtractions;
  // The policy hash comes from `policy`, never from the caller
  context: Omit<DocumentContext, "policyHash">;
  policy: TradePolicy;
  domain: KeelDomain;
  signer: PolicySigner;
}

// Trigger 2, end to end: evaluate the documents and, only when they conform, sign the
// DocumentDecision and build its evidence with every input the verifier needs.
export async function issueDocumentPdr(input: DocumentPdrInput): Promise<{ evaluation: DocumentEvaluation; evidence?: PdrEvidence }> {
  const { order, attestation, extractions, policy } = input;
  const context: DocumentContext = { ...input.context, policyHash: tradePolicyHash(policy) };
  const evaluation = evaluateDocuments(order, attestation, extractions, context);
  if (!evaluation.decision) return { evaluation };
  const signed = await signDocumentDecision(evaluation.decision, input.domain, input.signer, order.documentVerifier);
  const evidence: PdrEvidence = {
    mode: "trade",
    issuedAt: context.now,
    ...signed,
    intent: attestation,
    rules: evaluation.rules,
    replay: { kind: "documents", policy, order, attestation, extractions, context },
  };
  return { evaluation, evidence };
}

export interface PaymentPdrInput {
  intent: PaymentIntent;
  tier: Tier;
  policyHash: Hex;
  inputsHash: Hex;
  // Unix timestamp, seconds. The engine has no implicit clock.
  now: number;
  ttlSeconds: number;
  domain: KeelDomain;
  signer: PolicySigner;
}

export interface PaymentPdr extends SignedPolicyDecision {
  intent: PaymentIntent;
  calldata: Hex;
}

// Keel Personal, end to end: intent hash, exact calldata, decision and policy signature.
// The decision never outlives the intent, because PDRGate rejects either one once expired.
export async function issuePaymentPdr(input: PaymentPdrInput): Promise<PaymentPdr> {
  const calldata = paymentCalldata(input.intent);
  const ttlEnd = BigInt(input.now + input.ttlSeconds);
  const decision = buildPolicyDecision({
    intentHash: paymentIntentHash(input.intent),
    calldata,
    policyHash: input.policyHash,
    inputsHash: input.inputsHash,
    tier: input.tier,
    expiresAt: ttlEnd < input.intent.deadline ? ttlEnd : input.intent.deadline,
  });
  const signed = await signPolicyDecision(decision, input.domain, input.signer);
  return { ...signed, intent: input.intent, calldata };
}

// ---------------------------------------------------------------------------
// Evidence: the full PDR goes off-chain to evidence/pdr/<pdrHash>.json; on-chain only its hash.
// ---------------------------------------------------------------------------

// Everything a decision was made on, so `keel verify` can run the same rules again (T2.9).
export type ReplayInputs =
  | { kind: "funding"; policy: TradePolicy; order: PurchaseOrder; context: FundingContext }
  | {
      kind: "documents";
      policy: TradePolicy;
      order: PurchaseOrder;
      attestation: ShipmentAttestation;
      extractions: DocumentExtractions;
      context: DocumentContext;
    };

export interface PdrEvidence {
  mode: "personal" | "trade";
  pdrHash: Hex;
  issuedAt: number;
  signer: Hex;
  signature: Hex;
  domain: KeelDomain;
  decision: PolicyDecision | DocumentDecision;
  // The intent (funding or payment) or the attestation (trigger 2)
  intent: unknown;
  // Absent for a document decision: the escrow builds the transfer itself
  calldata?: Hex;
  rules: readonly (RuleResult | DocumentRuleResult)[];
  // Absent in Keel Personal until its engine exists (T2.2): such a PDR is checked but not replayed
  replay?: ReplayInputs;
}

// Bigints become decimal strings so the file is plain JSON and byte-stable.
export function serializeEvidence(evidence: PdrEvidence): string {
  return `${JSON.stringify(evidence, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2)}\n`;
}

export function saveEvidence(dir: string, evidence: PdrEvidence): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${evidence.pdrHash}.json`);
  writeFileSync(path, serializeEvidence(evidence));
  return path;
}
