// Signatures that move an open order, collected by the API and submitted by the agent on its next
// pass (docs/flujo/paso-5-saldo.md, docs/flujo/disputa-y-cancelacion.md):
//
//   POST /shipments                         carrier       ShipmentAttestation -> OrderItem.shipment
//   POST /orders/{id}/approve-balance       importer      BalanceApproval     -> closing.balanceApproval
//   POST /orders/{id}/cancel-signature      either party  CancelOrder         -> closing.cancel
//   POST /disputes/{id}/resolution          arbiter       DisputeResolution   -> closing.resolution
//
// Each signature is checked here exactly as TradeEscrow will check it (same EIP-712 digest in the
// escrow's domain, same signer from the signed PurchaseOrder, ECDSA or ERC-1271), so the agent is
// not handed something that can only revert. The escrow checks it all again: storing a signature
// here moves nothing. Who may send each one is checked against the order, never against the body.
import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { Hex, ShipmentAttestation } from "@keel/schemas";
import { structHash } from "@keel/schemas/hash";
import { z } from "zod";
import { type Env, table } from "../config";
import { ddb, isConditionFailed } from "../db";
import { HttpError } from "../http";
import type { OrderItem } from "../tables";
import { chainDeps, escrowDigest } from "./chain";
import { attestationHashOf, poFrom, ShipmentAttestationWire, signature, toJson, uintText } from "./codec";
import { actsFor } from "./parties";
import { type Ctx } from "./proposals";
import { advanceOf, CANCELLABLE_STATES, isFinal } from "./rules";
import { loadOrder, stateOf } from "./views";

// ---------------------------------------------------------------- wire

export const ShipmentBody = z.strictObject({ attestation: ShipmentAttestationWire, sigCarrier: signature });
export const ApproveBalanceBody = z.strictObject({
  // EIP-712 struct hash of the ShipmentAttestation the importer accepts
  attestationHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/) as unknown as z.ZodType<Hex>,
  signature,
});
export const CancelBody = z.strictObject({
  // cancelNonceOf(orderId) as read right before signing, decimal string
  nonce: uintText,
  signature,
  // Only needed when the caller acts for both sides
  side: z.enum(["importer", "exporter"]).optional(),
});
export const ResolutionBody = z.strictObject({ toImporter: uintText, toExporter: uintText, signature });

// ---------------------------------------------------------------- guarded write

// Writes `shipment` or `closing` on the condition that nobody wrote either since `o` was read.
// Returns false when it lost; callers read again and retry (a few times at most).
async function writeIfUnchanged(o: OrderItem, field: "shipment" | "closing", value: unknown, env?: Env): Promise<boolean> {
  const prev = o.rev;
  try {
    await ddb().send(
      new UpdateCommand({
        TableName: table("orders", env),
        Key: { orderId: o.orderId },
        UpdateExpression: "SET #f = :v, rev = :next",
        ConditionExpression: prev === undefined ? "attribute_exists(orderId) AND attribute_not_exists(rev)" : "rev = :prev",
        ExpressionAttributeNames: { "#f": field },
        ExpressionAttributeValues: { ":v": value, ":next": (prev ?? 0) + 1, ...(prev !== undefined && { ":prev": prev }) },
      }),
    );
    return true;
  } catch (e) {
    if (isConditionFailed(e)) return false;
    throw e;
  }
}

// Read, decide, write; again on a lost race. `apply` throws HttpError to refuse.
async function update(orderId: string, env: Env | undefined, apply: (o: OrderItem) => Promise<{ field: "shipment" | "closing"; value: unknown } | null>) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const o = await loadOrder(orderId, env);
    const change = await apply(o);
    if (!change) return o;
    if (await writeIfUnchanged(o, change.field, change.value, env)) return { ...o, [change.field]: change.value, rev: (o.rev ?? 0) + 1 };
  }
  throw new HttpError(409, "conflict");
}

const finalRefused = (o: OrderItem) => {
  if (isFinal(o.chain?.state)) throw new HttpError(409, "invalid_state", { state: stateOf(o) });
};

// ---------------------------------------------------------------- shipment

export async function attest(signer: Hex, body: z.infer<typeof ShipmentBody>, ctx: Ctx) {
  const att: ShipmentAttestation = body.attestation;
  const saved = await update(att.orderId, ctx.env, async (o) => {
    const po = poFrom(o.order);
    if (!(await actsFor(signer, po.carrier, ctx.env))) throw new HttpError(403, "not_carrier");
    // After the escrow accepted a shipment the stored one is frozen: it is what the balance names
    const state = stateOf(o);
    if (state !== "NONE" && state !== "OPEN" && state !== "ADVANCE_PAID") throw new HttpError(409, "invalid_state", { state });
    // What submitShipment refuses anyway (InvalidAttestation, ShipmentTooLate); `fundedAt` is not
    // mirrored, so "not before the deposit" is left to the escrow and the agent
    if (att.onBoardDate > BigInt(ctx.now)) throw new HttpError(422, "invalid_attestation");
    if (att.onBoardDate > po.shipmentDeadline) throw new HttpError(422, "shipment_too_late");
    const digest = escrowDigest(ctx.chainId, ctx.escrow, "ShipmentAttestation", att);
    if (!(await (await chainDeps(ctx.env)).verify(po.carrier, digest, body.sigCarrier))) throw new HttpError(422, "bad_carrier_signature");
    const value = { attestation: toJson(att), sigCarrier: body.sigCarrier };
    // The same attestation again is not a change
    if (o.shipment && JSON.stringify(o.shipment) === JSON.stringify(value)) return null;
    return { field: "shipment", value };
  });
  return { orderId: saved.orderId, attestationHash: structHash("ShipmentAttestation", att), shipment: saved.shipment };
}

