// Reproducible verifier, `keel verify <txHash>` (T2.9): from a transaction to its PDR, and from
// the PDR back to the same decision. It holds no key and changes nothing: anyone can run it.
// Nothing in the evidence file is trusted about who signed or where: the transaction must come
// from a contract of contracts/deployments/<chainId>.json, and the signer must be the one that
// contract trusted at that block. Without the chain, the result is "evidence only".
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type DocumentDecision,
  EIP712_TYPES,
  type Hex,
  PERSONAL_EIP712_TYPES,
  type PaymentIntent,
  type FundIntent,
  type PolicyDecision,
  type ShipmentAttestation,
} from "@keel/schemas";
import { paymentIntentHash, structHash, typedDataDigest } from "@keel/schemas/hash";
import { decodeEventLog, isAddress, keccak256, parseAbi, recoverTypedDataAddress } from "viem";
import { canonical } from "./canonical";
import { evaluateDocuments } from "./documents";
import { evaluateFunding } from "./funding";
import type { PdrEvidence, ReplayInputs } from "./pdr";
import { TRADE_RULES_VERSION, tradePolicyHash } from "./policy";

export type Outcome = "match" | "mismatch" | "skipped";

export interface Check {
  check: string;
  outcome: Outcome;
  expected?: string;
  actual?: string;
  note?: string;
}

// What the verifier reads from the chain about one transaction.
export interface ChainLog {
  address: Hex;
  topics: readonly Hex[];
  data: Hex;
}

// The official addresses of one chain, from contracts/deployments/<chainId>.json (Area 1). Only
// the contracts a PDR can be anchored to are read.
export interface Deployment {
  chainId: number;
  pdrGate?: Hex;
  fundingGate?: Hex;
  tradeEscrow?: Hex;
}

// Contract state at the block of the transaction, so a later rotation of a signer does not count.
export interface ChainReader {
  policySigner(gate: Hex, blockNumber: bigint): Promise<Hex>;
  order(escrow: Hex, orderId: Hex, blockNumber: bigint): Promise<{ orderHash: Hex; documentVerifier: Hex }>;
}

export interface ChainFacts {
  chainId: number;
  status: "success" | "reverted";
  blockNumber: bigint;
  logs: readonly ChainLog[];
  // Null when the chain has no deployment file: nothing can be anchored
  deployment: Deployment | null;
  read: ChainReader;
}

const show = (value: unknown) => JSON.stringify(canonical(value));
const low = (hex: Hex) => hex.toLowerCase() as Hex;

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

// On two objects, only the fields that differ are shown.
function compare(check: string, expected: unknown, actual: unknown): Check {
  if (show(expected) === show(actual)) return { check, outcome: "match" };
  if (isRecord(expected) && isRecord(actual)) {
    const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].filter((k) => show(expected[k]) !== show(actual[k]));
    const pick = (o: Record<string, unknown>) => show(Object.fromEntries(keys.map((k) => [k, o[k] ?? null])));
    return { check, outcome: "mismatch", expected: pick(expected), actual: pick(actual) };
  }
  return { check, outcome: "mismatch", expected: show(expected), actual: show(actual) };
}

// Rule lists are long: point at the first rule that differs.
function compareList(check: string, expected: readonly unknown[], actual: readonly unknown[]): Check {
  const length = Math.max(expected.length, actual.length);
  for (let i = 0; i < length; i++) {
    const c = compare(`${check}[${i}]`, expected[i] ?? null, actual[i] ?? null);
    if (c.outcome === "mismatch") return c;
  }
  return { check, outcome: "match" };
}

const holds = (check: string, ok: boolean, note: string): Check => (ok ? { check, outcome: "match" } : { check, outcome: "mismatch", note });
const skipped = (check: string, note: string): Check => ({ check, outcome: "skipped", note });

export const isDocumentDecision = (d: PolicyDecision | DocumentDecision): d is DocumentDecision => "attestationHash" in d;

// ---------------------------------------------------------------------------
// Evidence file: bigints were written as decimal strings, the EIP-712 field types bring them back.
// ---------------------------------------------------------------------------

type Field = { readonly name: string; readonly type: string };
// Raw JSON from the evidence file, before revival
type Raw = any;

