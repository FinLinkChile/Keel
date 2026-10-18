// Configuration of the Area 1 evidence script: deployments file, keys from the environment and
// command line options. Keys are only turned into viem accounts here; they are never printed,
// logged or written anywhere (the evidence files carry addresses only).
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Hex } from "@keel/schemas";
import { getAddress, isAddress, nonceManager } from "viem";
import { type PrivateKeyAccount, privateKeyToAccount } from "viem/accounts";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

// The demo parties, by the env prefix of their *_ADDRESS (and *_PRIVATE_KEY for signers).
// POLICY_SIGNER_ADDRESS is only an address (the document verifier of the orders).
export const ACTORS = {
  owner: "OWNER",
  exporter: "DEMO_EXPORTER",
  payout: "DEMO_PAYOUT",
  carrier: "DEMO_CARRIER",
  arbiter: "DEMO_ARBITER",
  attacker: "DEMO_ATTACKER",
} as const;
export type Actor = keyof typeof ACTORS;
// The only parties whose keys are ever loaded, and only when a signature or a send needs one.
// DEMO_PAYOUT and DEMO_ARBITER are addresses only: no script signs or sends with them.
export type Signer = Exclude<Actor, "payout" | "arbiter">;

export interface Deployment {
  chainId: number;
  safe: Hex;
  roles: Hex;
  delay: Hex;
  tradeEscrow: Hex;
  fundingGate: Hex;
  usdc: Hex;
}

export interface Options {
  rpcUrl: string;
  // What the reproduce command prints instead of the URL, which may carry an API key
  rpcLabel: string;
  deploymentsFile: string;
  artifactsDir: string;
  outDir: string;
  // Total of every evidence order, USDC minor units (6 decimals)
  amount: bigint;
  advanceBps: number;
  // shipmentDeadline = now + deadlineSeconds
  deadlineSeconds: bigint;
  disputeWindow: bigint;
  // Fixed gas of every transaction that is expected to revert (no estimation)
  revertGas: bigint;
  // Minimum native balance of each sending account, in wei
  minNative: bigint;
  // Required to send to anything that is not a local anvil node
  live: boolean;
}

export class PreconditionError extends Error {
  override name = "PreconditionError";
}

// viem error messages carry the RPC URL (re-serialized, so an exact replace is not enough), and
// a provider URL often has its API key in the path. Every non-local URL is hidden.
export function redactUrls(message: string): string {
  return message.replace(/(?:https?|wss?):\/\/[^\s"'<>]+/gi, (u) => (/^(?:https?|wss?):\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/i.test(u) ? u : "<rpc-url>"));
}

export function loadEnvFile(path: string): void {
  if (existsSync(path)) process.loadEnvFile(path);
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new PreconditionError(`${name} is not set (see .env.example)`);
  return v;
}

export function envAddress(name: string): Hex {
  const v = requireEnv(name);
  if (!isAddress(v)) throw new PreconditionError(`${name} is not an address`);
  return getAddress(v);
}

// Never echoes the value: a malformed key must not end up in a terminal or a log.
export function envAccount(prefix: string): PrivateKeyAccount {
  const keyName = `${prefix}_PRIVATE_KEY`;
  const raw = requireEnv(keyName);
  let account: PrivateKeyAccount;
  try {
    // nonceManager: the next nonce comes from the last one this process used, not only from the
    // RPC, which can still report the old count right after a receipt (seen on Base Sepolia).
    account = privateKeyToAccount((raw.startsWith("0x") ? raw : `0x${raw}`) as Hex, { nonceManager });
  } catch {
    throw new PreconditionError(`${keyName} is not a valid private key`);
  }
  if (envAddress(`${prefix}_ADDRESS`) !== account.address) {
    throw new PreconditionError(`${keyName} does not match ${prefix}_ADDRESS`);
  }
  return account;
}

export function loadAddresses(): Record<Actor, Hex> {
  const out = {} as Record<Actor, Hex>;
  const seen = new Map<string, string>();
  for (const [actor, prefix] of Object.entries(ACTORS) as [Actor, string][]) {
    out[actor] = envAddress(`${prefix}_ADDRESS`);
    const other = seen.get(out[actor]);
    if (other) throw new PreconditionError(`${prefix} and ${other} are the same account`);
    seen.set(out[actor], prefix);
  }
  return out;
}

// Each key is read from the environment the first time it is needed, then kept in memory.
export function signerLoader(): (s: Signer) => PrivateKeyAccount {
  const cache = new Map<Signer, PrivateKeyAccount>();
  return (s) => {
    let acc = cache.get(s);
    if (!acc) {
      acc = envAccount(ACTORS[s]);
      cache.set(s, acc);
    }
    return acc;
  };
}

export function loadDeployment(path: string): Deployment {
  if (!existsSync(path)) throw new PreconditionError(`deployments file not found: ${path}`);
  const j = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  const addr = (k: string): Hex => {
    const v = j[k];
    if (typeof v !== "string" || !isAddress(v)) throw new PreconditionError(`${path}: "${k}" is missing or not an address`);
    return getAddress(v);
  };
  if (typeof j.chainId !== "number") throw new PreconditionError(`${path}: "chainId" is missing`);
  return {
    chainId: j.chainId,
    safe: addr("safe"),
    roles: addr("roles"),
    delay: addr("delay"),
    tradeEscrow: addr("tradeEscrow"),
    fundingGate: addr("fundingGate"),
    usdc: addr("usdc"),
  };
}

export const DEFAULTS = {
  amount: 1_000_000n, // 1 USDC
  advanceBps: 1000, // 10 %: a small advance
  phase1DeadlineSeconds: 7n * 86_400n,
  // open-order: the order of the DeadlinePassed case waits deadline + refundGrace on a real chain
  openOrderDeadlineSeconds: 600n,
  disputeWindow: 3_600n,
  revertGas: 1_000_000n,
  minNative: 200_000_000_000_000n, // 0.0002 ETH
} as const;

export function defaultOutDir(): string {
  return mkdtempSync(join(tmpdir(), "keel-evidence-"));
}

export function defaultDeploymentsFile(chainId: number): string {
  return join(REPO_ROOT, "contracts", "deployments", `${chainId}.json`);
}
