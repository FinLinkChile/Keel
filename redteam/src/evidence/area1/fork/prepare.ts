// FORK TEST ONLY. Prepares a local anvil fork for the evidence script and refuses any other node.
//   base      gas for the demo accounts and USDC for the Safe. The Safe owners (OWNER plus
//             SECOND_OWNER_ADDRESS, threshold 1) come from DeployTrade, as on the real chain.
//   deposits  stands in for the real deposit flow: generates a throwaway policy key in memory,
//             makes it the gate's policy signer through the Safe, opens 3 orders and funds them
//             through the gate. Writes the orderIds and deposit hashes to <out>/deposits.json.
// The throwaway key never leaves this process.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import type { Hex } from "@keel/schemas";
import { encodeAbiParameters, encodeFunctionData, keccak256, nonceManager, toHex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { safeAbi } from "../abi";
import { type Ctx, connect, gateCall, gateEvents, gateRead, read, safeExec, sendOk, usdcBalance } from "../chain";
import { ACTORS, type Actor, DEFAULTS, envAddress, loadDeployment, loadEnvFile, type Options, REPO_ROOT, redactUrls } from "../config";
import { decisionFor, executeCall, intentFor, openOrder, signDecision, trustedParties } from "../orders";

const { values: v, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    "rpc-url": { type: "string", default: "http://127.0.0.1:8545" },
    deployments: { type: "string" },
    out: { type: "string" },
    env: { type: "string", default: join(REPO_ROOT, ".env") },
    "safe-usdc": { type: "string", default: "10000000" },
    amount: { type: "string", default: DEFAULTS.amount.toString() },
    // Orders A and B (repeat, dispute, duplicate BL) and C (late attestation)
    "deadline-ab": { type: "string", default: "3600" },
    "deadline-c": { type: "string", default: DEFAULTS.openOrderDeadlineSeconds.toString() },
  },
});

// FiatToken v2.2 (USDC on Base Sepolia): balanceAndBlacklistStates is storage slot 9
const USDC_BALANCE_SLOT = 9n;

async function rpc(ctx: Ctx, method: string, params: unknown[]) {
  return ctx.pub.request({ method, params } as never);
}

async function base(ctx: Ctx) {
  for (const a of Object.keys(ACTORS) as Actor[]) await rpc(ctx, "anvil_setBalance", [ctx.addr[a], toHex(10n ** 19n)]);
  const slot = keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [ctx.d.safe, USDC_BALANCE_SLOT]));
  const want = BigInt(v["safe-usdc"]);
  await rpc(ctx, "anvil_setStorageAt", [ctx.d.token, slot, toHex(want, { size: 32 })]);
  await rpc(ctx, "evm_mine", []);
  const bal = await usdcBalance(ctx, ctx.d.safe);
  if (bal !== want) throw new Error(`USDC balance slot guess failed: Safe has ${bal}`);
  const owners = await read<Hex[]>(ctx, ctx.d.safe, safeAbi, "getOwners");
  console.log(`fork base ready: Safe owners ${owners.join(", ")}, threshold ${await read<bigint>(ctx, ctx.d.safe, safeAbi, "getThreshold")}, ${bal} USDC units`);
}

async function deposits(ctx: Ctx, outDir: string) {
  const policy = privateKeyToAccount(generatePrivateKey(), { nonceManager });
  await rpc(ctx, "anvil_setBalance", [policy.address, toHex(10n ** 19n)]);
  await safeExec(ctx, ctx.d.fundingGate, gateCall(ctx, "setPolicySigner", [policy.address]), "setPolicySigner(<throwaway fork key>)");
  if ((await gateRead<Hex>(ctx, "policySigner")) !== policy.address) throw new Error("policy signer not set");
  const out: Record<string, { orderId: Hex; fundTx: Hex; shipmentDeadline: string }> = {};
  for (const [name, deadline] of [
    ["A", BigInt(v["deadline-ab"])],
    ["B", BigInt(v["deadline-ab"])],
    ["C", BigInt(v["deadline-c"])],
  ] as const) {
    const o = await openOrder(ctx, trustedParties(ctx), `fork-deposit-${name}`, deadline);
    const intent = await intentFor(ctx, o);
    const d = await decisionFor(ctx, intent);
    const sig = await signDecision(ctx, d, policy);
    // Relayed by the throwaway account, like the agent relayer would
    const sent = await sendOk(ctx, policy, ctx.d.fundingGate, executeCall(ctx, intent, d, sig), `deposit ${name}`);
    if (!gateEvents(ctx, sent.receipt.logs).some((e) => e.eventName === "FundingExecuted")) throw new Error(`deposit ${name}: no FundingExecuted`);
    out[name] = { orderId: o.po.orderId, fundTx: sent.tx.hash, shipmentDeadline: o.po.shipmentDeadline.toString() };
  }
  writeFileSync(join(outDir, "deposits.json"), `${JSON.stringify(out, null, 2)}\n`);
  console.log(JSON.stringify(out, null, 2));
}

async function main() {
  loadEnvFile(v.env);
  const d = loadDeployment(v.deployments ?? join(REPO_ROOT, "contracts", "deployments", "84532.json"));
  const opts: Options = {
    rpcUrl: v["rpc-url"],
    rpcLabel: v["rpc-url"],
    deploymentsFile: "",
    artifactsDir: join(REPO_ROOT, "contracts", "out"),
    outDir: v.out ?? ".",
    amount: BigInt(v.amount),
    advanceBps: DEFAULTS.advanceBps,
    deadlineSeconds: DEFAULTS.phase1DeadlineSeconds,
    disputeWindow: DEFAULTS.disputeWindow,
    revertGas: DEFAULTS.revertGas,
    minNative: DEFAULTS.minNative,
    live: false,
  };
  const ctx = await connect(opts, d, envAddress("POLICY_SIGNER_ADDRESS"));
  if (!ctx.isAnvil) throw new Error("prepare.ts only runs against a local anvil fork");
  if (positionals[0] === "base") await base(ctx);
  else if (positionals[0] === "deposits") await deposits(ctx, opts.outDir);
  else throw new Error("usage: prepare.ts base|deposits");
}

main().catch((e: unknown) => {
  console.error(`ERROR: ${redactUrls((e as Error).message)}`);
  process.exit(1);
});
