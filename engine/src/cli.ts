// Command line of the engine.
//   keel verify <txHash> [--rpc <url>] [--evidence <dir>]   a transaction and every PDR it carries (T2.9)
//   keel verify --pdr <pdrHash> [--evidence <dir>]          one PDR from its evidence file, offline
//   keel agent --data <dir> [--once] [--interval <s>]       the agent service of one importer Safe (T2.11)
//   keel monitor --data <dir> [--from-block <n>] [--once] [--interval <s>]   the monitor of one importer Safe (T2.8)
// verify exits 0 when everything matches, 1 on any mismatch, 2 on a usage or read error.
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type { Hex } from "@keel/schemas";
import { createPublicClient, http, isAddress, isHash } from "viem";
import { Agent } from "./agent/agent";
import { fundingGatePort, gateDeployment, mockRolesAllowance } from "./agent/gate";
import { botNotifier } from "./agent/notices";
import { rpcChain } from "./agent/rpc";
import { FileStore } from "./agent/store";
import { loadPauser, loadPolicySigner, loadRelayer } from "./keys";
import { Monitor, pauserOn } from "./monitor/monitor";
import { monitorNotifier } from "./monitor/notices";
import { rpcMonitorChain } from "./monitor/rpc";
import { tradePolicy } from "./policy";
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

// Configuration from the environment: KEEL_RPC_URL, KEEL_ESCROW, KEEL_SAFE, KEEL_ROLES_CONFIG_HASH
// and the keys RELAYER_PRIVATE_KEY and POLICY_SIGNER_PRIVATE_KEY (never in the repository).
async function agent(args: string[]): Promise<number> {
  const { values } = parseArgs({
    args,
    options: { data: { type: "string" }, once: { type: "boolean" }, interval: { type: "string" }, evidence: { type: "string" } },
  });
  const env = process.env;
  const need = (name: string, check: (v: string) => boolean) => {
    const v = env[name];
    if (!v || !check(v)) throw new UsageError(`set ${name}`);
    return v as Hex;
  };
  const rpc = need("KEEL_RPC_URL", Boolean);
  const escrow = need("KEEL_ESCROW", isAddress);
  const safe = need("KEEL_SAFE", isAddress);
  const rolesConfigHash = need("KEEL_ROLES_CONFIG_HASH", isHash);
  const data = values.data ?? env.KEEL_DATA_DIR;
  if (!data) throw new UsageError("set --data or KEEL_DATA_DIR");

  // The bot is optional (T2.6): without its URL and token, events are only printed
  const botUrl = env.KEEL_BOT_URL;
  const botToken = env.KEEL_BOT_TOKEN;
  if (Boolean(botUrl) !== Boolean(botToken)) throw new UsageError("set both KEEL_BOT_URL and KEEL_BOT_TOKEN, or neither");

  const chain = rpcChain(rpc, loadRelayer(env));
  const store = new FileStore(data);
  // The Trade gate (Area 1). Without it, funding waits with GATE_NOT_DEPLOYED. The allowance is
  // read from MockTradeRoles, the Roles of the demo; the real Zodiac reader goes with T1.7.
  const gateAddress = env.KEEL_FUNDING_GATE as Hex | undefined;
  if (gateAddress && !isAddress(gateAddress)) throw new UsageError("KEEL_FUNDING_GATE is not an address");
  let gate: ReturnType<typeof fundingGatePort> | undefined;
  if (gateAddress) {
    const { roles, agentRoleKey } = await gateDeployment(chain, gateAddress);
    gate = fundingGatePort(chain, gateAddress, mockRolesAllowance(chain, roles, agentRoleKey));
  }
  const keel = new Agent(
    { chainId: await chain.chainId(), escrow, safe, policy: tradePolicy(rolesConfigHash), decisionTtlSeconds: 3600, evidenceDir: values.evidence ?? DEFAULT_EVIDENCE },
    // Each sent step, hold and notice is printed once as a JSON line and, with the bot
    // configured, posted to it.
    {
      chain,
      store,
      gate,
      signer: loadPolicySigner(env),
      notify: botNotifier({ store, endpoint: botUrl && botToken ? { url: botUrl, token: botToken } : undefined }),
    },
  );
  const intervalMs = Number(values.interval ?? 15) * 1000;
  for (;;) {
    await keel.tick();
    if (values.once) return 0;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

// T2.8. Reads the gate and the escrow of one importer Safe, needs no relayer and holds no
// authority to move funds. With MONITOR_PAUSER_PRIVATE_KEY it pauses the gate on an incident;
// until the gate has a pause-only role that pause reverts and the monitor only alerts.
async function monitor(args: string[]): Promise<number> {
  const { values } = parseArgs({
    args,
    options: { data: { type: "string" }, once: { type: "boolean" }, interval: { type: "string" }, evidence: { type: "string" }, "from-block": { type: "string" } },
  });
  const env = process.env;
  const need = (name: string, check: (v: string) => boolean) => {
    const v = env[name];
    if (!v || !check(v)) throw new UsageError(`set ${name}`);
    return v as Hex;
  };
  const rpc = need("KEEL_RPC_URL", Boolean);
  const escrow = need("KEEL_ESCROW", isAddress);
  const safe = need("KEEL_SAFE", isAddress);
  const gate = need("KEEL_FUNDING_GATE", isAddress);
  const data = values.data ?? env.KEEL_DATA_DIR;
  if (!data) throw new UsageError("set --data or KEEL_DATA_DIR");
  const botUrl = env.KEEL_BOT_URL;
  const botToken = env.KEEL_BOT_TOKEN;
  if (Boolean(botUrl) !== Boolean(botToken)) throw new UsageError("set both KEEL_BOT_URL and KEEL_BOT_TOKEN, or neither");
  if (values["from-block"] !== undefined && !/^[0-9]+$/.test(values["from-block"])) throw new UsageError("--from-block takes a block number");

  const chain = rpcMonitorChain(rpc);
  const pauserKey = loadPauser(env);
  const pauser = pauserKey && pauserOn(rpcChain(rpc, pauserKey), pauserKey.address);
  const client = createPublicClient({ transport: http(rpc) });
  const fromBlock = values["from-block"] !== undefined ? BigInt(values["from-block"]) : (await chain.latestBlock()) + 1n;
  const watch = new Monitor(
    { chainId: await client.getChainId(), gate, escrow, evidenceDir: values.evidence ?? DEFAULT_EVIDENCE, fromBlock },
    {
      chain,
      pauser,
      notify: monitorNotifier({ store: new FileStore(data), safe, gate, endpoint: botUrl && botToken ? { url: botUrl, token: botToken } : undefined }),
    },
  );
  console.log(JSON.stringify({ monitor: "started", fromBlock: fromBlock.toString(), pauser: pauser?.address ?? null }));
  const intervalMs = Number(values.interval ?? 15) * 1000;
  for (;;) {
    await watch.tick();
    if (values.once) return 0;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

class UsageError extends Error {}

async function main(argv: string[]): Promise<number> {
  const [command, ...args] = argv;
  try {
    if (command === "verify") return await verify(args);
    if (command === "agent") return await agent(args);
    if (command === "monitor") return await monitor(args);
    throw new UsageError(USAGE);
  } catch (e) {
    console.error(e instanceof UsageError ? e.message : `error: ${(e as Error).message}`);
    return 2;
  }
}

process.exitCode = await main(process.argv.slice(2));
