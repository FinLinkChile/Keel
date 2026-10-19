import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Hex, keelDomain, PERSONAL_GATE_ERRORS, PERSONAL_GATE_EVENTS, type PaymentIntent } from "@keel/schemas";
import { domainSeparator, paymentIntentHash } from "@keel/schemas/hash";
import { keccak256, toBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  buildPolicyDecision,
  cosignRequest,
  issuePaymentPdr,
  type PaymentPdrInput,
  paymentCalldata,
  saveEvidence,
  serializeEvidence,
  signPolicyDecision,
} from "./pdr";
import { compile, createChain } from "./testing/chain";

const word = (label: string): Hex => keccak256(toBytes(label));
const address = (n: number): Hex => `0x${n.toString(16).padStart(40, "0")}`;

const OWNER = address(0x0e);
const RELAYER = address(0x7e);
const RECIPIENT = address(0xb0b);
const AGENT_ROLE = word("AGENTE");
const POLICY_HASH = word("rules-v1|roles-config-v1");
const NOW = 1_762_000_000;

const policySigner = privateKeyToAccount(word("test policy signer"));
const cosigner = privateKeyToAccount(word("test cosigner"));
const intruder = privateKeyToAccount(word("not the policy signer"));

// PDRGate is permissionless: anyone relays, authority comes from the signatures.
describe("PDR signature against the real PDRGate (T2.4)", () => {
  let artifacts: ReturnType<typeof compile>;
  let chain: Awaited<ReturnType<typeof createChain>>;
  let gate: Hex;
  let usdc: Hex;
  let nonce = 0n;

  beforeAll(() => {
    artifacts = compile(["src/PDRGate.sol", "test/mocks/Mocks.sol"]);
  }, 120_000);

  // A fresh Safe, Roles, USDC and gate per test, wired as in the deployment script
  beforeEach(async () => {
    chain = await createChain(artifacts);
    usdc = await chain.deploy("MockUSDC", [], OWNER);
    const safe = await chain.deploy("MockSafe", [OWNER], OWNER);
    const roles = await chain.deploy("MockRoles", [safe, usdc, 300_000_000n, 30n * 24n * 3600n], OWNER);
    gate = await chain.deploy(
      "PDRGate",
      [safe, roles, usdc, AGENT_ROLE, policySigner.address, cosigner.address, POLICY_HASH],
      OWNER,
    );
    await chain.send("MockSafe", safe, "enableModule", [roles], OWNER);
    await chain.send("MockSafe", safe, "exec", [roles, chain.calldata("MockRoles", "assignRole", [AGENT_ROLE, gate, true])], OWNER);
    await chain.send("MockSafe", safe, "exec", [roles, chain.calldata("MockRoles", "setAllowlisted", [RECIPIENT, true])], OWNER);
    await chain.send("MockUSDC", usdc, "mint", [safe, 1_000_000_000n], OWNER);
  });

  const intent = (over: Partial<PaymentIntent> = {}): PaymentIntent => ({
    aliasId: 2,
    recipient: RECIPIENT,
    amountUsdc: 45_300_000n,
    invoiceKey: word(`invoice ${++nonce}`),
    deadline: BigInt(NOW + 3 * 24 * 3600),
    nonce,
    ...over,
  });

  const issue = (over: Partial<PaymentPdrInput> = {}) =>
    issuePaymentPdr({
      intent: intent(),
      tier: 1,
      policyHash: POLICY_HASH,
      inputsHash: word("fx:950.12|bcch|buda|allowlist-v3"),
      now: NOW,
      ttlSeconds: 15 * 60,
      domain: keelDomain(1, gate),
      signer: policySigner,
      ...over,
    });

  const execute = (pdr: Awaited<ReturnType<typeof issue>>, sigCosigner: Hex = "0x") =>
    chain.send("PDRGate", gate, "execute", [pdr.intent, pdr.decision, pdr.signature, sigCosigner], RELAYER);

  const balance = () => chain.read<bigint>("MockUSDC", usdc, "balanceOf", [RECIPIENT]);

  it("computes the same domain, intent hash and digest as the contract", async () => {
    const pdr = await issue();
    expect(await chain.read("PDRGate", gate, "domainSeparator")).toBe(domainSeparator(pdr.domain));
    expect(await chain.read("PDRGate", gate, "intentHashOf", [pdr.intent])).toBe(paymentIntentHash(pdr.intent));
    expect(await chain.read("PDRGate", gate, "digestOf", [pdr.decision])).toBe(pdr.pdrHash);
  });

  it("schemas lists exactly the events and errors PDRGate declares", () => {
    const names = (type: string) => artifacts.PDRGate!.abi.filter((x) => x.type === type).map((x) => (x as { name: string }).name).sort();
    expect(names("event")).toEqual([...PERSONAL_GATE_EVENTS].sort());
    expect(names("error")).toEqual([...PERSONAL_GATE_ERRORS].sort());
  });

  it("builds the same calldata the gate builds: a USDC transfer to the intent recipient", () => {
    const i = intent();
    expect(paymentCalldata(i)).toBe(chain.calldata("MockUSDC", "transfer", [i.recipient, i.amountUsdc]));
  });

  it("a tier 1 PDR executes and the payment arrives", async () => {
    await execute(await issue());
    expect(await balance()).toBe(45_300_000n);
  });

  it("the same PDR cannot be used twice", async () => {
    const pdr = await issue();
    await execute(pdr);
    await expect(execute(pdr)).rejects.toThrow("NonceUsed");
  });

  it("an intent changed after signing is rejected, for example a larger amount", async () => {
    const pdr = await issue();
    await expect(execute({ ...pdr, intent: { ...pdr.intent, amountUsdc: 99_000_000n } })).rejects.toThrow("IntentMismatch");
  });

  it("a PDR signed by any key other than the registered policy signer is rejected", async () => {
    await expect(execute(await issue({ signer: intruder }))).rejects.toThrow("BadPolicySignature");
  });

  it("a PDR for another chain or another gate is rejected", async () => {
    await expect(execute(await issue({ domain: keelDomain(84532, gate) }))).rejects.toThrow("BadPolicySignature");
    await expect(execute(await issue({ domain: keelDomain(1, address(0x6a7e)) }))).rejects.toThrow("BadPolicySignature");
  });

  it("a PDR made with an old version of the rules is rejected", async () => {
    await expect(execute(await issue({ policyHash: word("rules-v0") }))).rejects.toThrow("StalePolicy");
  });

  it("a PDR is rejected once it expires", async () => {
    const pdr = await issue();
    chain.setTime(pdr.decision.expiresAt + 1n);
    await expect(execute(pdr)).rejects.toThrow("Expired");
  });

  it("the decision never outlives the intent deadline", async () => {
    const pdr = await issue({ intent: intent({ deadline: BigInt(NOW + 60) }) });
    expect(pdr.decision.expiresAt).toBe(BigInt(NOW + 60));
  });

  it("tier 3 needs the cosigner, who signs the same digest", async () => {
    const pdr = await issue({ tier: 3 });
    await expect(execute(pdr)).rejects.toThrow("MissingCosignature");

    const request = cosignRequest(pdr);
    expect(request.pdrHash).toBe(pdr.pdrHash);
    await execute(pdr, await cosigner.signTypedData(request.typedData));
    expect(await balance()).toBe(45_300_000n);
  });

  it("the policy signer cannot cosign its own tier 3 decision", async () => {
    const pdr = await issue({ tier: 3 });
    await expect(execute(pdr, await policySigner.signTypedData(cosignRequest(pdr).typedData))).rejects.toThrow("MissingCosignature");
  });
});

