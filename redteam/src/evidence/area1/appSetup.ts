// Setup for the app's demo, in one process so the owner's nonces never collide: queues the gate's
// policy hash on the Delay (as SetTradePolicy.s.sol does), queues the app's carrier and arbiter
// with the idempotent 1.1, waits for the Delay cooldown and configDelay, executes the policy with
// executeNextTx and checks every result by reading the chain.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Hex } from "@keel/schemas";
import { type Abi, encodeFunctionData, isHash, zeroAddress } from "viem";
import { safeAbi } from "./abi";
import { type Ctx, gateCall, gateEvents, gateRead, read, safeExec, sendOk, simulateFrom, waitUntil } from "./chain";
import { preflight, ROLE } from "./checks";
import { envAddress, PreconditionError } from "./config";
import { callFor, planRegistrations, THIRD_PARTY, type Wanted } from "./phase1";
import type { Sink, TxRef } from "./record";

function delayAbi(ctx: Ctx): Abi {
  const path = join(ctx.opts.artifactsDir, "KeelExternal.sol", "IDelay110.json");
  try {
    return (JSON.parse(readFileSync(path, "utf8")) as { abi: Abi }).abi;
  } catch {
    throw new PreconditionError(`missing ${path}: run \`forge build\` in contracts/ first`);
  }
}

// The app's parties must be plain accounts with no other role in the deployment.
async function checkAppParties(ctx: Ctx, parties: Record<string, Hex>) {
  const owners = await read<Hex[]>(ctx, ctx.d.safe, safeAbi, "getOwners");
  const forbidden: [string, Hex][] = [
    ["Safe", ctx.d.safe],
    ["Roles", ctx.d.roles],
    ["Delay", ctx.d.delay],
    ["FundingGate", ctx.d.fundingGate],
    ["TradeEscrow", ctx.d.tradeEscrow],
    ...owners.map((o, i): [string, Hex] => [`Safe owner ${i + 1}`, o]),
    ["cosigner", await gateRead<Hex>(ctx, "cosigner")],
    ["guardian", await gateRead<Hex>(ctx, "guardian")],
    ["policySigner", await gateRead<Hex>(ctx, "policySigner")],
    ["RELAYER_ADDRESS", envAddress("RELAYER_ADDRESS")],
  ];
  const entries = Object.entries(parties);
  for (const [name, a] of entries) {
    const hit = forbidden.find(([, f]) => f.toLowerCase() === a.toLowerCase());
    if (hit) throw new PreconditionError(`${name} ${a} is the ${hit[0]}; nothing sent`);
    const code = await ctx.pub.getCode({ address: a });
    if (code && code !== "0x") throw new PreconditionError(`${name} ${a} has code; nothing sent`);
  }
  if (entries[0]?.[1].toLowerCase() === entries[1]?.[1].toLowerCase()) throw new PreconditionError("the carrier and the arbiter are the same address");
  console.log(`  app parties ok: not the Safe, its ${owners.length} owners, cosigner, guardian, policySigner or relayer; no code`);
}

