// Reproducible verifier, `keel verify <txHash>` (T2.9): from a transaction to its PDR, and from
// the PDR back to the same decision. It holds no key and changes nothing: anyone can run it.
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
import { decodeEventLog, keccak256, parseAbi, recoverTypedDataAddress } from "viem";
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

export interface ChainFacts {
  chainId: number;
  status: "success" | "reverted";
  logs: readonly ChainLog[];
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

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

async function signatureChecks(e: PdrEvidence): Promise<Check[]> {
  const type = isDocumentDecision(e.decision) ? "DocumentDecision" : "PolicyDecision";
  const digest = typedDataDigest(e.domain, type, e.decision as never);
  const recovered = await recoverTypedDataAddress({
    domain: e.domain,
    types: { [type]: EIP712_TYPES[type] },
    primaryType: type,
    message: e.decision as never,
    signature: e.signature,
  });
  return [compare("pdr hash", e.pdrHash, digest), compare("signature", low(e.signer), low(recovered))];
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
    holds("expiry", d.expiresAt <= intent.deadline, "the decision outlives its intent"),
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

// Events that carry a PDR hash and what else they say about the decision. A Trade gate
// event not listed here is still found by its hash, only without the extra checks.
const KNOWN_EVENTS = parseAbi([
  "event PaymentExecuted(bytes32 indexed intentHash, bytes32 pdrHash, uint8 tier, bytes32 indexed invoiceKey)",
  "event BalanceReleased(bytes32 indexed orderId, address indexed to, uint256 amount, bytes32 authorizationDigest)",
]);

// Every 32-byte word of a log: its topics and each word of its data.
export function logWords(log: ChainLog): Hex[] {
  const data = log.data.slice(2);
  const words = Array.from({ length: Math.floor(data.length / 64) }, (_, i) => `0x${data.slice(i * 64, i * 64 + 64)}` as Hex);
  return [...log.topics, ...words].map(low);
}

// Every hash in the transaction logs that could name a PDR.
export const candidateHashes = (facts: ChainFacts): Hex[] => [...new Set(facts.logs.flatMap(logWords))];

function decodeKnownEvent(log: ChainLog): { eventName: string; args: Record<string, unknown> } | null {
  try {
    return decodeEventLog({ abi: KNOWN_EVENTS, topics: log.topics as [Hex, ...Hex[]], data: log.data }) as never;
  } catch {
    return null;
  }
}

function chainChecks(e: PdrEvidence, facts: ChainFacts): Check[] {
  const checks = [compare("chain id", e.domain.chainId, facts.chainId), holds("transaction", facts.status === "success", "the transaction reverted")];
  const log = facts.logs.find((l) => logWords(l).includes(low(e.pdrHash)));
  if (!log) return [...checks, holds("event", false, "no log of this transaction carries the PDR hash")];
  checks.push(compare("event contract", low(e.domain.verifyingContract), low(log.address)));

  const event = decodeKnownEvent(log);
  if (!event) return checks;
  const d = e.decision;
  if (event.eventName === "PaymentExecuted" && !isDocumentDecision(d)) {
    checks.push(compare("event intent hash", d.intentHash, event.args.intentHash), compare("event tier", d.tier, event.args.tier));
  }
  if (event.eventName === "BalanceReleased" && isDocumentDecision(d)) {
    checks.push(compare("event order", d.orderId, event.args.orderId));
  }
  return checks;
}

// Every check of one PDR. Without `facts` it verifies the evidence file alone (offline).
export async function verifyEvidence(e: PdrEvidence, facts?: ChainFacts): Promise<Check[]> {
  return [...(await signatureChecks(e)), ...linkChecks(e), ...replayChecks(e), ...(facts ? chainChecks(e, facts) : [])];
}

export const verdict = (checks: readonly Check[]) => (checks.some((c) => c.outcome === "mismatch") ? "MISMATCH" : "MATCH");
