// Phase 3: the escrow's and the gate's rejections around a real deposit. Each function takes the
// orderId (or the transaction hash) of a deposit already made by the real flow, checks the state
// it needs and writes one evidence file. They are independent: run them in any order that keeps
// each precondition (the fork test runs late-attestation last, after moving time).
import { randomBytes } from "node:crypto";
import { EIP712_TYPES, type FundIntent, type Hex, keelDomain, type PurchaseOrder, type ShipmentAttestation } from "@keel/schemas";
import { blNumberHash, bytes32Text } from "@keel/schemas/hash";
import { decodeFunctionData, encodeAbiParameters, keccak256, toBytes } from "viem";
import { type Ctx, checkSafeOwner, escrowCall, escrowRead, gateEvents, gateRead, latestTimestamp, sendExpectRevert, sendOk, waitUntil } from "./chain";
import { checkDeployment, checkGas, checkNotPaused } from "./checks";
import { type Actor, PreconditionError } from "./config";
import type { Sink, TxRef } from "./record";

export const STATE = ["NONE", "OPEN", "ADVANCE_PAID", "SHIPPED", "SETTLED", "REFUNDED", "DISPUTED", "RESOLVED", "CANCELLED"] as const;

interface OrderRecord {
  po: PurchaseOrder;
  state: number;
  orderHash: Hex;
  funded: boolean;
}

async function order(ctx: Ctx, orderId: Hex): Promise<OrderRecord> {
  return escrowRead<OrderRecord>(ctx, "orderOf", [orderId]);
}

async function requireState(ctx: Ctx, orderId: Hex, wanted: (typeof STATE)[number]): Promise<OrderRecord> {
  const o = await order(ctx, orderId);
  const got = STATE[o.state] ?? String(o.state);
  if (got !== wanted) throw new PreconditionError(`order ${orderId} is ${got}, this case needs ${wanted}`);
  if (o.po.importer !== ctx.d.safe) throw new PreconditionError(`order ${orderId} is not an order of the Safe ${ctx.d.safe}`);
  return o;
}

async function base(ctx: Ctx, senders: Actor[]): Promise<void> {
  await checkDeployment(ctx);
  await checkSafeOwner(ctx);
  await checkGas(ctx, senders);
}

function requireCarrier(ctx: Ctx, o: OrderRecord, orderId: Hex) {
  if (o.po.carrier !== ctx.addr.carrier) throw new PreconditionError(`order ${orderId}: its carrier is ${o.po.carrier}, not DEMO_CARRIER`);
}

async function attest(ctx: Ctx, orderId: Hex, bl: Hex, onBoardDate: bigint): Promise<{ att: ShipmentAttestation; sig: Hex }> {
  const att: ShipmentAttestation = {
    orderId,
    blNumberHash: bl,
    onBoardDate,
    portOfLoading: bytes32Text("HKHKG"),
    docsHash: keccak256(toBytes(`keel-evidence/docs/${orderId}`)),
  };
  const sig = await ctx.signer("carrier").signTypedData({
    domain: keelDomain(ctx.chainId, ctx.d.tradeEscrow),
    types: EIP712_TYPES,
    primaryType: "ShipmentAttestation",
    message: att,
  });
  return { att, sig };
}

export const randomBlNumber = () => `KEEL${randomBytes(5).toString("hex").toUpperCase()}`;

// 3.1 The same deposit relayed again from another account: the order is no longer OPEN.
export async function repeatDeposit(ctx: Ctx, sink: Sink, fundTx: Hex): Promise<void> {
  await base(ctx, ["attacker"]);
  await checkNotPaused(ctx);
  const [tx, receipt] = await Promise.all([ctx.pub.getTransaction({ hash: fundTx }), ctx.pub.getTransactionReceipt({ hash: fundTx })]);
  if (receipt.status !== "success" || tx.to?.toLowerCase() !== ctx.d.fundingGate.toLowerCase()) {
    throw new PreconditionError(`${fundTx} is not a successful call to the gate`);
  }
  const funded = gateEvents(ctx, receipt.logs).find((e) => e.eventName === "FundingExecuted");
  if (!funded) throw new PreconditionError(`${fundTx} has no FundingExecuted event`);
  const call = decodeFunctionData({ abi: ctx.abis.gate, data: tx.input });
  if (call.functionName !== "execute") throw new PreconditionError(`${fundTx} is not a call to execute`);
  const intent = (call.args as readonly unknown[])[0] as FundIntent;
  const o = await order(ctx, intent.orderId);
  if (STATE[o.state] === "OPEN") throw new PreconditionError(`order ${intent.orderId} is still OPEN`);
  if (tx.from.toLowerCase() === ctx.addr.attacker.toLowerCase()) throw new PreconditionError("the original deposit was sent by DEMO_ATTACKER; the repeat must come from another account");
  const revert = await sendExpectRevert(ctx, "attacker", ctx.d.fundingGate, tx.input, { name: "OrderNotOpen" }, "3.1 repeat execute");
  sink.write({
    caseId: "3.1",
    phase: 3,
    title: "The same deposit relayed again from another account",
    kind: "revert",
    setup: [],
    revert,
    passed: true,
    details: { originalTx: fundTx, originalSender: tx.from, orderId: intent.orderId, orderState: STATE[o.state], fundingExecuted: funded.args },
    notes: ["Byte-identical calldata (same intent, PDR and signature). The gate stops it at step d, before the PDR nonce (which would also reject it)."],
  });
}

