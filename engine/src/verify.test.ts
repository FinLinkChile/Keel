import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Hex, keelDomain, type PaymentIntent } from "@keel/schemas";
import { structHash } from "@keel/schemas/hash";
import { encodeAbiParameters, encodeEventTopics, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { evaluateFunding } from "./funding";
import { buildPolicyDecision, issueDocumentPdr, issuePaymentPdr, type PdrEvidence, saveEvidence, serializeEvidence, signPolicyDecision } from "./pdr";
import { TRADE_RULES_VERSION, tradePolicy, tradePolicyHash } from "./policy";
import { compile, createChain } from "./testing/chain";
import { address, attestation, documentContext, extractions, fundingContext, order, word } from "./testing/fixtures";
import { type ChainFacts, type Check, candidateHashes, loadEvidence, parseEvidence, verdict, verifyEvidence } from "./verify";

const ESCROW = address(0xe5c0);
const GATE = address(0x6a7e);
const verifierKey = privateKeyToAccount(word("test document verifier"));
const policySigner = privateKeyToAccount(word("test policy signer"));
const policy = tradePolicy(word("roles-config-v1"));

// The verifier always reads the evidence back from its file, as `keel verify` does
const roundTrip = (e: PdrEvidence) => parseEvidence(serializeEvidence(e));
const outcomes = (checks: readonly Check[]) => Object.fromEntries(checks.map((c) => [c.check, c.outcome]));
const failed = (checks: readonly Check[]) => checks.filter((c) => c.outcome === "mismatch").map((c) => c.check);

async function documentEvidence(): Promise<PdrEvidence> {
  const { evidence } = await issueDocumentPdr({
    order: { ...order, documentVerifier: verifierKey.address },
    attestation,
    extractions,
    context: documentContext,
    policy,
    domain: keelDomain(1, ESCROW),
    signer: verifierKey,
  });
  return evidence!;
}

async function fundingEvidence(): Promise<PdrEvidence> {
  const out = evaluateFunding(order, fundingContext, policy.funding);
  const calldata = "0x8ca0c7b3" as Hex; // stands in for the Trade gate call until Area 1 defines it
  const decision = buildPolicyDecision({
    intentHash: structHash("FundIntent", out.intent!),
    calldata,
    policyHash: tradePolicyHash(policy),
    inputsHash: out.inputsHash,
    tier: 1,
    expiresAt: out.intent!.deadline,
  });
  const signed = await signPolicyDecision(decision, keelDomain(1, GATE), policySigner);
  return {
    mode: "trade",
    issuedAt: fundingContext.now,
    ...signed,
    intent: out.intent,
    calldata,
    rules: out.rules,
    replay: { kind: "funding", policy, order, context: fundingContext },
  };
}

describe("keel verify: document decision of trigger 2", () => {
  it("an untouched evidence file replays to the same decision", async () => {
    const checks = await verifyEvidence(roundTrip(await documentEvidence()));
    expect(verdict(checks)).toBe("MATCH");
    expect(checks.filter((c) => c.outcome !== "match")).toEqual([]);
    expect(outcomes(checks)).toMatchObject({ "pdr hash": "match", signature: "match", rules: "match", "inputs hash": "match", decision: "match" });
  });

  it("an extraction changed after the decision no longer hashes to the inputs that were signed", async () => {
    const e = await documentEvidence();
    const r = e.replay as Extract<PdrEvidence["replay"], { kind: "documents" }>;
    const invoice = { ...r.extractions.invoice, invoice_number: "INV99999" };
    const checks = await verifyEvidence(roundTrip({ ...e, replay: { ...r, extractions: { ...r.extractions, invoice } } }));
    expect(verdict(checks)).toBe("MISMATCH");
    expect(failed(checks)).toEqual(["inputs hash", "decision"]);
  });

  it("an extraction that changes a rule result points at that rule", async () => {
    const e = await documentEvidence();
    const r = e.replay as Extract<PdrEvidence["replay"], { kind: "documents" }>;
    const invoice = { ...r.extractions.invoice, mentions_account_change: true };
    const checks = await verifyEvidence(roundTrip({ ...e, replay: { ...r, extractions: { ...r.extractions, invoice } } }));
    const rules = checks.find((c) => c.check.startsWith("rules"))!;
    expect(rules).toMatchObject({ check: "rules[13]", outcome: "mismatch" });
    expect(rules.actual).toContain("ACCOUNT_CHANGE_MENTIONED");
  });

  it("rule results rewritten in the evidence are caught by the replay", async () => {
    const e = await documentEvidence();
    const rules = e.rules.map((r, i) => (i === 0 ? { ...r, reason: "ATTESTATION_OTHER_ORDER" } : r)) as PdrEvidence["rules"];
    expect(failed(await verifyEvidence(roundTrip({ ...e, rules })))).toEqual(["rules[0]"]);
  });

  it("a decision edited after signing breaks the PDR hash and the signature", async () => {
    const e = await documentEvidence();
    const decision = { ...e.decision, expiresAt: e.decision.expiresAt + 3600n };
    expect(failed(await verifyEvidence(roundTrip({ ...e, decision })))).toEqual(
      expect.arrayContaining(["pdr hash", "signature", "decision"]),
    );
  });

  it("a decision made with another version of the rules is not replayed with this one", async () => {
    const e = await documentEvidence();
    const replay = { ...e.replay!, policy: { ...policy, rulesVersion: "keel-trade/0" } };
    const checks = await verifyEvidence(roundTrip({ ...e, replay }));
    expect(checks.find((c) => c.check === "replay")).toMatchObject({ outcome: "skipped" });
    expect(checks.find((c) => c.check === "replay")!.note).toContain(TRADE_RULES_VERSION);
  });

  it("finds the balance release by its authorization digest and checks the order", async () => {
    const e = await documentEvidence();
    const abi = parseAbi(["event BalanceReleased(bytes32 indexed orderId, address indexed to, uint256 amount, bytes32 authorizationDigest)"]);
    const topics = encodeEventTopics({ abi, eventName: "BalanceReleased", args: { orderId: order.orderId, to: order.payoutAddress } });
    const data = encodeAbiParameters([{ type: "uint256" }, { type: "bytes32" }], [5_000_000_000n, e.pdrHash]);
    const facts: ChainFacts = { chainId: 1, status: "success", logs: [{ address: ESCROW, topics: topics as Hex[], data }] };

    expect(candidateHashes(facts)).toContain(e.pdrHash);
    const checks = await verifyEvidence(roundTrip(e), facts);
    expect(verdict(checks)).toBe("MATCH");
    expect(outcomes(checks)).toMatchObject({ "event contract": "match", "event order": "match" });

    const elsewhere = await verifyEvidence(roundTrip(e), { ...facts, logs: [{ ...facts.logs[0]!, address: GATE }] });
    expect(failed(elsewhere)).toEqual(["event contract"]);
  });
});

describe("keel verify: funding decision", () => {
  it("an untouched evidence file replays to the same tier, intent and inputs", async () => {
    const checks = await verifyEvidence(roundTrip(await fundingEvidence()));
    expect(verdict(checks)).toBe("MATCH");
    expect(outcomes(checks)).toMatchObject({ "intent hash": "match", "calldata hash": "match", tier: "match", intent: "match", "inputs hash": "match" });
  });

  it("a different allowance read at the time of the decision shows in the inputs hash", async () => {
    const e = await fundingEvidence();
    const r = e.replay as Extract<PdrEvidence["replay"], { kind: "funding" }>;
    const context = { ...r.context, allowance: { ...r.context.allowance, remaining: 49_000_000_000n } };
    expect(failed(await verifyEvidence(roundTrip({ ...e, replay: { ...r, context } })))).toEqual(["inputs hash"]);
  });

  it("calldata swapped in the evidence no longer matches the signed hash", async () => {
    const e = await fundingEvidence();
    expect(failed(await verifyEvidence(roundTrip({ ...e, calldata: "0xdeadbeef" })))).toEqual(["calldata hash"]);
  });

  it("other policy parameters are another policy hash", async () => {
    const e = await fundingEvidence();
    const replay = { ...e.replay!, policy: tradePolicy(word("roles-config-v1"), { ...policy.funding, amountToleranceBps: 5000 }) };
    expect(failed(await verifyEvidence(roundTrip({ ...e, replay })))).toContain("policy hash");
  });
});

describe("keel verify: a Keel Personal payment executed by the real PDRGate", () => {
  const OWNER = address(0x0e);
  const RECIPIENT = address(0xb0b);
  const AGENT_ROLE = word("AGENTE");
  const POLICY_HASH = word("rules-v1|roles-config-v1");
  const NOW = 1_762_000_000;
  const cosigner = privateKeyToAccount(word("test cosigner"));
  let artifacts: ReturnType<typeof compile>;
  let chain: Awaited<ReturnType<typeof createChain>>;
  let gate: Hex;

  beforeAll(() => {
    artifacts = compile(["src/PDRGate.sol", "test/mocks/Mocks.sol"]);
  }, 120_000);

  beforeEach(async () => {
    chain = await createChain(artifacts);
    const usdc = await chain.deploy("MockUSDC", [], OWNER);
    const safe = await chain.deploy("MockSafe", [OWNER], OWNER);
    const roles = await chain.deploy("MockRoles", [safe, usdc, 300_000_000n, 30n * 24n * 3600n], OWNER);
    gate = await chain.deploy("PDRGate", [safe, roles, usdc, AGENT_ROLE, policySigner.address, cosigner.address, POLICY_HASH], OWNER);
    await chain.send("MockSafe", safe, "enableModule", [roles], OWNER);
    await chain.send("MockSafe", safe, "exec", [roles, chain.calldata("MockRoles", "assignRole", [AGENT_ROLE, gate, true])], OWNER);
    await chain.send("MockSafe", safe, "exec", [roles, chain.calldata("MockRoles", "setAllowlisted", [RECIPIENT, true])], OWNER);
    await chain.send("MockUSDC", usdc, "mint", [safe, 1_000_000_000n], OWNER);
  });

  async function pay(): Promise<{ evidence: PdrEvidence; facts: ChainFacts }> {
    const intent: PaymentIntent = {
      aliasId: 2,
      recipient: RECIPIENT,
      amountUsdc: 45_300_000n,
      invoiceKey: word("invoice 1"),
      deadline: BigInt(NOW + 3 * 24 * 3600),
      nonce: 1n,
    };
    const pdr = await issuePaymentPdr({
      intent,
      tier: 1,
      policyHash: POLICY_HASH,
      inputsHash: word("fx:950.12|bcch|buda|allowlist-v3"),
      now: NOW,
      ttlSeconds: 15 * 60,
      domain: keelDomain(1, gate),
      signer: policySigner,
    });
    const logs = await chain.send("PDRGate", gate, "execute", [pdr.intent, pdr.decision, pdr.signature, "0x"], address(0x7e));
    const { intent: i, calldata, ...signed } = pdr;
    const evidence: PdrEvidence = { mode: "personal", issuedAt: NOW, ...signed, intent: i, calldata, rules: [] };
    return { evidence, facts: { chainId: 1, status: "success", logs } };
  }

  it("goes from the transaction logs to the evidence file and checks the event against the decision", async () => {
    const { evidence, facts } = await pay();
    const dir = mkdtempSync(join(tmpdir(), "keel-verify-"));
    saveEvidence(dir, evidence);

    const found = candidateHashes(facts).map((h) => loadEvidence(dir, h)).filter((e) => e !== null);
    expect(found.map((e) => e.pdrHash)).toEqual([evidence.pdrHash]);

    const checks = await verifyEvidence(found[0]!, facts);
    expect(verdict(checks)).toBe("MATCH");
    expect(outcomes(checks)).toMatchObject({
      "intent hash": "match",
      "calldata hash": "match",
      "event contract": "match",
      "event intent hash": "match",
      "event tier": "match",
      replay: "skipped",
    });
  });

  it("the evidence of a payment is not proof of another transaction or another chain", async () => {
    const { evidence, facts } = await pay();
    const e = roundTrip(evidence);
    expect(failed(await verifyEvidence(e, { ...facts, chainId: 84532 }))).toEqual(["chain id"]);
    expect(failed(await verifyEvidence(e, { ...facts, logs: [] }))).toEqual(["event"]);
    expect(failed(await verifyEvidence(e, { ...facts, status: "reverted" }))).toEqual(["transaction"]);
  });

  it("there is no evidence for a hash that was never issued", () => {
    expect(loadEvidence(mkdtempSync(join(tmpdir(), "keel-verify-")), word("nothing"))).toBeNull();
  });
});
