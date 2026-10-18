import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type FundIntent, type Hex, keelDomain, type PaymentIntent, type PolicyDecision } from "@keel/schemas";
import { structHash } from "@keel/schemas/hash";
import { encodeAbiParameters, encodeEventTopics, encodeFunctionData, erc20Abi, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { evaluateFunding } from "./funding";
import { buildPolicyDecision, issueDocumentPdr, issuePaymentPdr, type PdrEvidence, saveEvidence, serializeEvidence, signPolicyDecision } from "./pdr";
import { TRADE_RULES_VERSION, tradePolicy, tradePolicyHash } from "./policy";
import { compile, createChain } from "./testing/chain";
import { address, attestation, documentContext, extractions, fundingContext, order, word } from "./testing/fixtures";
import {
  type ChainFacts,
  type ChainLog,
  type ChainReader,
  type Check,
  candidateHashes,
  knownLogs,
  loadDeployment,
  loadEvidence,
  parseEvidence,
  verdict,
  verifyEvidence,
} from "./verify";

const ESCROW = address(0xe5c0);
const GATE = address(0x6a7e);
const OTHER = address(0xbad);
// The Safe the Trade gate serves: the fixture order is its order
const SAFE = order.importer;
const verifierKey = privateKeyToAccount(word("test document verifier"));
const policySigner = privateKeyToAccount(word("test policy signer"));
const forger = privateKeyToAccount(word("not a key Keel trusts"));
const policy = tradePolicy(word("roles-config-v1"));
const verifiedOrder = { ...order, documentVerifier: verifierKey.address };

const EVENTS = parseAbi([
  "event BalanceReleased(bytes32 indexed orderId, address indexed to, uint256 amount, bytes32 authorizationDigest)",
  "event FundingExecuted(bytes32 indexed intentHash, bytes32 pdrHash, uint8 tier, bytes32 indexed orderId)",
]);

// The verifier always reads the evidence back from its file, as `keel verify` does
const roundTrip = (e: PdrEvidence) => parseEvidence(serializeEvidence(e));
const outcomes = (checks: readonly Check[]) => Object.fromEntries(checks.map((c) => [c.check, c.outcome]));
const failed = (checks: readonly Check[]) => checks.filter((c) => c.outcome === "mismatch").map((c) => c.check);

// What the chain says at the block of the transaction: the gate's policy signer, its Safe, the
// parties it holds as VERIFIER and the order
const reader = (over: Partial<{ policySigner: Hex; documentVerifier: Hex; gateSafe: Hex; verifiers: Hex[] }> = {}): ChainReader => ({
  policySigner: async () => over.policySigner ?? policySigner.address,
  order: async () => ({
    orderHash: structHash("PurchaseOrder", verifiedOrder),
    importer: order.importer,
    documentVerifier: over.documentVerifier ?? verifierKey.address,
  }),
  gateSafe: async () => over.gateSafe ?? SAFE,
  isVerifier: async (_gate, party) => (over.verifiers ?? [verifierKey.address]).some((v) => v.toLowerCase() === party.toLowerCase()),
});

const trade = (logs: ChainLog[], read = reader()): ChainFacts => ({
  chainId: 1,
  status: "success",
  blockNumber: 7n,
  logs,
  deployment: { chainId: 1, fundingGate: GATE, tradeEscrow: ESCROW },
  read,
});

function balanceReleased(digest: Hex, emitter = ESCROW): ChainLog {
  const topics = encodeEventTopics({ abi: EVENTS, eventName: "BalanceReleased", args: { orderId: order.orderId, to: order.payoutAddress } });
  const data = encodeAbiParameters([{ type: "uint256" }, { type: "bytes32" }], [5_000_000_000n, digest]);
  return { address: emitter, topics: topics as Hex[], data };
}

function fundingExecuted(e: PdrEvidence, emitter = GATE): ChainLog {
  const intent = e.intent as FundIntent;
  const topics = encodeEventTopics({ abi: EVENTS, eventName: "FundingExecuted", args: { intentHash: (e.decision as PolicyDecision).intentHash, orderId: intent.orderId } });
  const data = encodeAbiParameters([{ type: "bytes32" }, { type: "uint8" }], [e.pdrHash, 1]);
  return { address: emitter, topics: topics as Hex[], data };
}

async function documentEvidence(signer = verifierKey): Promise<PdrEvidence> {
  const { evidence } = await issueDocumentPdr({
    // A forger also writes an order that names it as the verifier: the engine signs nothing else
    order: { ...order, documentVerifier: signer.address },
    attestation,
    extractions,
    context: documentContext,
    policy,
    domain: keelDomain(1, ESCROW),
    signer,
  });
  return evidence!;
}

async function fundingEvidence(signer = policySigner): Promise<PdrEvidence> {
  const out = evaluateFunding(order, fundingContext, policy.funding);
  const intent = out.intent!;
  // What FundingGate executes and binds: abi.encode(approveData, fundData)
  const calldata = encodeAbiParameters(
    [{ type: "bytes" }, { type: "bytes" }],
    [
      encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [intent.escrow, intent.amount] }),
      encodeFunctionData({ abi: parseAbi(["function fund(bytes32 orderId)"]), functionName: "fund", args: [intent.orderId] }),
    ],
  );
  const decision = buildPolicyDecision({
    intentHash: structHash("FundIntent", intent),
    calldata,
    policyHash: tradePolicyHash(policy),
    inputsHash: out.inputsHash,
    tier: 1,
    expiresAt: intent.deadline,
  });
  const signed = await signPolicyDecision(decision, keelDomain(1, GATE), signer);
  return {
    mode: "trade",
    issuedAt: fundingContext.now,
    ...signed,
    intent,
    calldata,
    rules: out.rules,
    replay: { kind: "funding", policy, order, context: fundingContext },
  };
}

