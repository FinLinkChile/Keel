import type { Hex } from "@keel/schemas";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import type { Deployment } from "../verify";
import type { AgentChain } from "./agent";
import { agentAddresses, ConfigurationError, composeAgent, deploymentSettings } from "./compose";
import { FileStore } from "./store";

const address = (n: number): Hex => `0x${n.toString(16).padStart(40, "0")}`;
const ESCROW = address(0xe5);
const SAFE = address(0x5afe);
const file: Deployment = { chainId: 84532, tradeEscrow: ESCROW, safe: SAFE };
const noChain = {} as AgentChain;
const signer = privateKeyToAccount(`0x${"11".repeat(32)}`);

describe("agent composition (shared by keel agent and the agent Lambda)", () => {
  it("the file wins, a setting fills what it lacks and may not contradict it", () => {
    expect(agentAddresses(deploymentSettings(file, {}, 84532, "deployments"))).toEqual({ escrow: ESCROW, safe: SAFE });
    expect(agentAddresses(deploymentSettings(file, { KEEL_ESCROW: ESCROW.toUpperCase().replace("0X", "0x") }, 84532, "deployments")).escrow).toBe(ESCROW);
    expect(() => agentAddresses(deploymentSettings(file, { KEEL_ESCROW: address(0xbad) }, 84532, "deployments"))).toThrow(
      `KEEL_ESCROW differs from 84532.json in deployments (${ESCROW}): unset it`,
    );
    expect(() => agentAddresses(deploymentSettings(null, {}, 31337, "deployments"))).toThrow("set KEEL_ESCROW, or deploy and record 31337.json in deployments");
    expect(agentAddresses(deploymentSettings(null, { KEEL_ESCROW: ESCROW, KEEL_SAFE: SAFE }, 31337, "deployments"))).toEqual({ escrow: ESCROW, safe: SAFE });
    expect(() => agentAddresses(deploymentSettings(null, { KEEL_ESCROW: "not an address" }, 31337, "deployments"))).toThrow(ConfigurationError);
  });

  it("refuses half an allowance pair and an agent with no rolesConfigHash, before the signer loads", async () => {
    const base = { chainId: 31337, escrow: ESCROW, safe: SAFE, chain: noChain, store: new FileStore("missing"), evidenceDir: "evidence" };
    const neverLoaded = () => {
      throw new Error("the signer loaded before the checks");
    };
    const half = deploymentSettings(null, { KEEL_AGENT_ALLOWANCE_KEY: `0x${"22".repeat(32)}` }, 31337, "deployments");
    await expect(composeAgent({ ...base, deployment: half, signer: neverLoaded })).rejects.toThrow(
      "set both KEEL_AGENT_ALLOWANCE_KEY and KEEL_COSIGNED_ALLOWANCE_KEY, or neither",
    );
    const none = deploymentSettings(null, {}, 31337, "deployments");
    await expect(composeAgent({ ...base, deployment: none, signer: neverLoaded })).rejects.toThrow(
      "set KEEL_ROLES_CONFIG_HASH, or KEEL_FUNDING_GATE with the allowance keys",
    );
    // Without a gate, a configured hash is enough: funding waits with GATE_NOT_DEPLOYED
    const configured = deploymentSettings(null, { KEEL_ROLES_CONFIG_HASH: `0x${"33".repeat(32)}` }, 31337, "deployments");
    const { config, gate } = await composeAgent({ ...base, deployment: configured, signer });
    expect(gate).toBeUndefined();
    expect(config).toMatchObject({ chainId: 31337, escrow: ESCROW, safe: SAFE, decisionTtlSeconds: 3600 });
  });
});