// ---------------------------------------------------------------- closing signatures

const closingOf = (o: OrderItem): NonNullable<OrderItem["closing"]> => ({ ...(o.closing ?? {}) });

export async function approveBalance(signer: Hex, orderId: string, body: z.infer<typeof ApproveBalanceBody>, ctx: Ctx) {
  const saved = await update(orderId, ctx.env, async (o) => {
    const po = poFrom(o.order);
    if (!(await actsFor(signer, po.importer, ctx.env))) throw new HttpError(403, "not_importer");
    finalRefused(o);
    // approveBalance hashes the attestation the escrow accepted; the stored one is that one
    const expected = attestationHashOf(o);
    if (!expected) throw new HttpError(409, "no_shipment");
    if (expected.toLowerCase() !== body.attestationHash.toLowerCase()) throw new HttpError(409, "attestation_mismatch", { attestationHash: expected });
    const digest = escrowDigest(ctx.chainId, ctx.escrow, "BalanceApproval", { orderId: o.orderId, attestationHash: expected });
    if (!(await (await chainDeps(ctx.env)).verify(po.importer, digest, body.signature))) throw new HttpError(422, "bad_importer_signature");
    return { field: "closing", value: { ...closingOf(o), balanceApproval: { sigImporter: body.signature, attestationHash: expected } } };
  });
  return { orderId: saved.orderId, closing: saved.closing };
}

export async function cancelSignature(signer: Hex, orderId: string, body: z.infer<typeof CancelBody>, ctx: Ctx) {
  const saved = await update(orderId, ctx.env, async (o) => {
    const po = poFrom(o.order);
    const [asImporter, asExporter] = [await actsFor(signer, po.importer, ctx.env), await actsFor(signer, po.exporter, ctx.env)];
    const side = body.side ?? (asImporter && !asExporter ? "importer" : asExporter && !asImporter ? "exporter" : undefined);
    if (!side) throw new HttpError(asImporter ? 400 : 403, asImporter ? "side_required" : "not_a_party");
    if ((side === "importer" && !asImporter) || (side === "exporter" && !asExporter)) throw new HttpError(403, "not_a_party");
    // NONE is let through: the mirror may not have seen OrderOpened yet. The nonce below is read
    // from the escrow itself, so a signature stored here always matches the escrow's real state.
    const state = stateOf(o);
    if (state !== "NONE" && !(CANCELLABLE_STATES as readonly string[]).includes(state)) throw new HttpError(409, "invalid_state", { state });

    const deps = await chainDeps(ctx.env);
    // The nonce is the escrow's, read now: a signature for another state or version is worthless
    const current = await deps.cancelNonceOf(ctx.escrow, o.orderId);
    if (BigInt(body.nonce) !== current) throw new HttpError(409, "stale_cancel_nonce", { cancelNonce: current.toString() });
    const party = side === "importer" ? po.importer : po.exporter;
    const digest = escrowDigest(ctx.chainId, ctx.escrow, "CancelOrder", { orderId: o.orderId, nonce: current });
    if (!(await deps.verify(party, digest, body.signature))) throw new HttpError(422, side === "importer" ? "bad_importer_signature" : "bad_exporter_signature");

    const closing = closingOf(o);
    // A pair for an older nonce is dropped: the escrow would refuse it
    const kept = closing.cancel && closing.cancel.cancelNonce === current.toString() ? closing.cancel : { cancelNonce: current.toString() };
    const key = side === "importer" ? "sigImporter" : "sigExporter";
    return { field: "closing", value: { ...closing, cancel: { ...kept, [key]: body.signature } } };
  });
  const cancel = saved.closing?.cancel;
  return { orderId: saved.orderId, closing: saved.closing, complete: !!(cancel?.sigImporter && cancel?.sigExporter) };
}

export async function resolution(signer: Hex, orderId: string, body: z.infer<typeof ResolutionBody>, ctx: Ctx) {
  const saved = await update(orderId, ctx.env, async (o) => {
    const po = poFrom(o.order);
    if (!(await actsFor(signer, po.arbiter, ctx.env))) throw new HttpError(403, "not_arbiter");
    finalRefused(o);
    const toImporter = BigInt(body.toImporter);
    const toExporter = BigInt(body.toExporter);
    // resolve() splits exactly the remaining balance: total minus the advance paid inside fund
    if (toImporter + toExporter !== po.totalAmount - advanceOf(po)) throw new HttpError(422, "bad_resolution");
    const digest = escrowDigest(ctx.chainId, ctx.escrow, "DisputeResolution", { orderId: o.orderId, toImporter, toExporter });
    if (!(await (await chainDeps(ctx.env)).verify(po.arbiter, digest, body.signature))) throw new HttpError(422, "bad_arbiter_signature");
    return { field: "closing", value: { ...closingOf(o), resolution: { toImporter: body.toImporter, toExporter: body.toExporter, sigArbiter: body.signature } } };
  });
  return { orderId: saved.orderId, closing: saved.closing };
}
