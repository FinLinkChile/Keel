// Shared pieces of the carrier and arbiter command-line tools (carrier-attest.ts, arbiter-resolve.ts):
// the key from the environment, the deployment's public setup and a signed request to the Keel API.
// The key is read from the environment only, never from an argument or a file, and never printed.
import { parseArgs, type ParseArgsConfig } from "node:util";
import { API_HEADERS, type Hex } from "@keel/schemas";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { apiRequestTypedData } from "../src/auth";

export class CliError extends Error {}

// node:util parseArgs, with its errors (unknown option, missing value) as CliErrors
export function parseCli<T extends ParseArgsConfig>(config: T): ReturnType<typeof parseArgs<T>> {
  try {
    return parseArgs(config);
  } catch (e) {
    throw new CliError((e as Error).message);
  }
}

export function accountFromEnv(name: string, env: NodeJS.ProcessEnv = process.env): PrivateKeyAccount {
  const raw = env[name]?.trim();
  if (!raw) throw new CliError(`${name} is not set`);
  const key = (raw.startsWith("0x") ? raw : `0x${raw}`) as Hex;
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new CliError(`${name} is not a 32-byte hex private key`);
  return privateKeyToAccount(key);
}

export function apiUrlFrom(value: string | undefined, env: NodeJS.ProcessEnv = process.env): string {
  const url = (value ?? env.KEEL_API_URL)?.trim();
  if (!url) throw new CliError("pass --api <url> or set KEEL_API_URL");
  if (!/^https?:\/\//.test(url)) throw new CliError(`not an http(s) URL: ${url}`);
  return url.replace(/\/+$/, "");
}

export const ORDER_ID = /^0x[0-9a-fA-F]{64}$/;

export function orderIdArg(value: string | undefined): Hex {
  if (!value || !ORDER_ID.test(value)) throw new CliError("--order must be a 0x-prefixed bytes32 order id");
  return value.toLowerCase() as Hex;
}

// Wire JSON of the API: bigints as decimal strings
export const toWire = (value: unknown): string => JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v));

export interface TradeSetup {
  chainId: number;
  escrow: Hex;
  safe: Hex;
}

export type FetchFn = typeof fetch;

async function reply(res: Response): Promise<unknown> {
  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
    throw new CliError(`API ${res.status}: ${typeof b.error === "string" ? b.error : "error"}${Object.keys(b).length > 1 ? ` ${JSON.stringify(b)}` : ""}`);
  }
  return body;
}

export async function tradeSetup(api: string, fetchFn: FetchFn = fetch): Promise<TradeSetup> {
  return (await reply(await fetchFn(`${api}/trade-setup`))) as TradeSetup;
}

// A request signed as an ApiRequest (aws/src/auth.ts) by `account`
export async function signedRequest(
  api: string,
  account: PrivateKeyAccount,
  chainId: number,
  method: "GET" | "POST",
  path: string,
  payload?: unknown,
  fetchFn: FetchFn = fetch,
  now: () => number = Date.now,
): Promise<unknown> {
  const body = payload === undefined ? "" : toWire(payload);
  const issuedAt = Math.floor(now() / 1000);
  const signature = await account.signTypedData(apiRequestTypedData(chainId, method, path, body, issuedAt));
  const headers: Record<string, string> = {
    [API_HEADERS.signer]: account.address,
    [API_HEADERS.signature]: signature,
    [API_HEADERS.issuedAt]: String(issuedAt),
    ...(payload !== undefined && { "content-type": "application/json" }),
  };
  return reply(await fetchFn(`${api}${path}`, { method, headers, ...(payload !== undefined && { body }) }));
}

// Runs a tool's main and turns a CliError into a message and exit code 1, without a stack trace
export function run(main: () => Promise<void>) {
  main().catch((e: unknown) => {
    console.error(e instanceof CliError ? `error: ${e.message}` : e);
    process.exit(1);
  });
}