function reviveStruct<T>(fields: readonly Field[], raw: Raw): T {
  const value = (type: string, v: Raw) => {
    const int = /^u?int(\d+)$/.exec(type);
    if (!int) return v;
    // Small integers are numbers in the TS interfaces (tier, advanceBps, aliasId)
    return Number(int[1]) <= 32 ? Number(v) : BigInt(v);
  };
  return Object.fromEntries(fields.map(({ name, type }) => [name, value(type, raw[name])])) as T;
}

function reviveReplay(raw: Raw): ReplayInputs {
  const order = reviveStruct<ReplayInputs["order"]>(EIP712_TYPES.PurchaseOrder, raw.order);
  const c = raw.context;
  if (raw.kind === "funding") {
    const context = {
      ...c,
      allowance: { ...c.allowance, remaining: BigInt(c.allowance.remaining) },
      history: c.history.map((h: string) => BigInt(h)),
      nonce: BigInt(c.nonce),
    };
    return { kind: "funding", policy: raw.policy, order, context };
  }
  const terms = c.terms && { ...c.terms, invoiceAmountMinor: BigInt(c.terms.invoiceAmountMinor) };
  return {
    kind: "documents",
    policy: raw.policy,
    order,
    attestation: reviveStruct(EIP712_TYPES.ShipmentAttestation, raw.attestation),
    extractions: raw.extractions,
    context: { ...c, terms },
  };
}

export function parseEvidence(text: string): PdrEvidence {
  const raw: Raw = JSON.parse(text);
  const documents = "attestationHash" in raw.decision;
  const intentFields = documents
    ? EIP712_TYPES.ShipmentAttestation
    : raw.mode === "personal"
      ? PERSONAL_EIP712_TYPES.PaymentIntent
      : EIP712_TYPES.FundIntent;
  return {
    ...raw,
    decision: reviveStruct(documents ? EIP712_TYPES.DocumentDecision : EIP712_TYPES.PolicyDecision, raw.decision),
    intent: reviveStruct(intentFields, raw.intent),
    replay: raw.replay ? reviveReplay(raw.replay) : undefined,
  };
}