describe("keel verify: document decision of trigger 2", () => {
  it("an untouched evidence file replays to the same decision, but alone it is evidence only", async () => {
    const checks = await verifyEvidence(roundTrip(await documentEvidence()));
    expect(verdict(checks)).toBe("EVIDENCE ONLY");
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
    expect(failed(await verifyEvidence(roundTrip({ ...e, decision })))).toEqual(expect.arrayContaining(["pdr hash", "signature", "decision"]));
  });

  it("a decision made with another version of the rules is not replayed with this one", async () => {
    const e = await documentEvidence();
    const replay = { ...e.replay!, policy: { ...policy, rulesVersion: "keel-trade/0" } };
    const checks = await verifyEvidence(roundTrip({ ...e, replay }));
    expect(checks.find((c) => c.check === "replay")).toMatchObject({ outcome: "skipped" });
    expect(checks.find((c) => c.check === "replay")!.note).toContain(TRADE_RULES_VERSION);
  });

  it("anchored: the deployed escrow released the balance on this decision, signed by the order's verifier", async () => {
    const e = await documentEvidence();
    const facts = trade([balanceReleased(e.pdrHash)]);
    expect(candidateHashes(facts)).toEqual([e.pdrHash.toLowerCase()]);
    const checks = await verifyEvidence(roundTrip(e), facts);
    expect(verdict(checks)).toBe("MATCH");
    expect(outcomes(checks)).toMatchObject({
      "verifying contract": "match",
      event: "match",
      "event order": "match",
      "signer on chain": "match",
      "order on chain": "match",
      "importer is the gate's safe": "match",
      "verifier held by the gate": "match",
    });
  });

  it("a self-made order on the real escrow, outside Keel's Safe and with its own verifier, is not a MATCH", async () => {
    // The re-review's attack: TradeEscrow.open is permissionless, so the order names the
    // attacker's key as verifier and the escrow accepts its DocumentDecision
    const selfMade = await documentEvidence(forger);
    const own = { ...order, documentVerifier: forger.address };
    const read: ChainReader = {
      ...reader({ gateSafe: address(0x5afe) }),
      order: async () => ({ orderHash: structHash("PurchaseOrder", own), importer: order.importer, documentVerifier: forger.address }),
    };
    const checks = await verifyEvidence(roundTrip(selfMade), trade([balanceReleased(selfMade.pdrHash)], read));
    expect(outcomes(checks)).toMatchObject({ "signer on chain": "match", "order on chain": "match" });
    expect(verdict(checks)).toBe("MISMATCH");
    expect(failed(checks)).toEqual(["importer is the gate's safe", "verifier held by the gate"]);
  });

  it("an order of Keel's Safe whose verifier the gate does not hold is not a MATCH", async () => {
    const e = await documentEvidence();
    const checks = await verifyEvidence(roundTrip(e), trade([balanceReleased(e.pdrHash)], reader({ verifiers: [] })));
    expect(failed(checks)).toEqual(["verifier held by the gate"]);
  });

  it("without the gate in the deployment file a balance release is not Keel's", async () => {
    const e = await documentEvidence();
    const facts = trade([balanceReleased(e.pdrHash)]);
    const checks = await verifyEvidence(roundTrip(e), { ...facts, deployment: { chainId: 1, tradeEscrow: ESCROW } });
    expect(failed(checks)).toEqual(["keel order"]);
  });

  it("a forged file signed by any key, emitted by any contract, is not a MATCH", async () => {
    // The review's attack: arbitrary key, a contract of its own that emits the hash
    const forged = await documentEvidence(forger);
    const own = await verifyEvidence(roundTrip(forged), trade([balanceReleased(forged.pdrHash, OTHER)]));
    expect(verdict(own)).toBe("MISMATCH");
    expect(failed(own)).toEqual(["event"]);
    // It says where the event came from, not that the evidence is missing
    expect(own.find((c) => c.check === "event")!.note).toContain(`comes from ${OTHER}`);
    expect(candidateHashes(trade([balanceReleased(forged.pdrHash, OTHER)]))).toEqual([]);

    // Even through the real escrow, the order it holds names another verifier
    const viaEscrow = await verifyEvidence(roundTrip(forged), trade([balanceReleased(forged.pdrHash)]));
    expect(failed(viaEscrow)).toEqual(["signer on chain", "order on chain"]);
    expect(knownLogs(trade([balanceReleased(forged.pdrHash, OTHER)]))).toMatchObject([{ pdrHash: forged.pdrHash.toLowerCase(), emitter: OTHER, anchored: false }]);
  });

  it("selects the log by emitter and event, not by any word that carries the hash", async () => {
    const e = await documentEvidence();
    const decoy: ChainLog = { address: OTHER, topics: [word("Unrelated(bytes32)"), e.pdrHash], data: "0x" };
    const checks = await verifyEvidence(roundTrip(e), trade([decoy, balanceReleased(e.pdrHash)]));
    expect(verdict(checks)).toBe("MATCH");
  });

  it("without the deployment file of the chain nothing is anchored", async () => {
    const e = await documentEvidence();
    const checks = await verifyEvidence(roundTrip(e), { ...trade([balanceReleased(e.pdrHash)]), deployment: null });
    expect(failed(checks)).toEqual(["deployment"]);
  });

  it("the replayed order must be the one the escrow holds", async () => {
    const e = await documentEvidence();
    const facts = trade([balanceReleased(e.pdrHash)], { ...reader(), order: async () => ({ orderHash: word("other order"), importer: order.importer, documentVerifier: verifierKey.address }) });
    expect(failed(await verifyEvidence(roundTrip(e), facts))).toEqual(["order on chain"]);
  });
});