export async function appSetup(ctx: Ctx, sink: Sink, policyHash: Hex) {
  if (!isHash(policyHash) || /^0x0{64}$/.test(policyHash)) throw new PreconditionError("--policy-hash must be a non-zero 32-byte value");
  await preflight(ctx, { senders: ["owner"] });
  const carrier = envAddress("APP_CARRIER_ADDRESS");
  const arbiter = envAddress("APP_ARBITER_ADDRESS");
  await checkAppParties(ctx, { APP_CARRIER_ADDRESS: carrier, APP_ARBITER_ADDRESS: arbiter });

  // ---- Delay: nothing pending, the owner is a module, it acts on the gate's Safe
  const abi = delayAbi(ctx);
  const delayRead = <T>(fn: string, args: unknown[] = []) => read<T>(ctx, ctx.d.delay, abi as never, fn, args);
  const gateSafe = await gateRead<Hex>(ctx, "safe");
  const [avatar, target, ownerIsModule, txNonce, queueNonce, cooldown, expiration] = [
    await delayRead<Hex>("avatar"),
    await delayRead<Hex>("target"),
    await delayRead<boolean>("isModuleEnabled", [ctx.addr.owner]),
    await delayRead<bigint>("txNonce"),
    await delayRead<bigint>("queueNonce"),
    await delayRead<bigint>("txCooldown"),
    await delayRead<bigint>("txExpiration"),
  ];
  if (avatar !== gateSafe || target !== gateSafe) throw new PreconditionError("the Delay does not act on the gate's Safe");
  if (!ownerIsModule) throw new PreconditionError("OWNER_ADDRESS is not a module of the Delay");
  if (txNonce !== queueNonce) throw new PreconditionError(`the Delay has ${queueNonce - txNonce} transaction(s) pending (txNonce ${txNonce}, queueNonce ${queueNonce}); nothing sent`);
  const policyBefore = await gateRead<Hex>(ctx, "currentPolicyHash");
  if (policyBefore.toLowerCase() === policyHash.toLowerCase()) throw new PreconditionError(`the gate already has policyHash ${policyHash}; nothing sent`);
  const setData = gateCall(ctx, "setPolicyHash", [policyHash]);
  // What the Delay will run later, from the Safe: it must not revert then
  const later = await simulateFrom(ctx, ctx.d.safe, ctx.d.fundingGate, setData);
  if (later) throw new PreconditionError(`setPolicyHash from the Safe would revert with ${later.name}; nothing sent`);
  console.log(`  Delay ok: nothing pending (nonce ${txNonce}), cooldown ${cooldown} s, expiration ${expiration} s; gate policyHash ${policyBefore}`);

  // ---- Registrations planned before the first send (idempotent 1.1)
  const wanted: Wanted[] = [
    { label: "queueThirdParty(APP_CARRIER, CARRIER)", kind: THIRD_PARTY, subject: carrier, payout: zeroAddress, roles: ROLE.CARRIER },
    { label: "queueThirdParty(APP_ARBITER, ARBITER)", kind: THIRD_PARTY, subject: arbiter, payout: zeroAddress, roles: ROLE.ARBITER },
  ];
  const plan = await planRegistrations(ctx, wanted);

  // ---- 1. Queue the policy on the Delay
  const queueData = encodeFunctionData({ abi, functionName: "execTransactionFromModule", args: [ctx.d.fundingGate, 0n, setData, 0] } as never);
  const queued = await sendOk(ctx, "owner", ctx.d.delay, queueData, `Delay: queue setPolicyHash(${policyHash})`);
  const createdAt = await delayRead<bigint>("txCreatedAt", [txNonce]);
  if ((await delayRead<bigint>("queueNonce")) !== txNonce + 1n) throw new Error("the Delay queue did not advance by one");

  // ---- 2. Registrations
  const regSetup: TxRef[] = [];
  const changes: Record<string, unknown>[] = [];
  for (const p of plan) {
    if (p.earlier) {
      console.log(`  skip ${p.w.label}: change ${p.earlier.changeId} already queued in ${p.earlier.tx.hash}`);
      regSetup.push(p.earlier.tx);
      changes.push({ label: p.w.label, changeId: p.earlier.changeId, activatesAt: p.earlier.activatesAt, queuedEarlier: true });
      continue;
    }
    const q = await safeExec(ctx, ctx.d.fundingGate, callFor(ctx, p.w), p.w.label);
    const ev = gateEvents(ctx, q.receipt.logs).find((e) => e.eventName === "ChangeQueued");
    if (!ev) throw new Error(`${p.w.label}: no ChangeQueued event`);
    regSetup.push(q.tx);
    changes.push({ label: p.w.label, changeId: ev.args.changeId, activatesAt: ev.args.activatesAt, queuedEarlier: false });
  }

  // ---- 3. Wait for the cooldown, execute the policy
  await waitUntil(ctx, createdAt + cooldown, `Delay cooldown (${cooldown} s)`);
  if ((await delayRead<Hex>("getTxHash", [txNonce])) !== (await delayRead<Hex>("getTransactionHash", [ctx.d.fundingGate, 0n, setData, 0]))) {
    throw new Error("the next Delay transaction is not this setPolicyHash");
  }
  const execData = encodeFunctionData({ abi, functionName: "executeNextTx", args: [ctx.d.fundingGate, 0n, setData, 0] } as never);
  const executed = await sendOk(ctx, "owner", ctx.d.delay, execData, "Delay: executeNextTx(setPolicyHash)");

  // ---- 4. Wait for configDelay, read everything back
  const configDelay = await gateRead<bigint>(ctx, "configDelay");
  const activatesAt = changes.reduce((m, c) => ((c.activatesAt as bigint) > m ? (c.activatesAt as bigint) : m), 0n);
  await waitUntil(ctx, activatesAt, `configDelay (${configDelay} s)`);
  const after = {
    policyHash: await gateRead<Hex>(ctx, "currentPolicyHash"),
    carrierActive: await gateRead<boolean>(ctx, "hasRole", [carrier, ROLE.CARRIER]),
    arbiterActive: await gateRead<boolean>(ctx, "hasRole", [arbiter, ROLE.ARBITER]),
    delayTxNonce: await delayRead<bigint>("txNonce"),
    delayQueueNonce: await delayRead<bigint>("queueNonce"),
    paused: await gateRead<boolean>(ctx, "paused"),
  };
  console.log(`  after: ${JSON.stringify(after, (_, x) => (typeof x === "bigint" ? x.toString() : x))}`);
  const policyOk = after.policyHash.toLowerCase() === policyHash.toLowerCase() && after.delayTxNonce === after.delayQueueNonce;

  sink.write({
    caseId: "1.0",
    phase: 1,
    title: "Delay sets the gate policy hash",
    kind: "state-change",
    setup: [queued.tx, executed.tx],
    passed: policyOk,
    details: { policyHashBefore: policyBefore, policyHash, delayNonce: txNonce, createdAt, txCooldown: cooldown, txExpiration: expiration, after },
    notes: [
      "The owner (a Delay module) queued FundingGate.setPolicyHash; after txCooldown anyone may run executeNextTx, here the owner did. The Delay calls the Safe, the Safe calls the gate.",
      "Declared risk: without a ConfigGuard an owner of the Safe could call setPolicyHash directly; the cooldown is a convention the owner keeps.",
    ],
  });
  sink.write({
    caseId: "1.1",
    phase: 1,
    title: "Safe registers the app carrier and arbiter",
    kind: "state-change",
    setup: regSetup,
    passed: after.carrierActive && after.arbiterActive,
    details: { configDelay, changes, activatesAt, appCarrier: carrier, appArbiter: arbiter, registryAfter: { carrier: after.carrierActive, arbiter: after.arbiterActive } },
    notes: [
      "Each change counts only from activatesAt = queue time + configDelay, enforced by FundingGate.",
      "Checked first: neither address is the Safe, a Safe owner, the cosigner, the guardian, the policy signer or the relayer, and neither has code.",
    ],
  });
  if (!policyOk) throw new Error(`policy not set: ${JSON.stringify(after, (_, x) => (typeof x === "bigint" ? x.toString() : x))}`);
  if (!after.carrierActive || !after.arbiterActive) throw new Error("the app carrier or arbiter is not active after configDelay");
}
