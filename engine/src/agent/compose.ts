// Composition of the agent service: from a deployment (contracts/deployments/<chainId>.json, Area 1)
// and the settings that complete it, to an Agent wired to its Trade gate, Roles allowance and
// policy. `keel agent` (../cli.ts) and the agent Lambda (aws/src/handlers/agent.ts) both build the
// agent here, so the gate, the rolesConfigHash and the checks that refuse a wrong deployment are
// the same wherever the agent runs.
import type { Hex } from "@keel/schemas";
import { tradeRolesConfigHash } from "@keel/schemas/hash";
import { isAddress, isHash } from "viem";
import type { PolicySigner } from "../pdr";
import { tradePolicy } from "../policy";
import type { Deployment } from "../verify";
import { Agent, type AgentChain, type AgentConfig, type AgentDeps } from "./agent";
import { fundingGatePort, gateDeployment, mockRolesAllowance, readRolesAllowance, zodiacRolesAllowance } from "./gate";
import type { AgentStore } from "./store";

// A deployment or a setting that cannot run the agent. The CLI prints the message as is.
export class ConfigurationError extends Error {}

export type Settings = Partial<Record<string, string | undefined>>;

// The addresses and allowance keys of the chain's deployment. The settings (the environment of the
// CLI, SSM parameters on AWS) fill what the file lacks, as on a local chain, and may not contradict
// it: a stale KEEL_ESCROW would run the agent on another escrow. `source` names where the file
// came from in the messages, such as the deployments directory.
export function deploymentSettings(file: Deployment | null, settings: Settings, chainId: number, source: string) {
  function setting(name: string, fromFile: Hex | undefined, check: (v: string) => boolean): Hex | undefined {
    const set = settings[name] || undefined;
    if (set !== undefined && !check(set)) throw new ConfigurationError(`${name} is not valid`);
    if (fromFile && set && set.toLowerCase() !== fromFile) throw new ConfigurationError(`${name} differs from ${chainId}.json in ${source} (${fromFile}): unset it`);
    return fromFile ?? (set as Hex | undefined);
  }
  const required = (name: string, fromFile: Hex | undefined, check: (v: string) => boolean): Hex => {
    const v = setting(name, fromFile, check);
    if (!v) throw new ConfigurationError(`set ${name}, or deploy and record ${chainId}.json in ${source}`);
    return v;
  };
  return { file, settings, setting, required };
}

export type DeploymentSettings = ReturnType<typeof deploymentSettings>;

// The escrow and the importer Safe the agent works for. Read before anything else is built, so a
// missing address is reported first.
export function agentAddresses(d: DeploymentSettings): { escrow: Hex; safe: Hex } {
  return { escrow: d.required("KEEL_ESCROW", d.file?.tradeEscrow, isAddress), safe: d.required("KEEL_SAFE", d.file?.safe, isAddress) };
}

export interface ComposeAgentInput {
  chainId: number;
  deployment: DeploymentSettings;
  escrow: Hex;
  safe: Hex;
  chain: AgentChain;
  store: AgentStore;
  // A function when loading the key can fail: it runs once the deployment checks passed
  signer: PolicySigner | (() => PolicySigner);
  evidenceDir: string;
  notify?: AgentDeps["notify"];
  saveEvidence?: AgentDeps["saveEvidence"];
  decisionTtlSeconds?: number;
}

// The Trade gate (Area 1) and the policy. Without a gate, funding waits with GATE_NOT_DEPLOYED.
// With the gate and the allowance keys the gate runs on the real Zodiac Roles and the
// rolesConfigHash is computed from the chain; otherwise (the demo on MockTradeRoles, or no gate)
// KEEL_ROLES_CONFIG_HASH gives it.
export async function composeAgent(input: ComposeAgentInput): Promise<{ agent: Agent; config: AgentConfig; gate?: ReturnType<typeof fundingGatePort> }> {
  const { deployment: d, chain, escrow, safe } = input;
  const file = d.file;
  const gateAddress = d.setting("KEEL_FUNDING_GATE", file?.fundingGate, isAddress);
  const agentKey = d.setting("KEEL_AGENT_ALLOWANCE_KEY", file?.agentAllowanceKey, isHash);
  const cosignedKey = d.setting("KEEL_COSIGNED_ALLOWANCE_KEY", file?.cosignedAllowanceKey, isHash);
  if (Boolean(agentKey) !== Boolean(cosignedKey)) throw new ConfigurationError("set both KEEL_AGENT_ALLOWANCE_KEY and KEEL_COSIGNED_ALLOWANCE_KEY, or neither");
  const configured = d.settings.KEEL_ROLES_CONFIG_HASH as Hex | undefined;
  if (configured && !isHash(configured)) throw new ConfigurationError("KEEL_ROLES_CONFIG_HASH is not a bytes32");
  let gate: ReturnType<typeof fundingGatePort> | undefined;
  let rolesConfigHash = configured;
  if (gateAddress && agentKey) {
    // Real Zodiac Roles: the hash is rebuilt from the deployment (TradeRolesConfig), so the PDR
    // names the configuration the chain holds. Caps and period come from each allowance, which
    // TradeRolesConfig sets as setAllowance(key, cap, cap, cap, period, 0).
    const deployment = await gateDeployment(chain, gateAddress);
    const agentAllowance = await readRolesAllowance(chain, deployment.roles, agentKey);
    const cosignedAllowance = await readRolesAllowance(chain, deployment.roles, cosignedKey!);
    for (const a of [agentAllowance, cosignedAllowance]) {
      if (a.refill !== a.maxRefill) throw new ConfigurationError("a Roles allowance is not the Keel Trade configuration (refill differs from maxRefill)");
    }
    if (agentAllowance.period !== cosignedAllowance.period) throw new ConfigurationError("the two Roles allowances have different periods");
    const computed = tradeRolesConfigHash({
      token: deployment.token,
      escrow,
      gate: gateAddress,
      agentRole: deployment.agentRoleKey,
      cosignedRole: deployment.cosignedRoleKey,
      agentAllowanceKey: agentKey,
      cosignedAllowanceKey: cosignedKey!,
      agentCap: agentAllowance.refill,
      cosignedCap: cosignedAllowance.refill,
      period: agentAllowance.period,
    });
    if (configured && configured.toLowerCase() !== computed) throw new ConfigurationError(`KEEL_ROLES_CONFIG_HASH does not match the deployment (${computed})`);
    rolesConfigHash = computed;
    gate = fundingGatePort(chain, gateAddress, zodiacRolesAllowance(chain, deployment.roles, agentKey));
  } else if (gateAddress) {
    // The demo: MockTradeRoles keys each allowance by its role key
    const { roles, agentRoleKey } = await gateDeployment(chain, gateAddress);
    gate = fundingGatePort(chain, gateAddress, mockRolesAllowance(chain, roles, agentRoleKey));
  }
  if (!rolesConfigHash) throw new ConfigurationError("set KEEL_ROLES_CONFIG_HASH, or KEEL_FUNDING_GATE with the allowance keys");
  const config: AgentConfig = {
    chainId: input.chainId,
    escrow,
    safe,
    policy: tradePolicy(rolesConfigHash),
    decisionTtlSeconds: input.decisionTtlSeconds ?? 3600,
    evidenceDir: input.evidenceDir,
  };
  const agent = new Agent(config, {
    chain,
    store: input.store,
    gate,
    signer: typeof input.signer === "function" ? input.signer() : input.signer,
    ...(input.notify && { notify: input.notify }),
    ...(input.saveEvidence && { saveEvidence: input.saveEvidence }),
  });
  return { agent, config, gate };
}
