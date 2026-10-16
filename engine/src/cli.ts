// Command line of the engine.
//   keel verify <txHash> [--rpc <url>] [--evidence <dir>] [--deployments <dir>]   a transaction and every PDR it carries (T2.9)
//   keel verify --pdr <pdrHash> [--evidence <dir>]                                one PDR from its evidence file, offline
//   keel agent --data <dir> [--once] [--interval <s>]                             the agent service of one importer Safe (T2.11)
//   keel monitor --data <dir> [--from-block <n>] [--once] [--interval <s>]        the monitor of one importer Safe (T2.8)
// verify exits 0 when everything matches and is anchored to the deployed contracts, 1 on any
// mismatch, 2 on a usage or read error, 3 when the evidence is consistent but not anchored
// (offline): that proves the file, not that the chain accepted it.
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type { Hex } from "@keel/schemas";
import { tradeRolesConfigHash } from "@keel/schemas/hash";
import { createPublicClient, http, isAddress, isHash, parseAbi } from "viem";
import { Agent } from "./agent/agent";
import { fundingGatePort, gateDeployment, mockRolesAllowance, readRolesAllowance, zodiacRolesAllowance } from "./agent/gate";
import { botNotifier } from "./agent/notices";
import { rpcChain } from "./agent/rpc";
import { FileStore } from "./agent/store";
import { explorerAddressUrl, explorerTxUrl } from "./explorer";
import { loadPauser, loadPolicySigner, loadRelayer } from "./keys";
import { Monitor, pauserOn } from "./monitor/monitor";
import { monitorNotifier } from "./monitor/notices";
import { rpcMonitorChain } from "./monitor/rpc";
import { tradePolicy } from "./policy";
import { type ChainFacts, type ChainReader, type Check, candidateHashes, emitterOf, loadDeployment, loadEvidence, type Verdict, verdict, verifyEvidence } from "./verify";

const DEFAULT_EVIDENCE = fileURLToPath(new URL("../../evidence/pdr/", import.meta.url));
const DEFAULT_DEPLOYMENTS = fileURLToPath(new URL("../../contracts/deployments/", import.meta.url));
const USAGE =
  "usage: keel verify <txHash> [--rpc <url>] [--evidence <dir>] [--deployments <dir>]\n       keel verify --pdr <pdrHash> [--evidence <dir>]";

const READS = parseAbi([
  "function policySigner() view returns (address)",
  "struct PurchaseOrder { bytes32 orderId; address importer; address exporter; address payoutAddress; address token; uint256 totalAmount; uint16 advanceBps; uint64 shipmentDeadline; uint64 disputeWindow; address carrier; address arbiter; address documentVerifier; bytes32 incoterm; bytes32 termsHash; bytes32 requiredDocsHash; uint256 nonce; }",
  "struct OrderRecord { PurchaseOrder po; uint8 state; uint64 stateVersion; bytes32 orderHash; uint256 paidOut; bytes32 attestationHash; bytes32 docsHash; uint64 shippedAt; bool funded; }",
  "function orderOf(bytes32 orderId) view returns (OrderRecord)",
]);

async function readTransaction(rpc: string, hash: Hex, deployments: string): Promise<ChainFacts> {
  const client = createPublicClient({ transport: http(rpc) });
  const [chainId, receipt] = await Promise.all([client.getChainId(), client.getTransactionReceipt({ hash })]);
  const read: ChainReader = {
    policySigner: (gate, blockNumber) => client.readContract({ address: gate, abi: READS, functionName: "policySigner", blockNumber }),
    async order(escrow, orderId, blockNumber) {
      const r = await client.readContract({ address: escrow, abi: READS, functionName: "orderOf", args: [orderId], blockNumber });
      return { orderHash: r.orderHash, documentVerifier: r.po.documentVerifier };
    },
  };
  return { chainId, status: receipt.status, blockNumber: receipt.blockNumber, logs: receipt.logs, deployment: loadDeployment(deployments, chainId), read };
}

function print(pdrHash: Hex, checks: readonly Check[]) {
  console.log(`PDR ${pdrHash}`);
  for (const c of checks) {
    console.log(`  ${c.outcome.toUpperCase().padEnd(9)} ${c.check}${c.note ? `: ${c.note}` : ""}`);
    if (c.expected !== undefined) console.log(`            expected ${c.expected}\n            actual   ${c.actual}`);
  }
}

const EXIT: Record<Verdict, number> = { MATCH: 0, MISMATCH: 1, "EVIDENCE ONLY": 3 };

