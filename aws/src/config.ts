// Runtime configuration of every Lambda. Names of tables, buckets and queues come from the
// environment that Terraform sets (infra/terraform/locals.tf); the deployment (addresses,
// deployBlock, chainId) comes from Systems Manager under /keel/<chainId>/, read once per
// container. Nothing here is a secret: keys and tokens are read by ./keys.ts and ./secrets.ts.
import { GetParametersByPathCommand, SSMClient } from "@aws-sdk/client-ssm";
import type { Hex } from "@keel/schemas";

export type Env = Partial<Record<string, string | undefined>>;

export class ConfigError extends Error {}

export function required(env: Env, name: string): string {
  const value = env[name];
  if (!value) throw new ConfigError(`${name} is not set`);
  return value;
}

// Resource names, all optional: each handler asks only for what it uses
export const TABLE_ENV = {
  proposals: "PROPOSALS_TABLE",
  orders: "ORDERS_TABLE",
  parties: "PARTIES_TABLE",
  agentState: "AGENT_STATE_TABLE",
  ingest: "INGEST_TABLE",
  bot: "BOT_TABLE",
} as const;
export type TableName = keyof typeof TABLE_ENV;

export const table = (name: TableName, env: Env = process.env): string => required(env, TABLE_ENV[name]);

export interface Deployment {
  chainId: number;
  deployBlock: bigint;
  escrow: Hex;
  safe: Hex;
  fundingGate?: Hex;
  // Every other value published under the prefix, by its last path segment
  extra: Record<string, string>;
}

const isAddress = (v: string | undefined): v is Hex => !!v && /^0x[0-9a-fA-F]{40}$/.test(v);

export function parseDeployment(values: Record<string, string>): Deployment {
  const chainId = Number(values["chain-id"]);
  if (!Number.isInteger(chainId) || chainId <= 0) throw new ConfigError("chain-id is missing or invalid");
  const escrow = values["escrow"];
  const safe = values["safe"];
  if (!isAddress(escrow)) throw new ConfigError("escrow is missing or not an address");
  if (!isAddress(safe)) throw new ConfigError("safe is missing or not an address");
  const gate = values["funding-gate"];
  return {
    chainId,
    deployBlock: BigInt(values["deploy-block"] ?? "0"),
    escrow,
    safe,
    ...(isAddress(gate) && { fundingGate: gate }),
    extra: values,
  };
}

let cached: Promise<Deployment> | undefined;

// Reads /keel/<chainId>/* once per container. KEEL_CONFIG_PREFIX overrides the prefix.
export function deployment(env: Env = process.env, ssm: SSMClient = new SSMClient({})): Promise<Deployment> {
  cached ??= (async () => {
    const prefix = env.KEEL_CONFIG_PREFIX ?? `/keel/${required(env, "KEEL_CHAIN_ID")}/`;
    const values: Record<string, string> = {};
    let NextToken: string | undefined;
    do {
      const page = await ssm.send(new GetParametersByPathCommand({ Path: prefix, Recursive: false, NextToken }));
      for (const p of page.Parameters ?? []) {
        if (p.Name && p.Value !== undefined) values[p.Name.slice(prefix.length)] = p.Value;
      }
      NextToken = page.NextToken;
    } while (NextToken);
    return parseDeployment(values);
  })();
  return cached;
}

// For tests
export function resetDeploymentCache() {
  cached = undefined;
}
