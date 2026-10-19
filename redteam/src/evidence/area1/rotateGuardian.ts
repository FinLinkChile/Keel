// Rotates the gate's guardian from the Safe (FundingGate.setGuardian), with the same nonce
// handling as the other steps: GUARDIAN_OLD_ADDRESS must be the current guardian and
// GUARDIAN_ADDRESS becomes the new one. Checks the GuardianSet event and guardian(), and that the
// new key can pause (eth_call of emergencyPause, never sent) while the old one no longer can.
// With `tx` (a setGuardian already mined) nothing is sent: the same checks run on that receipt.
import type { Hex } from "@keel/schemas";
import { zeroAddress } from "viem";
import { checkPlainAccounts } from "./appSetup";
import { type Ctx, gateCall, gateEvents, gateRead, type Sent, safeExec, seeBlock, simulateFrom } from "./chain";
import { checkNotPaused, preflight } from "./checks";
import { envAddress, PreconditionError } from "./config";
import type { Sink } from "./record";

const same = (a: Hex, b: Hex) => a.toLowerCase() === b.toLowerCase();

// A setGuardian the Safe already sent: its receipt, as if this run had sent it.
async function minedRotation(ctx: Ctx, hash: Hex): Promise<Sent> {
  const [receipt, tx] = await Promise.all([ctx.pub.getTransactionReceipt({ hash }), ctx.pub.getTransaction({ hash })]);
  if (receipt.status !== "success") throw new PreconditionError(`${hash} reverted`);
  if (!same(receipt.to ?? zeroAddress, ctx.d.safe)) throw new PreconditionError(`${hash} was not sent to the Safe`);
  seeBlock(ctx, receipt.blockNumber);
  const label = "Safe: setGuardian(GUARDIAN_ADDRESS)";
  console.log(`  mined ${label}  ${hash} (block ${receipt.blockNumber}); nothing sent`);
  return {
    tx: { label, hash, blockNumber: receipt.blockNumber, from: receipt.from, to: receipt.to ?? zeroAddress, status: receipt.status, gasUsed: receipt.gasUsed, gasLimit: tx.gas },
    receipt,
  };
}

export async function rotateGuardian(ctx: Ctx, sink: Sink, minedTx?: Hex) {
  await preflight(ctx, { senders: minedTx ? [] : ["owner"] });
  const next = envAddress("GUARDIAN_ADDRESS");
  const old = envAddress("GUARDIAN_OLD_ADDRESS");
  const before = await gateRead<Hex>(ctx, "guardian");
  let sent: Sent;
  if (minedTx) {
    if (!same(before, next)) throw new PreconditionError(`--tx given but the gate's guardian is ${before}, not GUARDIAN_ADDRESS ${next}`);
    sent = await minedRotation(ctx, minedTx);
  } else {
    if (same(before, next)) throw new PreconditionError(`the gate's guardian is already ${next}; nothing sent (pass --tx <setGuardian hash> to check it)`);
    if (!same(before, old)) throw new PreconditionError(`the gate's guardian is ${before}, not GUARDIAN_OLD_ADDRESS ${old}; nothing sent`);
    // The old guardian is the current one, so the check also rejects next == old
    await checkPlainAccounts(ctx, { GUARDIAN_ADDRESS: next }, "new guardian");
    const data = gateCall(ctx, "setGuardian", [next]);
    const dry = await simulateFrom(ctx, ctx.d.safe, ctx.d.fundingGate, data);
    if (dry) throw new PreconditionError(`setGuardian from the Safe would revert with ${dry.name}; nothing sent`);
    sent = await safeExec(ctx, ctx.d.fundingGate, data, "setGuardian(GUARDIAN_ADDRESS)");
  }

  const ev = gateEvents(ctx, sent.receipt.logs).find((e) => e.eventName === "GuardianSet");
  const after = await gateRead<Hex>(ctx, "guardian");
  const pauseData = gateCall(ctx, "emergencyPause", []);
  // eth_call only: null means it would succeed
  const newPause = await simulateFrom(ctx, next, ctx.d.fundingGate, pauseData);
  const newCanPause = newPause === null;
  const oldPause = await simulateFrom(ctx, old, ctx.d.fundingGate, pauseData);
  await checkNotPaused(ctx);

  const eventOk = !!ev && same(ev.args.previousGuardian as Hex, old) && same(ev.args.guardian as Hex, next);
  const passed = eventOk && same(after, next) && newCanPause && oldPause?.name === "OnlyPauser";
  console.log(`  guardian ${old} -> ${after}; event ${eventOk ? "ok" : "MISSING OR WRONG"}; eth_call emergencyPause: new ${newCanPause ? "succeeds" : "FAILS"}, old ${oldPause?.name ?? "SUCCEEDS"}`);
  sink.write({
    caseId: "1.10",
    phase: 1,
    title: "Safe rotates the gate guardian",
    kind: "state-change",
    setup: [sent.tx],
    passed,
    details: {
      previousGuardian: old,
      guardian: next,
      guardianSetEvent: ev?.args,
      guardianAfter: after,
      emergencyPauseEthCall: { fromNewGuardian: newPause ?? "succeeds", fromOldGuardian: oldPause ?? "succeeds" },
      pausedAfter: false,
    },
    notes: [
      "The previous guardian key was lost; the Safe replaced it with setGuardian, Safe only.",
      "emergencyPause was only simulated with eth_call from both addresses, never sent: the gate stays unpaused.",
      "Checked first: the new address is not the Safe, a Safe owner, the cosigner, the policy signer or the relayer, and has no code.",
    ],
  });
  if (!passed) throw new Error("guardian rotation did not check out; see the evidence file");
}
