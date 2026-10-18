// Phase 1: registries and the gate's rejections, in order. Each step checks the state it needs
// and writes one evidence file.
import type { Hex } from "@keel/schemas";
import { encodeFunctionData, erc20Abi, zeroAddress } from "viem";
import { type Ctx, gateCall, gateEvents, gateRead, latestBlock, safeExec, sendExpectRevert, simulateFrom, waitUntil } from "./chain";
import { checkNotPaused, preflight, ROLE, readRegistry } from "./checks";
import { envAddress, PreconditionError } from "./config";
import { decisionFor, executeCall, intentFor, type OpenedOrder, openOrder, otherCalldataHash, signDecision, trustedParties } from "./orders";
import type { CaseRecord, ExpectedError, Sink, TxRef } from "./record";

export interface Step {
  id: string;
  title: string;
  run(ctx: Ctx, sink: Sink): Promise<void>;
}

// open is sent by the exporter, the deposit attempts by the attacker; the owner only signs
const ORDER_SENDERS = ["exporter", "attacker"] as const;

// 1.3 to 1.7: open an order with `parties`, then the attacker relays a deposit that must revert.
async function gateRejection(
  ctx: Ctx,
  sink: Sink,
  caseId: string,
  title: string,
  expected: ExpectedError,
  order: () => Promise<OpenedOrder>,
  pdr: (o: OpenedOrder) => Promise<{ data: Hex; details: Record<string, unknown> }>,
  notes: string[],
) {
  await preflight(ctx, { usdc: ctx.opts.amount, senders: [...ORDER_SENDERS], registry: "ready" });
  const o = await order();
  const { data, details } = await pdr(o);
  const revert = await sendExpectRevert(ctx, "attacker", ctx.d.fundingGate, data, expected, `${caseId} execute`);
  sink.write({
    caseId,
    phase: 1,
    title,
    kind: "revert",
    setup: [o.open.tx],
    revert,
    passed: true,
    details: { order: o.po, orderHash: o.orderHash, ...details },
    notes,
  });
}

// ------------------------------------------------------------------ 1.1 registrations

export const SUPPLIER = 1;
export const THIRD_PARTY = 2;

export interface Wanted {
  label: string;
  kind: typeof SUPPLIER | typeof THIRD_PARTY;
  subject: Hex;
  payout: Hex;
  roles: number;
}

interface Earlier {
  changeId: bigint;
  activatesAt: bigint;
  tx: TxRef;
}

export const callFor = (ctx: Ctx, w: Wanted) =>
  w.kind === SUPPLIER ? gateCall(ctx, "queueSupplier", [w.subject, w.payout]) : gateCall(ctx, "queueThirdParty", [w.subject, w.roles]);

// The newest change for the same subject that is not vetoed: for a supplier the same pair, for a
// third party any change that includes this role.
async function latestChange(ctx: Ctx, w: Wanted) {
  const count = await gateRead<bigint>(ctx, "changeCount");
  for (let id = count; id >= 1n; id--) {
    const [kind, subject, payout, roles, activatesAt, vetoed] = await gateRead<readonly [number, Hex, Hex, number, bigint, boolean]>(ctx, "changes", [id]);
    if (vetoed || kind !== w.kind || subject !== w.subject) continue;
    if (w.kind === SUPPLIER ? payout === w.payout : (roles & w.roles) !== 0) return { changeId: id, roles, activatesAt };
  }
  return undefined;
}

