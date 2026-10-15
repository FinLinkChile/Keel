import { EIP712_TYPES, type Hex, keelDomain, type PolicyDecision } from "@keel/schemas";
import { keccak256, recoverTypedDataAddress, toBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { assertSeparateKeys, KEY_ENV, KeyError, loadPolicySigner } from "./keys";

const key = (label: string): Hex => keccak256(toBytes(label));
const POLICY = key("policy");
const RELAYER = key("relayer");
const COSIGNER = key("cosigner");
const env = { POLICY_SIGNER_PRIVATE_KEY: POLICY, RELAYER_PRIVATE_KEY: RELAYER, COSIGNER_PRIVATE_KEY: COSIGNER };

const domain = keelDomain(1, `0x${"11".repeat(20)}`);
const decision: PolicyDecision = {
  intentHash: key("i"),
  calldataHash: key("c"),
  policyHash: key("p"),
  inputsHash: key("in"),
  tier: 1,
  expiresAt: 1n,
};
const typedDecision = { domain, types: { PolicyDecision: EIP712_TYPES.PolicyDecision }, primaryType: "PolicyDecision" as const, message: decision };

describe("policy signer custody (T2.7)", () => {
  it("signs a policy decision that recovers to the policy address", async () => {
    const signer = loadPolicySigner(env);
    const signature = await signer.signTypedData(typedDecision);
    expect(await recoverTypedDataAddress({ ...typedDecision, signature })).toBe(privateKeyToAccount(POLICY).address);
  });

  it("refuses to sign any other typed data, such as a purchase order", () => {
    const signer = loadPolicySigner(env);
    const order = { domain, types: { PurchaseOrder: EIP712_TYPES.PurchaseOrder }, primaryType: "PurchaseOrder" as const, message: {} };
    expect(() => signer.signTypedData(order as never)).toThrow("only signs PolicyDecision and DocumentDecision");
  });

  it("exposes only its address and typed data signing: no transactions, no plain messages", () => {
    expect(Object.keys(loadPolicySigner(env)).sort()).toEqual(["address", "signTypedData"]);
  });

  it("fails before issuing anything when the key is not the one registered on chain", () => {
    expect(() => loadPolicySigner(env, privateKeyToAccount(POLICY).address)).not.toThrow();
    expect(() => loadPolicySigner(env, privateKeyToAccount(RELAYER).address)).toThrow("not the policy signer registered on chain");
  });

  it("names the missing or malformed variable without ever showing its value", () => {
    expect(() => loadPolicySigner({})).toThrow(`${KEY_ENV.policySigner} is not set`);
    const leaked = "0xdeadbeef-not-a-key";
    try {
      loadPolicySigner({ POLICY_SIGNER_PRIVATE_KEY: leaked });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(KeyError);
      expect((error as Error).message).not.toContain(leaked);
    }
  });
});

describe("one key per role", () => {
  it("accepts three different keys, or only some of them", () => {
    expect(() => assertSeparateKeys(env)).not.toThrow();
    expect(() => assertSeparateKeys({ POLICY_SIGNER_PRIVATE_KEY: POLICY })).not.toThrow();
  });

  it.each([
    ["relayer", { ...env, RELAYER_PRIVATE_KEY: POLICY }],
    ["cosigner", { ...env, COSIGNER_PRIVATE_KEY: POLICY }],
  ])("rejects the policy key reused as the %s key", (_role, shared) => {
    expect(() => loadPolicySigner(shared)).toThrow("are the same key");
  });

  it("rejects the relayer key reused as the cosigner key", () => {
    expect(() => assertSeparateKeys({ ...env, COSIGNER_PRIVATE_KEY: RELAYER })).toThrow("are the same key");
  });
});
