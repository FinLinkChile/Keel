// The deployment the agent, the monitor and the indexer run against. contracts/deployments/<chainId>.json
// (Area 1) is bundled at build time: it is above the 4 KB limit of a standard SSM parameter, and it
// carries what SSM does not (Roles, allowance keys, guardian, policySigner). The SSM values of
// ../config.ts (escrow, safe, funding-gate, deploy-block) override it where the file has nothing and
// may never contradict it, exactly like the environment of `keel agent` (engine/src/agent/compose.ts):
// a stale parameter would run the agent on another escrow.
import type { Hex } from "@keel/schemas";
import { agentAddresses, ConfigurationError, type DeploymentSettings, deploymentSettings, parseDeploymentFile } from "@keel/engine";
import { isAddress } from "viem";
import deployment84532 from "../../../contracts/deployments/84532.json";
import { ConfigError, type Deployment, deployment as ssmDeployment, type Env, required } from "../config";
import { secret } from "../secrets";

// esbuild inlines each file; a chain without one runs on SSM values alone
export const BUNDLED: Record<number, unknown> = { 84532: deployment84532 };

export interface RuntimeDeployment {
  chainId: number;
  // For composeAgent: the file and the SSM overrides, under the names the engine checks
  settings: DeploymentSettings;
  escrow: Hex;
  safe: Hex;
  fundingGate?: Hex;
  // First block worth reading for escrow and gate logs; 0n when nobody recorded it
  deployBlock: bigint;
  // The policy signer the gate and the escrow accept, for loadKeys (../keys.ts)
  policySigner?: Hex;
}

const SOURCE = "the bundled contracts/deployments";

export function resolveDeployment(chainId: number, ssm: Deployment | undefined, env: Env, bundled: Record<number, unknown> = BUNDLED): RuntimeDeployment {
  if (ssm && ssm.chainId !== chainId) throw new ConfigError(`SSM chain-id ${ssm.chainId} is not KEEL_CHAIN_ID ${chainId}`);
  const raw = bundled[chainId] as Record<string, unknown> | undefined;
  const file = raw ? parseDeploymentFile(raw, chainId) : null;
  const settings = deploymentSettings(
    file,
    {
      KEEL_ESCROW: ssm?.escrow,
      KEEL_SAFE: ssm?.safe,
      KEEL_FUNDING_GATE: ssm?.fundingGate,
      // Only for a deployment without a gate (a local chain): with one, the hash comes from the chain
      KEEL_ROLES_CONFIG_HASH: env.KEEL_ROLES_CONFIG_HASH,
    },
    chainId,
    SOURCE,
  );
  const { escrow, safe } = agentAddresses(settings);
  const fundingGate = settings.setting("KEEL_FUNDING_GATE", file?.fundingGate, isAddress);
  // parseDeployment of ../config.ts reads an absent deploy-block as 0
  const fromSsm = ssm && ssm.deployBlock > 0n ? ssm.deployBlock : undefined;
  if (file?.deployBlock !== undefined && fromSsm !== undefined && fromSsm !== file.deployBlock) {
    throw new ConfigurationError(`deploy-block differs from ${chainId}.json in ${SOURCE} (${file.deployBlock}): fix the parameter`);
  }
  const signer = raw?.policySigner;
  return {
    chainId,
    settings,
    escrow,
    safe,
    ...(fundingGate && { fundingGate }),
    deployBlock: file?.deployBlock ?? fromSsm ?? 0n,
    ...(typeof signer === "string" && isAddress(signer) && { policySigner: signer as Hex }),
  };
}

let cached: Promise<RuntimeDeployment> | undefined;

// Once per container. SSM is optional when the bundle has the chain: a missing parameter set is
// the bundle alone, any other SSM failure (AccessDenied, throttling) fails the invocation.
export function runtimeDeployment(env: Env = process.env, readSsm: () => Promise<Deployment> = () => ssmDeployment(env)): Promise<RuntimeDeployment> {
  cached ??= (async () => {
    const chainId = Number(required(env, "KEEL_CHAIN_ID"));
    if (!Number.isInteger(chainId) || chainId <= 0) throw new ConfigError("KEEL_CHAIN_ID is not a chain id");
    let ssm: Deployment | undefined;
    try {
      ssm = await readSsm();
    } catch (e) {
      if (!(e instanceof ConfigError) || !BUNDLED[chainId]) throw e;
    }
    return resolveDeployment(chainId, ssm, env);
  })();
  cached.catch(() => {
    cached = undefined;
  });
  return cached;
}

// The RPC endpoint: KEEL_RPC_URL, or the SecureString rpc_url holding the full URL (its API key
// included), the same names the orders API reads. Never logged.
export const rpcUrl = async (env: Env = process.env): Promise<string> => env.KEEL_RPC_URL ?? (await secret("rpc_url", env));

export function resetRuntimeDeployment() {
  cached = undefined;
}