// The transaction that emitted ChangeQueued(changeId). Its block is the first one whose timestamp
// is the queue time (activatesAt - configDelay, which the gate took from block.timestamp): found
// by binary search over block timestamps, then the logs of that block and the next 9 (some RPC
// plans, like Alchemy's free tier, only serve eth_getLogs over 10 blocks).
async function queuedTx(ctx: Ctx, changeId: bigint, queuedAt: bigint, label: string): Promise<TxRef> {
  const head = await latestBlock(ctx);
  const ts = async (n: bigint) => (await ctx.pub.getBlock({ blockNumber: n })).timestamp;
  // Blocks are at least one second apart, so the queue block is no older than this
  let lo = head.number > head.timestamp - queuedAt ? head.number - (head.timestamp - queuedAt) : 0n;
  let hi = head.number;
  while (lo < hi) {
    const mid = (lo + hi) / 2n;
    if ((await ts(mid)) < queuedAt) lo = mid + 1n;
    else hi = mid;
  }
  const event = ctx.abis.gate.find((x) => x.type === "event" && x.name === "ChangeQueued");
  const logs: { transactionHash: Hex | null }[] = await ctx.pub.getLogs({
    address: ctx.d.fundingGate,
    event: event as never,
    args: { changeId } as never,
    fromBlock: lo,
    toBlock: lo + 9n > head.number ? head.number : lo + 9n,
  });
  const hash = logs[0]?.transactionHash;
  if (!hash) throw new PreconditionError(`change ${changeId} (${label}) is queued but its ChangeQueued log is not in blocks ${lo}..${lo + 9n}`);
  const [receipt, tx] = await Promise.all([ctx.pub.getTransactionReceipt({ hash }), ctx.pub.getTransaction({ hash })]);
  return {
    label: `Safe: ${label} (earlier run)`,
    hash: receipt.transactionHash,
    blockNumber: receipt.blockNumber,
    from: receipt.from,
    to: receipt.to ?? zeroAddress,
    status: receipt.status,
    gasUsed: receipt.gasUsed,
    gasLimit: tx.gas,
  };
}

export async function planRegistrations(ctx: Ctx, wanted: Wanted[]) {
  const configDelay = await gateRead<bigint>(ctx, "configDelay");
  const plan: { w: Wanted; earlier?: Earlier }[] = [];
  for (const w of wanted) {
    const failure = await simulateFrom(ctx, ctx.d.safe, ctx.d.fundingGate, callFor(ctx, w));
    if (!failure) {
      plan.push({ w });
      continue;
    }
    if (failure.name !== "AlreadyRegistered") throw new PreconditionError(`${w.label} would revert with ${failure.name}; nothing sent`);
    const c = await latestChange(ctx, w);
    if (!c || (w.kind === THIRD_PARTY && c.roles !== w.roles)) {
      throw new PreconditionError(
        `${w.label}: already registered with other data (${c ? `change ${c.changeId} has roles ${c.roles}` : "no matching change"}); the Safe must sort it out; nothing sent`,
      );
    }
    plan.push({ w, earlier: { changeId: c.changeId, activatesAt: c.activatesAt, tx: await queuedTx(ctx, c.changeId, c.activatesAt - configDelay, w.label) } });
  }
  return plan;
}

// Both or neither: a half-set pair is a configuration mistake, not a reason to skip it silently.
function appSupplier(): { exporter: Hex; payout: Hex } | undefined {
  const set = ["APP_EXPORTER_ADDRESS", "APP_PAYOUT_ADDRESS"].filter((k) => process.env[k]);
  if (set.length === 0) return undefined;
  if (set.length === 1) throw new PreconditionError("set both APP_EXPORTER_ADDRESS and APP_PAYOUT_ADDRESS, or neither");
  return { exporter: envAddress("APP_EXPORTER_ADDRESS"), payout: envAddress("APP_PAYOUT_ADDRESS") };
}

// Dry-runs each Safe -> gate call before sending any, so a pending entry from an earlier partial
// run (AlreadyRegistered) aborts the step instead of failing it half way.
async function dryRunFromSafe(ctx: Ctx, calls: [label: string, data: Hex][]) {
  for (const [label, data] of calls) {
    const failure = await simulateFrom(ctx, ctx.d.safe, ctx.d.fundingGate, data);
    if (failure) {
      throw new PreconditionError(`${label} would revert with ${failure.name}${failure.name === "AlreadyRegistered" ? " (already active or still pending from an earlier run)" : ""}; nothing sent`);
    }
  }
}

// After the pause of 1.9: unpause, retrying (a lagging RPC can serve a stale Safe nonce), and say
// so loudly if the gate is still paused.
async function ensureUnpaused(ctx: Ctx, setup: TxRef[]) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (!(await gateRead<boolean>(ctx, "paused"))) return;
    try {
      setup.push((await safeExec(ctx, ctx.d.fundingGate, gateCall(ctx, "unpause", []), "unpause()")).tx);
    } catch (err) {
      console.error(`  unpause attempt ${attempt} failed: ${(err as Error).message.split("\n")[0]}`);
      await new Promise((r) => setTimeout(r, 5_000));
    }
  }
  if (await gateRead<boolean>(ctx, "paused")) {
    console.error(`\n!!! GATE STILL PAUSED: the Safe must call unpause() on ${ctx.d.fundingGate} !!!\n`);
    throw new Error("the gate is still paused after 3 unpause attempts");
  }
}