// The evidence of a PDR, or null when there is none for that hash.
export function loadEvidence(dir: string, pdrHash: Hex): PdrEvidence | null {
  try {
    return parseEvidence(readFileSync(join(dir, `${low(pdrHash)}.json`), "utf8"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

export function loadDeployment(dir: string, chainId: number): Deployment | null {
  let raw: Raw;
  try {
    raw = JSON.parse(readFileSync(join(dir, `${chainId}.json`), "utf8"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
  const pick = (key: string) => (typeof raw[key] === "string" && isAddress(raw[key], { strict: false }) ? low(raw[key]) : undefined);
  return { chainId, pdrGate: pick("pdrGate"), fundingGate: pick("fundingGate"), tradeEscrow: pick("tradeEscrow") };
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

// Who signed the decision, recovered from the signature. Only EOA signatures are recovered: an
// ERC-1271 signer (a Safe as verifier) is not supported and shows as a mismatch.
async function recoverSigner(e: PdrEvidence): Promise<Hex | null> {
  const type = isDocumentDecision(e.decision) ? "DocumentDecision" : "PolicyDecision";
  try {
    const signer = await recoverTypedDataAddress({
      domain: e.domain,
      types: { [type]: EIP712_TYPES[type] },
      primaryType: type,
      message: e.decision as never,
      signature: e.signature,
    });
    return low(signer);
  } catch {
    return null;
  }
}

function signatureChecks(e: PdrEvidence, recovered: Hex | null): Check[] {
  const type = isDocumentDecision(e.decision) ? "DocumentDecision" : "PolicyDecision";
  const digest = typedDataDigest(e.domain, type, e.decision as never);
  const signature = recovered
    ? compare("signature", low(e.signer), recovered)
    : holds("signature", false, "no EOA signer recovers from it (ERC-1271 signers are not supported)");
  return [compare("pdr hash", e.pdrHash, digest), signature];
}

// The decision commits to the intent (or the attestation) and the calldata the evidence shows.
function linkChecks(e: PdrEvidence): Check[] {
  if (isDocumentDecision(e.decision)) {
    const attestation = e.intent as ShipmentAttestation;
    return [
      compare("attestation hash", e.decision.attestationHash, structHash("ShipmentAttestation", attestation)),
      compare("docs hash", e.decision.docsHash, attestation.docsHash),
    ];
  }
  const d = e.decision;
  const intent = e.intent as PaymentIntent | FundIntent;
  const intentHash = e.mode === "personal" ? paymentIntentHash(intent as PaymentIntent) : structHash("FundIntent", intent as FundIntent);
  return [
    compare("intent hash", d.intentHash, intentHash),
    e.calldata ? compare("calldata hash", d.calldataHash, keccak256(e.calldata)) : skipped("calldata hash", "the evidence carries no calldata"),
    // The engine's own rule: the gate checks each expiry, not that one ends before the other
    holds("expiry (engine rule)", d.expiresAt <= intent.deadline, "the decision outlives its intent"),
  ];
}

// Run the same rules on the same inputs and compare everything they produce.
function replayChecks(e: PdrEvidence): Check[] {
  const r = e.replay;
  if (!r) {
    const why = e.mode === "personal" ? "Keel Personal decisions are not replayable until its engine exists (T2.2)" : "the evidence carries no inputs";
    return [skipped("replay", why)];
  }
  if (r.policy.rulesVersion !== TRADE_RULES_VERSION) {
    return [skipped("replay", `made with rules ${r.policy.rulesVersion}, this verifier runs ${TRADE_RULES_VERSION}: run the verifier of that version`)];
  }
  const checks = [compare("policy hash", e.decision.policyHash, tradePolicyHash(r.policy))];
  if (r.kind === "funding") {
    const out = evaluateFunding(r.order, r.context, r.policy.funding);
    const d = e.decision as PolicyDecision;
    checks.push(
      compareList("rules", e.rules, out.rules),
      compare("tier", d.tier, out.tier),
      compare("inputs hash", d.inputsHash, out.inputsHash),
      compare("intent", e.intent, out.intent ?? null),
    );
  } else {
    const out = evaluateDocuments(r.order, r.attestation, r.extractions, r.context);
    checks.push(
      compareList("rules", e.rules, out.rules),
      compare("inputs hash", e.decision.inputsHash, out.inputsHash),
      compare("attestation", e.intent, r.attestation),
      compare("decision", e.decision, out.decision ?? null),
    );
  }
  return checks;
}

// ---------------------------------------------------------------------------
// Anchoring to the chain
// ---------------------------------------------------------------------------

// Events that name a PDR, and the deployed contract each one must come from.
const KNOWN_EVENTS = parseAbi([
  "event PaymentExecuted(bytes32 indexed intentHash, bytes32 pdrHash, uint8 tier, bytes32 indexed invoiceKey)",
  "event FundingExecuted(bytes32 indexed intentHash, bytes32 pdrHash, uint8 tier, bytes32 indexed orderId)",
  "event BalanceReleased(bytes32 indexed orderId, address indexed to, uint256 amount, bytes32 authorizationDigest)",
]);
type KnownEvent = "PaymentExecuted" | "FundingExecuted" | "BalanceReleased";
const EMITTER: Record<KnownEvent, "pdrGate" | "fundingGate" | "tradeEscrow"> = {
  PaymentExecuted: "pdrGate",
  FundingExecuted: "fundingGate",
  BalanceReleased: "tradeEscrow",
};

interface AnchoredEvent {
  eventName: KnownEvent;
  args: Record<string, unknown>;
  // The PDR the event names: pdrHash, or the authorization digest of a balance release (a
  // DocumentDecision, or the importer's BalanceApproval, which has no evidence file)
  pdrHash: Hex;
}

function decodeKnownEvent(log: ChainLog): { eventName: KnownEvent; args: Record<string, unknown> } | null {
  try {
    return decodeEventLog({ abi: KNOWN_EVENTS, topics: log.topics as [Hex, ...Hex[]], data: log.data }) as never;
  } catch {
    return null;
  }
}

// Only a known event, by its topic0, emitted by the contract the deployment names for it.
function anchoredEvents(facts: ChainFacts): AnchoredEvent[] {
  const deployment = facts.deployment;
  if (!deployment) return [];
  return facts.logs.flatMap((log) => {
    const event = decodeKnownEvent(log);
    if (!event || deployment[EMITTER[event.eventName]] !== low(log.address)) return [];
    const named = event.eventName === "BalanceReleased" ? event.args.authorizationDigest : event.args.pdrHash;
    return [{ ...event, pdrHash: low(named as Hex) }];
  });
}

// The PDR hashes a transaction carries, from the known events of the deployed contracts.
export const candidateHashes = (facts: ChainFacts): Hex[] => [...new Set(anchoredEvents(facts).map((e) => e.pdrHash))];

// Which event a PDR must reach: the Personal gate, the Trade gate or the escrow.
function anchorOf(e: PdrEvidence): KnownEvent {
  if (isDocumentDecision(e.decision)) return "BalanceReleased";
  return e.mode === "personal" ? "PaymentExecuted" : "FundingExecuted";
}

// The deployed contract that must have emitted the event of this PDR, if the deployment names it.
export const emitterOf = (e: PdrEvidence, deployment: Deployment | null): Hex | undefined => deployment?.[EMITTER[anchorOf(e)]];

// The check that turns MATCH from "the file is consistent" into "the deployed contract accepted
// this decision from the key it trusted at that block".
export const ANCHOR_CHECK = "signer on chain";

async function chainChecks(e: PdrEvidence, facts: ChainFacts, recovered: Hex | null): Promise<Check[]> {
  const checks = [compare("chain id", e.domain.chainId, facts.chainId), holds("transaction", facts.status === "success", "the transaction reverted")];
  const eventName = anchorOf(e);
  const key = EMITTER[eventName];
  const contract = facts.deployment?.[key];
  if (!contract) {
    return [...checks, holds("deployment", false, `no ${key} in deployments/${facts.chainId}.json: nothing ties this transaction to Keel's contracts`)];
  }
  checks.push(compare("verifying contract", contract, low(e.domain.verifyingContract)));
  const event = anchoredEvents(facts).find((x) => x.eventName === eventName && x.pdrHash === low(e.pdrHash));
  if (!event) return [...checks, holds("event", false, `no ${eventName} of ${contract} in this transaction names the PDR hash`)];
  checks.push({ check: "event", outcome: "match" });

  const d = e.decision;
  if (isDocumentDecision(d)) {
    const order = await facts.read.order(contract, d.orderId, facts.blockNumber);
    checks.push(
      compare("event order", d.orderId, event.args.orderId),
      // The escrow accepts the signature of the verifier the order names, nobody else
      compare(ANCHOR_CHECK, low(order.documentVerifier), recovered),
      e.replay
        ? compare("order on chain", order.orderHash, structHash("PurchaseOrder", e.replay.order))
        : skipped("order on chain", "the evidence carries no inputs"),
    );
  } else {
    checks.push(compare("event intent hash", d.intentHash, event.args.intentHash), compare("event tier", d.tier, event.args.tier));
    if (eventName === "FundingExecuted") checks.push(compare("event order", (e.intent as FundIntent).orderId, event.args.orderId));
    // The gate accepts only the policy signer it holds at that block
    checks.push(compare(ANCHOR_CHECK, low(await facts.read.policySigner(contract, facts.blockNumber)), recovered));
  }
  return checks;
}

// Every check of one PDR. Without `facts` it verifies the evidence file alone (offline).
export async function verifyEvidence(e: PdrEvidence, facts?: ChainFacts): Promise<Check[]> {
  const recovered = await recoverSigner(e);
  return [...signatureChecks(e, recovered), ...linkChecks(e), ...replayChecks(e), ...(facts ? await chainChecks(e, facts, recovered) : [])];
}

// MATCH only when the chain names the signer; a consistent file alone is EVIDENCE ONLY.
export type Verdict = "MATCH" | "MISMATCH" | "EVIDENCE ONLY";
export function verdict(checks: readonly Check[]): Verdict {
  if (checks.some((c) => c.outcome === "mismatch")) return "MISMATCH";
  return checks.some((c) => c.check === ANCHOR_CHECK && c.outcome === "match") ? "MATCH" : "EVIDENCE ONLY";
}
