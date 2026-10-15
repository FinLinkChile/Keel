// Command line of the engine. T2.9:
//   keel verify <txHash> [--rpc <url>] [--evidence <dir>]   a transaction and every PDR it carries
//   keel verify --pdr <pdrHash> [--evidence <dir>]          one PDR from its evidence file, offline
// Exit code 0 when everything matches, 1 on any mismatch, 2 on a usage or read error.
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type { Hex } from "@keel/schemas";
import { createPublicClient, http, isHash } from "viem";
import { type ChainFacts, type Check, candidateHashes, loadEvidence, verdict, verifyEvidence } from "./verify";

const DEFAULT_EVIDENCE = fileURLToPath(new URL("../../evidence/pdr/", import.meta.url));
const USAGE = "usage: keel verify <txHash> [--rpc <url>] [--evidence <dir>]\n       keel verify --pdr <pdrHash> [--evidence <dir>]";

async function readTransaction(rpc: string, hash: Hex): Promise<ChainFacts> {
  const client = createPublicClient({ transport: http(rpc) });
  const [chainId, receipt] = await Promise.all([client.getChainId(), client.getTransactionReceipt({ hash })]);
  return { chainId, status: receipt.status, logs: receipt.logs };
}

function print(pdrHash: Hex, checks: readonly Check[]) {
  console.log(`PDR ${pdrHash}`);
  for (const c of checks) {
    console.log(`  ${c.outcome.toUpperCase().padEnd(9)} ${c.check}${c.note ? `: ${c.note}` : ""}`);
    if (c.expected !== undefined) console.log(`            expected ${c.expected}\n            actual   ${c.actual}`);
  }
}

async function verify(args: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { rpc: { type: "string" }, evidence: { type: "string" }, pdr: { type: "string" } },
  });
  const dir = values.evidence ?? DEFAULT_EVIDENCE;
  const [tx] = positionals;

  let facts: ChainFacts | undefined;
  let hashes: Hex[];
  if (values.pdr) {
    if (!isHash(values.pdr)) throw new UsageError("--pdr takes a 32-byte hash");
    hashes = [values.pdr];
  } else {
    if (!tx || !isHash(tx)) throw new UsageError(USAGE);
    const rpc = values.rpc ?? process.env.KEEL_RPC_URL;
    if (!rpc) throw new UsageError("set --rpc or KEEL_RPC_URL to read the transaction");
    facts = await readTransaction(rpc, tx);
    console.log(`Transaction ${tx} (chain ${facts.chainId}, ${facts.status})`);
    hashes = candidateHashes(facts);
  }

  const results: Check[][] = [];
  for (const hash of hashes) {
    const evidence = loadEvidence(dir, hash);
    if (!evidence) continue;
    const checks = await verifyEvidence(evidence, facts);
    print(hash, checks);
    results.push(checks);
  }
  if (results.length === 0) {
    console.log(values.pdr ? `No evidence file for ${values.pdr} in ${dir}` : `No PDR of this transaction has evidence in ${dir}`);
    return 1;
  }
  const result = results.some((c) => verdict(c) === "MISMATCH") ? "MISMATCH" : "MATCH";
  console.log(`Result: ${result}`);
  return result === "MATCH" ? 0 : 1;
}

class UsageError extends Error {}

async function main(argv: string[]): Promise<number> {
  const [command, ...args] = argv;
  try {
    if (command === "verify") return await verify(args);
    throw new UsageError(USAGE);
  } catch (e) {
    console.error(e instanceof UsageError ? e.message : `error: ${(e as Error).message}`);
    return 2;
  }
}

process.exitCode = await main(process.argv.slice(2));