// Signed by DEMO_ATTACKER: the real policy key is not used by this script.
async function attackerPdr(ctx: Ctx, o: OpenedOrder, calldataHash?: Hex) {
  const intent = await intentFor(ctx, o);
  const d = await decisionFor(ctx, intent, calldataHash);
  const sig = await signDecision(ctx, d, ctx.signer("attacker"));
  return { data: executeCall(ctx, intent, d, sig), details: { intent, decision: d, pdrSignedBy: ctx.addr.attacker } };
}

export const PHASE1: Step[] = [
  {
    id: "1.1",
    title: "Safe registers the supplier, carrier, arbiter and document verifier",
    async run(ctx, sink) {
      await preflight(ctx, { senders: ["owner"] });
      const { exporter, payout, carrier, arbiter } = ctx.addr;
      const wanted: Wanted[] = [
        { label: "queueSupplier(DEMO_EXPORTER, DEMO_PAYOUT)", kind: SUPPLIER, subject: exporter, payout, roles: 0 },
        { label: "queueThirdParty(DEMO_CARRIER, CARRIER)", kind: THIRD_PARTY, subject: carrier, payout: zeroAddress, roles: ROLE.CARRIER },
        { label: "queueThirdParty(DEMO_ARBITER, ARBITER)", kind: THIRD_PARTY, subject: arbiter, payout: zeroAddress, roles: ROLE.ARBITER },
        { label: "queueThirdParty(POLICY_SIGNER_ADDRESS, VERIFIER)", kind: THIRD_PARTY, subject: ctx.verifier, payout: zeroAddress, roles: ROLE.VERIFIER },
      ];
      // Optional: the supplier the app uses (APP_EXPORTER_ADDRESS, APP_PAYOUT_ADDRESS)
      const app = appSupplier();
      if (app) wanted.push({ label: "queueSupplier(APP_EXPORTER, APP_PAYOUT)", kind: SUPPLIER, subject: app.exporter, payout: app.payout, roles: 0 });

      // Idempotent: whatever is already pending or active with the same data is skipped (and its
      // ChangeQueued log goes into the evidence); anything registered differently stops the step.
      // Every decision is taken before the first send.
      const plan = await planRegistrations(ctx, wanted);
      const setup: TxRef[] = [];
      const changes: Record<string, unknown>[] = [];
      for (const p of plan.filter((x) => x.earlier)) {
        const e = p.earlier!;
        console.log(`  skip ${p.w.label}: change ${e.changeId} already queued in ${e.tx.hash}`);
        setup.push(e.tx);
        changes.push({ label: p.w.label, changeId: e.changeId, activatesAt: e.activatesAt, queuedEarlier: true });
      }
      for (const p of plan.filter((x) => !x.earlier)) {
        const q = await safeExec(ctx, ctx.d.fundingGate, callFor(ctx, p.w), p.w.label);
        const ev = gateEvents(ctx, q.receipt.logs).find((e) => e.eventName === "ChangeQueued");
        if (!ev) throw new Error(`${p.w.label}: no ChangeQueued event`);
        setup.push(q.tx);
        changes.push({ label: p.w.label, changeId: ev.args.changeId, activatesAt: ev.args.activatesAt, queuedEarlier: false });
      }
      const activatesAt = changes.reduce((m, c) => ((c.activatesAt as bigint) > m ? (c.activatesAt as bigint) : m), 0n);
      const configDelay = await gateRead<bigint>(ctx, "configDelay");
      await waitUntil(ctx, activatesAt, `configDelay (${configDelay} s)`);
      const after = await readRegistry(ctx);
      const appActive = app ? await gateRead<boolean>(ctx, "isKnownSupplier", [app.exporter, app.payout]) : undefined;
      if (!(after.supplier && after.carrier && after.arbiter && after.verifier) || appActive === false) {
        throw new Error(`registrations not active after the wait: ${JSON.stringify({ ...after, appSupplier: appActive })}`);
      }
      sink.write({
        caseId: "1.1",
        phase: 1,
        title: this.title,
        kind: "state-change",
        setup,
        passed: true,
        details: { configDelay, changes, activatesAt, registryAfter: { ...after, appSupplier: appActive }, appSupplier: app },
        notes: [
          "Each change counted only from activatesAt = queue time + configDelay, enforced by FundingGate.",
          ...(plan.some((x) => x.earlier) ? ["Changes marked queuedEarlier were sent by an earlier run of this step; their transaction is the one that emitted ChangeQueued."] : []),
        ],
      });
    },
  },
  {
    id: "1.2",
    title: "Safe queues DEMO_ATTACKER as the supplier payout and vetoes it",
    async run(ctx, sink) {
      const { registry: r } = await preflight(ctx, { senders: ["owner"] });
      if (r.attackerSupplier) throw new PreconditionError("(DEMO_EXPORTER, DEMO_ATTACKER) is already an active supplier");
      const { exporter, attacker } = ctx.addr;
      const queueData = gateCall(ctx, "queueSupplier", [exporter, attacker]);
      await dryRunFromSafe(ctx, [["queueSupplier(DEMO_EXPORTER, DEMO_ATTACKER)", queueData]]);
      const q = await safeExec(ctx, ctx.d.fundingGate, queueData, "queueSupplier(DEMO_EXPORTER, DEMO_ATTACKER)");
      const ev = gateEvents(ctx, q.receipt.logs).find((e) => e.eventName === "ChangeQueued");
      if (!ev) throw new Error("no ChangeQueued event");
      const changeId = ev.args.changeId as bigint;
      const v = await safeExec(ctx, ctx.d.fundingGate, gateCall(ctx, "vetoPending", [changeId]), `vetoPending(${changeId})`);
      const vetoed = gateEvents(ctx, v.receipt.logs).find((e) => e.eventName === "ChangeVetoed");
      const change = await gateRead<readonly unknown[]>(ctx, "changes", [changeId]);
      const stillKnown = await gateRead<boolean>(ctx, "isKnownSupplier", [exporter, attacker]);
      if (!vetoed || change[5] !== true || stillKnown) throw new Error("the veto did not take effect");
      sink.write({
        caseId: "1.2",
        phase: 1,
        title: this.title,
        kind: "state-change",
        setup: [q.tx, v.tx],
        passed: true,
        details: { changeId, queued: ev.args, vetoedBy: vetoed.args.by, isKnownSupplierAfter: stillKnown },
        notes: ["The veto came before activatesAt; the vetoed pair never counts. The cosigner could veto the same way."],
      });
    },
  },
  {
    id: "1.3",
    title: "Deposit for an order whose payout is the vetoed DEMO_ATTACKER",
    run: (ctx, sink) =>
      gateRejection(
        ctx,
        sink,
        "1.3",
        "Deposit for an order whose payout is the vetoed DEMO_ATTACKER",
        { name: "UnknownSupplier" },
        () => openOrder(ctx, { ...trustedParties(ctx), payout: ctx.addr.attacker }, "1.3"),
        (o) => attackerPdr(ctx, o),
        ["Both parties signed the order; the payout pair is not an active supplier of this Safe (step e of execute)."],
      ),
  },
  {
    id: "1.4",
    title: "Deposit for an order whose carrier is not registered",
    run: (ctx, sink) =>
      gateRejection(
        ctx,
        sink,
        "1.4",
        "Deposit for an order whose carrier is not registered",
        { name: "UntrustedParty" },
        () => openOrder(ctx, { ...trustedParties(ctx), carrier: ctx.addr.attacker }, "1.4"),
        (o) => attackerPdr(ctx, o),
        ["Carrier = DEMO_ATTACKER, a key the exporter could control: it would attest the shipment itself."],
      ),
  },
  {
    id: "1.5",
    title: "Deposit for an order whose importer is not this Safe",
    run: (ctx, sink) =>
      gateRejection(
        ctx,
        sink,
        "1.5",
        "Deposit for an order whose importer is not this Safe",
        { name: "NotOwnOrder" },
        () => openOrder(ctx, { ...trustedParties(ctx), importer: "attacker" }, "1.5"),
        (o) => attackerPdr(ctx, o),
        ["The order is real and open, signed by DEMO_ATTACKER as importer and DEMO_EXPORTER; the Safe never signed it."],
      ),
  },
  {
    id: "1.6",
    title: "Deposit whose PDR approved another calldata",
    run: (ctx, sink) =>
      gateRejection(
        ctx,
        sink,
        "1.6",
        "Deposit whose PDR approved another calldata",
        { name: "CalldataMismatch" },
        () => openOrder(ctx, trustedParties(ctx), "1.6"),
        async (o) => {
          const intent = await intentFor(ctx, o);
          return attackerPdr(ctx, o, otherCalldataHash(ctx, intent, ctx.addr.attacker));
        },
        [
          "The PDR's calldataHash is for approve(DEMO_ATTACKER, amount) + fund(orderId); the gate builds its own calldata (step f).",
          "Step f runs before the PDR signature check (step g), so the signer of this PDR does not change the outcome.",
        ],
      ),
  },
  {
    id: "1.7",
    title: "Deposit with a PDR signed by a key that is not the policy signer",
    run: (ctx, sink) =>
      gateRejection(
        ctx,
        sink,
        "1.7",
        "Deposit with a PDR signed by a key that is not the policy signer",
        { name: "BadPolicySignature" },
        () => openOrder(ctx, trustedParties(ctx), "1.7"),
        (o) => attackerPdr(ctx, o),
        ["Order, registries and calldata are all valid; only the signature of the decision is wrong."],
      ),
  },
  {
    id: "1.8",
    title: "Any account calls Roles execTransactionWithRole directly",
    async run(ctx, sink) {
      await preflight(ctx, { senders: ["attacker"], registry: "ready" });
      const agentRoleKey = await gateRead<Hex>(ctx, "agentRoleKey");
      const transfer = encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [ctx.addr.attacker, ctx.opts.amount] });
      const data = encodeFunctionData({
        abi: ctx.abis.roles,
        functionName: "execTransactionWithRole",
        args: [ctx.d.token, 0n, transfer, 0, agentRoleKey, true],
      } as never);
      const revert = await sendExpectRevert(ctx, "attacker", ctx.d.roles, data, { name: "NotAuthorized", args: [ctx.addr.attacker] }, "1.8 Roles");
      sink.write({
        caseId: "1.8",
        phase: 1,
        title: this.title,
        kind: "revert",
        setup: [],
        revert,
        passed: true,
        details: { roleKey: agentRoleKey, innerCall: { to: ctx.d.token, data: transfer, meaning: "USDC.transfer(DEMO_ATTACKER, amount) from the Safe" } },
        notes: ["Roles only executes for its enabled modules (the gate); the direct theft path is closed in Roles itself."],
      });
    },
  },
  {
    id: "1.9",
    title: "Gate paused by the Safe: a deposit reverts, then unpause",
    async run(ctx, sink) {
      await preflight(ctx, { usdc: ctx.opts.amount, senders: ["owner", ...ORDER_SENDERS], registry: "ready" });
      const o = await openOrder(ctx, trustedParties(ctx), "1.9");
      const { data, details } = await attackerPdr(ctx, o);
      const setup: TxRef[] = [o.open.tx];
      let rec: CaseRecord | undefined;
      try {
        // Inside the try: if the pause lands but its receipt is lost, the unpause still runs
        setup.push((await safeExec(ctx, ctx.d.fundingGate, gateCall(ctx, "pause", []), "pause()")).tx);
        const revert = await sendExpectRevert(ctx, "attacker", ctx.d.fundingGate, data, { name: "GateIsPaused" }, "1.9 execute");
        rec = {
          caseId: "1.9",
          phase: 1,
          title: this.title,
          kind: "revert",
          setup,
          revert,
          passed: true,
          details: { order: o.po, ...details },
          notes: ["The pause is the first check of execute (step a); the PDR here is not valid either, and is never reached."],
        };
      } finally {
        // Never leave the gate paused, whatever happened above
        await ensureUnpaused(ctx, setup);
      }
      await checkNotPaused(ctx);
      if (rec) sink.write(rec);
    },
  },
];

export async function runPhase1(ctx: Ctx, sink: Sink, only?: string[]): Promise<void> {
  const steps = only?.length ? PHASE1.filter((s) => only.includes(s.id)) : PHASE1;
  if (only?.length && steps.length !== only.length) throw new PreconditionError(`unknown step in --steps (known: ${PHASE1.map((s) => s.id).join(", ")})`);
  for (const s of steps) {
    console.log(`\n[${s.id}] ${s.title}`);
    await s.run(ctx, sink);
  }
}
