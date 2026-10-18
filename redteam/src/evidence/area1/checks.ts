// State checks run before each phase. Each one aborts with a message that says what is wrong.
import type { Hex } from "@keel/schemas";
import { formatEther, formatUnits } from "viem";
import { safeAbi } from "./abi";
import { type Ctx, checkSafeOwner, escrowRead, gateRead, read, usdcBalance } from "./chain";
import { type Actor, ACTORS, PreconditionError } from "./config";

export const ROLE = { CARRIER: 1, ARBITER: 2, VERIFIER: 4 } as const;

export async function checkDeployment(ctx: Ctx): Promise<void> {
  for (const [name, a] of Object.entries({ safe: ctx.d.safe, roles: ctx.d.roles, tradeEscrow: ctx.d.tradeEscrow, fundingGate: ctx.d.fundingGate })) {
    const code = await ctx.pub.getCode({ address: a });
    if (!code || code === "0x") throw new PreconditionError(`no contract at ${name} ${a}`);
  }
  const [safe, roles, escrow] = await Promise.all([gateRead<Hex>(ctx, "safe"), gateRead<Hex>(ctx, "roles"), gateRead<Hex>(ctx, "escrow")]);
  if (safe !== ctx.d.safe || roles !== ctx.d.roles || escrow !== ctx.d.tradeEscrow) {
    throw new PreconditionError("the gate is not wired to the Safe, Roles and escrow of the deployments file");
  }
  // Phase 1 signs its PDRs with DEMO_ATTACKER: they must fail at the signature check whatever else
  // changes between the simulation and inclusion. True only if no demo key is the policy signer.
  const policySigner = await gateRead<Hex>(ctx, "policySigner");
  for (const [actor, address] of Object.entries(ctx.addr)) {
    if (address === policySigner) throw new PreconditionError(`the gate's policy signer is the ${ACTORS[actor as Actor]} key; the script refuses to run`);
  }
  const escrowToken = await escrowRead<Hex>(ctx, "token");
  if (escrowToken !== ctx.d.token || ctx.d.token !== ctx.d.usdc) throw new PreconditionError("gate, escrow and deployments file disagree on the token");
  await read<bigint>(ctx, ctx.d.safe, safeAbi, "nonce");
}

export async function checkNotPaused(ctx: Ctx): Promise<void> {
  if (await gateRead<boolean>(ctx, "paused")) throw new PreconditionError("the gate is paused: the Safe must call unpause() first");
}

export async function checkSafeUsdc(ctx: Ctx, min: bigint): Promise<bigint> {
  const bal = await usdcBalance(ctx, ctx.d.safe);
  if (bal < min) {
    throw new PreconditionError(`the Safe holds ${formatUnits(bal, 6)} USDC, at least ${formatUnits(min, 6)} USDC needed so only the tested check can fail`);
  }
  return bal;
}

export async function checkGas(ctx: Ctx, actors: Actor[]): Promise<void> {
  for (const a of actors) {
    const bal = await ctx.pub.getBalance({ address: ctx.addr[a] });
    if (bal < ctx.opts.minNative) {
      throw new PreconditionError(`${ACTORS[a]} ${ctx.addr[a]} has ${formatEther(bal)} ETH, at least ${formatEther(ctx.opts.minNative)} needed for gas`);
    }
  }
}

export interface Registry {
  supplier: boolean;
  attackerSupplier: boolean;
  carrier: boolean;
  arbiter: boolean;
  verifier: boolean;
  attackerCarrier: boolean;
}

export async function readRegistry(ctx: Ctx): Promise<Registry> {
  const { exporter, payout, carrier, arbiter, attacker } = ctx.addr;
  const has = (who: Hex, role: number) => gateRead<boolean>(ctx, "hasRole", [who, role]);
  const [supplier, attackerSupplier, c, a, v, ac] = await Promise.all([
    gateRead<boolean>(ctx, "isKnownSupplier", [exporter, payout]),
    gateRead<boolean>(ctx, "isKnownSupplier", [exporter, attacker]),
    has(carrier, ROLE.CARRIER),
    has(arbiter, ROLE.ARBITER),
    has(ctx.verifier, ROLE.VERIFIER),
    has(attacker, ROLE.CARRIER),
  ]);
  return { supplier, attackerSupplier, carrier: c, arbiter: a, verifier: v, attackerCarrier: ac };
}

// After 1.1: the real parties are active; the attacker is neither a supplier payout nor a carrier.
export async function checkRegistryReady(ctx: Ctx): Promise<Registry> {
  const r = await readRegistry(ctx);
  const missing = Object.entries({ supplier: r.supplier, carrier: r.carrier, arbiter: r.arbiter, verifier: r.verifier })
    .filter(([, ok]) => !ok)
    .map(([k]) => k);
  if (missing.length) throw new PreconditionError(`registries not active for: ${missing.join(", ")} (run step 1.1 and wait configDelay)`);
  if (r.attackerSupplier) throw new PreconditionError("(DEMO_EXPORTER, DEMO_ATTACKER) is an active supplier: the Safe must remove it");
  if (r.attackerCarrier) throw new PreconditionError("DEMO_ATTACKER is an active carrier: the Safe must remove it");
  return r;
}

export async function preflight(ctx: Ctx, opts: { usdc?: bigint; senders: Actor[]; registry?: "ready" }) {
  await checkDeployment(ctx);
  const safe = await checkSafeOwner(ctx);
  await checkNotPaused(ctx);
  const safeUsdc = opts.usdc !== undefined ? await checkSafeUsdc(ctx, opts.usdc) : await usdcBalance(ctx, ctx.d.safe);
  await checkGas(ctx, opts.senders);
  const registry = opts.registry === "ready" ? await checkRegistryReady(ctx) : await readRegistry(ctx);
  console.log(
    `  preflight ok: owners ${safe.owners.length} (threshold ${safe.threshold}), gate not paused, Safe ${formatUnits(safeUsdc, 6)} USDC, registry ${JSON.stringify(registry)}`,
  );
  return { safe, safeUsdc, registry };
}
