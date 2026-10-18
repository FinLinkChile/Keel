import { describe, expect, it } from "vitest";
import { parseDeployment } from "../config";
import { resolveDeployment } from "./deployment";
import bundled from "../../../contracts/deployments/84532.json";

const low = (a: string) => a.toLowerCase();
const ssm = (over: Record<string, string> = {}) =>
  parseDeployment({ "chain-id": "84532", escrow: bundled.tradeEscrow, safe: bundled.safe, "funding-gate": bundled.fundingGate, "deploy-block": String(bundled.deployBlock), ...over });

describe("runtime deployment: the bundled file, completed and never contradicted by SSM", () => {
  it("takes addresses, deploy block, allowance keys and policy signer from the bundled file", () => {
    const d = resolveDeployment(84532, undefined, {});
    expect(d).toMatchObject({
      chainId: 84532,
      escrow: low(bundled.tradeEscrow),
      safe: low(bundled.safe),
      fundingGate: low(bundled.fundingGate),
      deployBlock: BigInt(bundled.deployBlock),
      policySigner: bundled.policySigner,
    });
    expect(d.settings.file?.agentAllowanceKey).toBe(bundled.trade.agentAllowanceKey);
    // SSM that agrees changes nothing
    expect(resolveDeployment(84532, ssm(), {})).toMatchObject({ escrow: low(bundled.tradeEscrow), deployBlock: BigInt(bundled.deployBlock) });
  });

  it("fails when SSM contradicts the file", () => {
    expect(() => resolveDeployment(84532, ssm({ escrow: `0x${"1".repeat(40)}` }), {})).toThrow("KEEL_ESCROW differs from 84532.json");
    expect(() => resolveDeployment(84532, ssm({ "funding-gate": `0x${"2".repeat(40)}` }), {})).toThrow("KEEL_FUNDING_GATE differs");
    expect(() => resolveDeployment(84532, ssm({ "deploy-block": "1" }), {})).toThrow("deploy-block differs");
    expect(() => resolveDeployment(1, ssm(), {})).toThrow("SSM chain-id 84532 is not KEEL_CHAIN_ID 1");
  });

  it("a chain with no bundled file runs on SSM alone", () => {
    const local = parseDeployment({ "chain-id": "31337", escrow: `0x${"e".repeat(40)}`, safe: `0x${"5".repeat(40)}`, "deploy-block": "7" });
    expect(resolveDeployment(31337, local, {})).toMatchObject({ escrow: `0x${"e".repeat(40)}`, deployBlock: 7n });
    expect(resolveDeployment(31337, local, {}).fundingGate).toBeUndefined();
    expect(() => resolveDeployment(31337, undefined, {})).toThrow("set KEEL_ESCROW");
  });
});
