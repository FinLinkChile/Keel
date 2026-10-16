// Command line of the engine.
//   keel verify <txHash> [--rpc <url>] [--evidence <dir>] [--deployments <dir>]   a transaction and every PDR it carries (T2.9)
//   keel verify --pdr <pdrHash> [--evidence <dir>]                                one PDR from its evidence file, offline
//   keel agent --data <dir> [--once] [--interval <s>]                             the agent service of one importer Safe (T2.11)
// verify exits 0 when everything matches and is anchored to the deployed contracts, 1 on any
// mismatch, 2 on a usage or read error, 3 when the evidence is consistent but not anchored
// (offline): that proves the file, not that the chain accepted it.
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type { Hex } from "@keel/schemas";
import { createPublicClient, http, isAddress, isHash, parseAbi } from "viem";
import { Agent } from "./agent/agent";
import { fundingGatePort, gateDeployment, mockRolesAllowance } from "./agent/gate";
import { botNotifier } from "./agent/notices";
import { rpcChain } from "./agent/rpc";
import { FileStore } from "./agent/store";
import { explorerAddressUrl, explorerTxUrl } from "./explorer";
import { loadPolicySigner, loadRelayer } from "./keys";
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

class UsageError extends Error {}

async function main(argv: string[]): Promise<number> {
  const [command, ...args] = argv;
  try {
    if (command === "verify") return await verify(args);
    if (command === "agent") return await agent(args);
    throw new UsageError(USAGE);
  } catch (e) {
    console.error(e instanceof UsageError ? e.message : `error: ${(e as Error).message}`);
    return 2;
  }
}

process.exitCode = await main(process.argv.slice(2));