describe("keel verify: funding decision", () => {
  it("an untouched evidence file replays to the same tier, intent and inputs", async () => {
    const checks = await verifyEvidence(roundTrip(await fundingEvidence()));
    expect(verdict(checks)).toBe("EVIDENCE ONLY");
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

  it("anchored: FundingExecuted of the deployed gate, signed by the gate's policy signer at that block", async () => {
    const e = await fundingEvidence();
    const checks = await verifyEvidence(roundTrip(e), trade([fundingExecuted(e)]));
    expect(verdict(checks)).toBe("MATCH");
    expect(outcomes(checks)).toMatchObject({ event: "match", "event intent hash": "match", "event tier": "match", "event order": "match", "signer on chain": "match" });
  });

  it("a signer the gate did not hold at that block is not a MATCH", async () => {
    const e = await fundingEvidence();
    const rotated = await verifyEvidence(roundTrip(e), trade([fundingExecuted(e)], reader({ policySigner: OTHER })));
    expect(failed(rotated)).toEqual(["signer on chain"]);
  });
});

describe("keel verify: the deployment file", () => {
  it("reads the official addresses of a chain, and nothing when the file is missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "keel-deployments-"));
    writeFileSync(join(dir, "84532.json"), JSON.stringify({ chainId: 84532, pdrGate: GATE, fundingGate: GATE.toUpperCase().replace("0X", "0x"), safe: OTHER, tradeEscrow: "not an address" }));
    expect(loadDeployment(dir, 84532)).toEqual({ chainId: 84532, pdrGate: GATE, fundingGate: GATE, tradeEscrow: undefined, safe: OTHER });
    expect(loadDeployment(dir, 1)).toBeNull();
  });

  it("reads what the agent runs on from the shape DeployTrade records", () => {
    const dir = mkdtempSync(join(tmpdir(), "keel-deployments-"));
    const agentKey = word("agent allowance");
    const cosignedKey = word("cosigned allowance");
    writeFileSync(
      join(dir, "84532.json"),
      JSON.stringify({ chainId: 84532, pdrGate: null, fundingGate: GATE, tradeEscrow: ESCROW, safe: OTHER, deployBlock: 48233746, trade: { agentAllowanceKey: agentKey, cosignedAllowanceKey: cosignedKey, saltNonce: "43036773539347174997" } }),
    );
    expect(loadDeployment(dir, 84532)).toEqual({
      chainId: 84532,
      fundingGate: GATE,
      tradeEscrow: ESCROW,
      safe: OTHER,
      deployBlock: 48233746n,
      agentAllowanceKey: agentKey,
      cosignedAllowanceKey: cosignedKey,
    });
  });

  it("refuses a file whose chainId is not the one of its name", () => {
    const dir = mkdtempSync(join(tmpdir(), "keel-deployments-"));
    writeFileSync(join(dir, "84532.json"), JSON.stringify({ chainId: 8453, fundingGate: GATE }));
    writeFileSync(join(dir, "1.json"), JSON.stringify({ fundingGate: GATE }));
    expect(() => loadDeployment(dir, 84532)).toThrow("chainId 8453");
    expect(() => loadDeployment(dir, 1)).toThrow("chainId (none)");
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

  // The policy signer read from the real gate, as the CLI reads it at the block of the transaction
  const gateReader = (): ChainReader => ({
    policySigner: (g) => chain.read<Hex>("PDRGate", g, "policySigner"),
    order: () => Promise.reject(new Error("no escrow in Personal")),
    gateSafe: () => Promise.reject(new Error("no Trade gate in Personal")),
    isVerifier: () => Promise.reject(new Error("no Trade gate in Personal")),
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
    const facts: ChainFacts = { chainId: 1, status: "success", blockNumber: 1n, logs, deployment: { chainId: 1, pdrGate: gate.toLowerCase() as Hex }, read: gateReader() };
    return { evidence, facts };
  }

  it("goes from the transaction logs to the evidence file and anchors it to the gate's signer", async () => {
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
      "verifying contract": "match",
      event: "match",
      "event intent hash": "match",
      "event tier": "match",
      "signer on chain": "match",
      replay: "skipped",
    });
  });

  it("the evidence of a payment is not proof of another transaction or another chain", async () => {
    const { evidence, facts } = await pay();
    const e = roundTrip(evidence);
    expect(failed(await verifyEvidence(e, { ...facts, chainId: 84532 }))).toEqual(["chain id"]);
    expect(failed(await verifyEvidence(e, { ...facts, logs: [] }))).toEqual(["event"]);
    expect(failed(await verifyEvidence(e, { ...facts, status: "reverted" }))).toEqual(["transaction"]);
    expect(failed(await verifyEvidence(e, { ...facts, deployment: { chainId: 1, pdrGate: OTHER } }))).toEqual(["verifying contract", "event"]);
  });

  it("there is no evidence for a hash that was never issued", () => {
    expect(loadEvidence(mkdtempSync(join(tmpdir(), "keel-verify-")), word("nothing"))).toBeNull();
  });
});