describe("PDR issuance rules", () => {
  const base = { intentHash: word("i"), calldata: "0xa9059cbb" as Hex, policyHash: word("p"), inputsHash: word("in"), expiresAt: 1n };

  it.each([0, 2, 4] as const)("tier %i never becomes a PDR", (tier) => {
    expect(() => buildPolicyDecision({ ...base, tier })).toThrow("never reaches the gate");
  });

  it("the decision carries the hash of the calldata, never the calldata itself", () => {
    expect(buildPolicyDecision({ ...base, tier: 1 }).calldataHash).toBe(keccak256(base.calldata));
  });

  it("a signer that returns another key's signature fails before anything reaches the chain", async () => {
    const lying = { address: policySigner.address, signTypedData: intruder.signTypedData };
    await expect(signPolicyDecision(buildPolicyDecision({ ...base, tier: 1 }), keelDomain(1, address(1)), lying)).rejects.toThrow(
      "does not recover to the policy signer",
    );
  });

  it("only tier 3 produces a cosignature request", async () => {
    const signed = await signPolicyDecision(buildPolicyDecision({ ...base, tier: 1 }), keelDomain(1, address(1)), policySigner);
    expect(() => cosignRequest(signed)).toThrow("only tier 3");
  });

  it("the evidence file is named by the PDR hash and keeps every field", async () => {
    const decision = buildPolicyDecision({ ...base, tier: 1 });
    const signed = await signPolicyDecision(decision, keelDomain(1, address(1)), policySigner);
    const evidence = {
      mode: "personal" as const,
      issuedAt: NOW,
      ...signed,
      intent: { amountUsdc: 45_300_000n },
      calldata: base.calldata,
      rules: [{ rule: "registered-alias", tier: 1 as const }],
    };
    const path = saveEvidence(mkdtempSync(join(tmpdir(), "keel-pdr-")), evidence);
    expect(path.endsWith(`${signed.pdrHash}.json`)).toBe(true);
    const saved = JSON.parse(readFileSync(path, "utf8"));
    expect(saved.pdrHash).toBe(signed.pdrHash);
    expect(saved.signature).toBe(signed.signature);
    expect(saved.decision.expiresAt).toBe("1");
    expect(saved.intent.amountUsdc).toBe("45300000");
    expect(serializeEvidence(evidence)).toBe(serializeEvidence(evidence));
  });
});