async function verify(args: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { rpc: { type: "string" }, evidence: { type: "string" }, deployments: { type: "string" }, pdr: { type: "string" } },
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
    const deployments = values.deployments ?? DEFAULT_DEPLOYMENTS;
    facts = await readTransaction(rpc, tx, deployments);
    console.log(`Transaction ${tx} (chain ${facts.chainId}, block ${facts.blockNumber}, ${facts.status})`);
    const txUrl = explorerTxUrl(facts.chainId, tx);
    if (txUrl) console.log(`Explorer: ${txUrl}`);
    if (!facts.deployment) {
      console.log(`No ${facts.chainId}.json in ${deployments}: without Keel's official addresses nothing can be anchored`);
      return 1;
    }
    hashes = candidateHashes(facts);
  }

  const results: Check[][] = [];
  for (const hash of hashes) {
    const evidence = loadEvidence(dir, hash);
    if (!evidence) continue;
    const checks = await verifyEvidence(evidence, facts);
    print(hash, checks);
    const contract = facts && emitterOf(evidence, facts.deployment);
    const contractUrl = facts && contract ? explorerAddressUrl(facts.chainId, contract) : undefined;
    if (contractUrl) console.log(`  Contract: ${contractUrl}`);
    results.push(checks);
  }
  if (results.length === 0) {
    console.log(values.pdr ? `No evidence file for ${values.pdr} in ${dir}` : `No PDR of this transaction has evidence in ${dir}`);
    return 1;
  }
  const verdicts = results.map(verdict);
  const result: Verdict = verdicts.includes("MISMATCH") ? "MISMATCH" : verdicts.includes("EVIDENCE ONLY") ? "EVIDENCE ONLY" : "MATCH";
  console.log(`Result: ${result}${result === "EVIDENCE ONLY" ? " (consistent file, not anchored to the chain: pass a transaction hash to anchor it)" : ""}`);
  return EXIT[result];
}

// Configuration from the environment: KEEL_RPC_URL, KEEL_ESCROW, KEEL_SAFE and the keys
// RELAYER_PRIVATE_KEY and POLICY_SIGNER_PRIVATE_KEY (never in the repository). With KEEL_FUNDING_GATE
// and the allowance keys KEEL_AGENT_ALLOWANCE_KEY and KEEL_COSIGNED_ALLOWANCE_KEY the gate runs on
// the real Zodiac Roles and the rolesConfigHash is computed from the chain; otherwise (the demo on
// MockTradeRoles, or no gate) KEEL_ROLES_CONFIG_HASH gives it.
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
  const data = values.data ?? env.KEEL_DATA_DIR;
  if (!data) throw new UsageError("set --data or KEEL_DATA_DIR");

  // The bot is optional (T2.6): without its URL and token, events are only printed
  const botUrl = env.KEEL_BOT_URL;
  const botToken = env.KEEL_BOT_TOKEN;
  if (Boolean(botUrl) !== Boolean(botToken)) throw new UsageError("set both KEEL_BOT_URL and KEEL_BOT_TOKEN, or neither");

  const chain = rpcChain(rpc, loadRelayer(env));
  const store = new FileStore(data);
  // The Trade gate (Area 1). Without it, funding waits with GATE_NOT_DEPLOYED.
  const gateAddress = env.KEEL_FUNDING_GATE as Hex | undefined;
  if (gateAddress && !isAddress(gateAddress)) throw new UsageError("KEEL_FUNDING_GATE is not an address");
  const agentKey = env.KEEL_AGENT_ALLOWANCE_KEY as Hex | undefined;
  const cosignedKey = env.KEEL_COSIGNED_ALLOWANCE_KEY as Hex | undefined;
  if (Boolean(agentKey) !== Boolean(cosignedKey)) throw new UsageError("set both KEEL_AGENT_ALLOWANCE_KEY and KEEL_COSIGNED_ALLOWANCE_KEY, or neither");
  if (agentKey && !(isHash(agentKey) && isHash(cosignedKey!))) throw new UsageError("the allowance keys are not bytes32");
  const configured = env.KEEL_ROLES_CONFIG_HASH as Hex | undefined;
  if (configured && !isHash(configured)) throw new UsageError("KEEL_ROLES_CONFIG_HASH is not a bytes32");
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
      if (a.refill !== a.maxRefill) throw new UsageError("a Roles allowance is not the Keel Trade configuration (refill differs from maxRefill)");
    }
    if (agentAllowance.period !== cosignedAllowance.period) throw new UsageError("the two Roles allowances have different periods");
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
    if (configured && configured.toLowerCase() !== computed) throw new UsageError(`KEEL_ROLES_CONFIG_HASH does not match the deployment (${computed})`);
    rolesConfigHash = computed;
    gate = fundingGatePort(chain, gateAddress, zodiacRolesAllowance(chain, deployment.roles, agentKey));
  } else if (gateAddress) {
    // The demo: MockTradeRoles keys each allowance by its role key
    const { roles, agentRoleKey } = await gateDeployment(chain, gateAddress);
    gate = fundingGatePort(chain, gateAddress, mockRolesAllowance(chain, roles, agentRoleKey));
  }
  if (!rolesConfigHash) throw new UsageError("set KEEL_ROLES_CONFIG_HASH, or KEEL_FUNDING_GATE with the allowance keys");
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
