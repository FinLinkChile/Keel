// Area 1 on-chain evidence (task 6, phases 1 and 3). Usage: see README.md in this folder.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import type { Hex } from "@keel/schemas";
import { isHash } from "viem";
import { CaseFailure, connect, type Ctx } from "./chain";
import { checkRegistryReady, preflight } from "./checks";
import {
  DEFAULTS,
  defaultDeploymentsFile,
  defaultOutDir,
  envAddress,
  loadDeployment,
  loadEnvFile,
  type Options,
  PreconditionError,
  REPO_ROOT,
  redactUrls,
} from "./config";
import { openOrder, trustedParties } from "./orders";
import { runPhase1 } from "./phase1";
import { duplicateBl, exporterDisputeBeforeShipment, lateAttestation, repeatDeposit } from "./phase3";
import { type CaseRecord, Sink, summaryTable } from "./record";

const { values: v, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    "rpc-url": { type: "string" },
    "chain-id": { type: "string", default: "84532" },
    deployments: { type: "string" },
    artifacts: { type: "string", default: join(REPO_ROOT, "contracts", "out") },
    out: { type: "string" },
    env: { type: "string", default: join(REPO_ROOT, ".env") },
    amount: { type: "string", default: DEFAULTS.amount.toString() },
    "advance-bps": { type: "string", default: String(DEFAULTS.advanceBps) },
    "deadline-seconds": { type: "string" },
    "dispute-window": { type: "string", default: DEFAULTS.disputeWindow.toString() },
    "revert-gas": { type: "string", default: DEFAULTS.revertGas.toString() },
    "min-native": { type: "string", default: DEFAULTS.minNative.toString() },
    live: { type: "boolean", default: false },
    steps: { type: "string" },
    tx: { type: "string" },
    order: { type: "string" },
    "order-b": { type: "string" },
    bl: { type: "string" },
  },
});

// viem error messages include the RPC URL, which may carry an API key
let secretUrl: string | undefined;
const redact = (m: string) => redactUrls(secretUrl ? m.replaceAll(secretUrl, "<rpc-url>") : m);

const hash32 = (name: string, x: string | undefined): Hex => {
  if (!x || !isHash(x)) throw new PreconditionError(`--${name} must be a 32-byte hex value`);
  return x as Hex;
};

async function main() {
  const [command, sub] = positionals;
  if (command === "summary") {
    // Table of every evidence file in --out, without touching the chain
    if (!v.out) throw new PreconditionError("summary needs --out <dir>");
    const dir = v.out;
    const recs = readdirSync(dir)
      .filter((f) => /^\d\.\d+-.*\.json$/.test(f))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as CaseRecord);
    console.log(summaryTable(recs));
    return;
  }
  if (!command || !["phase1", "phase3", "open-order"].includes(command)) {
    throw new PreconditionError("usage: cli.ts phase1 [--steps 1.1,1.2] | open-order | phase3 <repeat-deposit|exporter-dispute|late-attestation|duplicate-bl> | summary --out <dir> (see README.md)");
  }
  loadEnvFile(v.env);
  const rpcUrl = v["rpc-url"] ?? process.env.BASE_SEPOLIA_RPC_URL;
  if (!rpcUrl) throw new PreconditionError("no RPC: pass --rpc-url or set BASE_SEPOLIA_RPC_URL");
  secretUrl = rpcUrl;
  const isLocal = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(rpcUrl);
  const deploymentsFile = v.deployments ?? defaultDeploymentsFile(Number(v["chain-id"]));
  const deadlineDefault = command === "open-order" ? DEFAULTS.openOrderDeadlineSeconds : DEFAULTS.phase1DeadlineSeconds;
  const opts: Options = {
    rpcUrl,
    // The URL may carry an API key: the reproduce command names the variable instead
    rpcLabel: isLocal ? rpcUrl : v["rpc-url"] ? "<rpc-url>" : '"$BASE_SEPOLIA_RPC_URL"',
    deploymentsFile,
    artifactsDir: v.artifacts,
    outDir: v.out ?? defaultOutDir(),
    amount: BigInt(v.amount),
    advanceBps: Number(v["advance-bps"]),
    deadlineSeconds: v["deadline-seconds"] ? BigInt(v["deadline-seconds"]) : deadlineDefault,
    disputeWindow: BigInt(v["dispute-window"]),
    revertGas: BigInt(v["revert-gas"]),
    minNative: BigInt(v["min-native"]),
    live: v.live,
  };
  if (opts.amount <= 0n) throw new PreconditionError("--amount must be positive");
  if (opts.advanceBps < 0 || opts.advanceBps > 10_000) throw new PreconditionError("--advance-bps must be within 0..10000");

  const d = loadDeployment(deploymentsFile);
  const ctx: Ctx = await connect(opts, d, envAddress("POLICY_SIGNER_ADDRESS"));
  const sink = new Sink(opts.outDir, {
    chainId: ctx.chainId,
    contracts: { safe: d.safe, roles: d.roles, tradeEscrow: d.tradeEscrow, fundingGate: d.fundingGate, token: ctx.d.token },
  });
  console.log(`chain ${ctx.chainId}${ctx.isAnvil ? " (local anvil)" : ""}, Safe ${d.safe}, gate ${d.fundingGate}, output ${opts.outDir}`);

  try {
    if (command === "phase1") {
      await runPhase1(ctx, sink, v.steps?.split(",").map((s) => s.trim()));
    } else if (command === "open-order") {
      // An order for a real deposit of phase 3 (the deposit itself is the real flow's)
      await preflight(ctx, { senders: ["exporter"] });
      await checkRegistryReady(ctx);
      const o = await openOrder(ctx, trustedParties(ctx), `phase3-${Date.now()}`);
      console.log(JSON.stringify({ orderId: o.po.orderId, orderHash: o.orderHash, shipmentDeadline: o.po.shipmentDeadline.toString(), openTx: o.open.tx.hash }, null, 2));
    } else if (sub === "repeat-deposit") {
      await repeatDeposit(ctx, sink, hash32("tx", v.tx));
    } else if (sub === "exporter-dispute") {
      await exporterDisputeBeforeShipment(ctx, sink, hash32("order", v.order));
    } else if (sub === "late-attestation") {
      await lateAttestation(ctx, sink, hash32("order", v.order));
    } else if (sub === "duplicate-bl") {
      await duplicateBl(ctx, sink, hash32("order", v.order), hash32("order-b", v["order-b"]), v.bl);
    } else {
      throw new PreconditionError("phase3 needs one of: repeat-deposit, exporter-dispute, late-attestation, duplicate-bl");
    }
  } finally {
    if (sink.records.length) console.log(`\n${summaryTable(sink.records)}\n\nevidence files in ${opts.outDir}`);
  }
}

main().catch((err: unknown) => {
  const e = err as Error;
  const msg = redact(e?.message ?? String(err));
  if (e instanceof PreconditionError) console.error(`\nABORTED (state not as expected): ${msg}`);
  else if (e instanceof CaseFailure) console.error(`\nCASE FAILED: ${msg}`);
  else console.error(`\nERROR: ${msg}`);
  process.exit(1);
});