// 3.2 The exporter raises a dispute before the shipment: disputes only exist for SHIPPED orders.
export async function exporterDisputeBeforeShipment(ctx: Ctx, sink: Sink, orderId: Hex): Promise<void> {
  await base(ctx, ["exporter"]);
  const o = await requireState(ctx, orderId, "ADVANCE_PAID");
  if (o.po.exporter !== ctx.addr.exporter) throw new PreconditionError(`order ${orderId}: its exporter is not DEMO_EXPORTER`);
  const revert = await sendExpectRevert(ctx, "exporter", ctx.d.tradeEscrow, escrowCall(ctx, "raiseDispute", [orderId]), { name: "InvalidState" }, "3.2 raiseDispute");
  sink.write({
    caseId: "3.2",
    phase: 3,
    title: "The exporter raises a dispute before the shipment",
    kind: "revert",
    setup: [],
    revert,
    passed: true,
    details: { orderId, state: "ADVANCE_PAID" },
    notes: ["Before the shipment the remedy is the refund after the deadline, not a dispute."],
  });
}

// 3.3 A carrier-signed attestation after shipmentDeadline + refundGrace: the refund is due.
export async function lateAttestation(ctx: Ctx, sink: Sink, orderId: Hex): Promise<void> {
  await base(ctx, ["carrier"]);
  const o = await requireState(ctx, orderId, "ADVANCE_PAID");
  requireCarrier(ctx, o, orderId);
  const grace = await escrowRead<bigint>(ctx, "refundGrace");
  const dueAfter = o.po.shipmentDeadline + grace;
  // _refundDue is strict (now > deadline + grace)
  await waitUntil(ctx, dueAfter + 1n, `shipmentDeadline + refundGrace (${grace} s)`);
  const { att, sig } = await attest(ctx, orderId, blNumberHash(ctx.addr.carrier, randomBlNumber()), o.po.shipmentDeadline);
  const revert = await sendExpectRevert(
    ctx,
    "carrier",
    ctx.d.tradeEscrow,
    escrowCall(ctx, "submitShipment", [orderId, att, sig]),
    { name: "DeadlinePassed" },
    "3.3 submitShipment",
  );
  sink.write({
    caseId: "3.3",
    phase: 3,
    title: "Carrier-signed attestation after shipmentDeadline + refundGrace",
    kind: "revert",
    setup: [],
    revert,
    passed: true,
    details: { orderId, shipmentDeadline: o.po.shipmentDeadline, refundGrace: grace, attestation: att, blockTimestampBefore: await latestTimestamp(ctx) },
    notes: ["The attestation itself is valid (right carrier, on board date = deadline); once the refund is due no shipment is accepted."],
  });
}

// 3.4 The same bill of lading on another order. `orderA` gets the shipment for real if it is
// still ADVANCE_PAID; if it is already SHIPPED, `blNumber` must be the one it was shipped with.
export async function duplicateBl(ctx: Ctx, sink: Sink, orderA: Hex, orderB: Hex, blNumber?: string): Promise<void> {
  await base(ctx, ["carrier"]);
  if (orderA === orderB) throw new PreconditionError("the two orders must differ");
  const a = await order(ctx, orderA);
  if (a.po.importer !== ctx.d.safe) throw new PreconditionError(`order ${orderA} is not an order of the Safe ${ctx.d.safe}`);
  const b = await requireState(ctx, orderB, "ADVANCE_PAID");
  requireCarrier(ctx, b, orderB);
  requireCarrier(ctx, a, orderA);
  const grace = await escrowRead<bigint>(ctx, "refundGrace");
  const now = await latestTimestamp(ctx);
  if (now > b.po.shipmentDeadline) throw new PreconditionError(`order ${orderB}: shipmentDeadline passed; the case would hit ShipmentTooLate or DeadlinePassed first`);

  const setup: TxRef[] = [];
  let number = blNumber;
  if (STATE[a.state] === "ADVANCE_PAID") {
    if (now > a.po.shipmentDeadline) throw new PreconditionError(`order ${orderA}: shipmentDeadline passed, it cannot be shipped`);
    number ??= randomBlNumber();
    // onBoardDate = latest block time: after the funding, not in the future, before the deadline
    const { att, sig } = await attest(ctx, orderA, blNumberHash(ctx.addr.carrier, number), now);
    setup.push((await sendOk(ctx, "carrier", ctx.d.tradeEscrow, escrowCall(ctx, "submitShipment", [orderA, att, sig]), `3.4 ship ${orderA} with BL ${number}`)).tx);
  } else if (STATE[a.state] !== "SHIPPED" || !number) {
    throw new PreconditionError(`order ${orderA} is ${STATE[a.state]}: it must be ADVANCE_PAID, or SHIPPED with --bl <number it was shipped with>`);
  }
  const bl = blNumberHash(ctx.addr.carrier, number);
  const blKey = keccak256(encodeAbiParameters([{ type: "address" }, { type: "bytes32" }], [ctx.addr.carrier, bl]));
  if (!(await escrowRead<boolean>(ctx, "isBlUsed", [blKey]))) throw new PreconditionError(`BL ${number} is not used yet by order ${orderA}`);

  const { att, sig } = await attest(ctx, orderB, bl, await latestTimestamp(ctx));
  const revert = await sendExpectRevert(
    ctx,
    "carrier",
    ctx.d.tradeEscrow,
    escrowCall(ctx, "submitShipment", [orderB, att, sig]),
    { name: "BillOfLadingAlreadyUsed" },
    "3.4 submitShipment",
  );
  sink.write({
    caseId: "3.4",
    phase: 3,
    title: "The same bill of lading on another order",
    kind: "revert",
    setup,
    revert,
    passed: true,
    details: { orderA, orderB, blNumber: number, blNumberHash: bl, blKey, refundGrace: grace, attestation: att },
    notes: ["Signed by the real carrier of both orders; the BL key is (carrier, blNumberHash), used once forever."],
  });
}

