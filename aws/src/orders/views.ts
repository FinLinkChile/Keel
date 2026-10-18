// Read-only views over the orders table for the app: one order, the caller's orders, what the
// caller has to do now, and the Safe's wallet. Everything comes from DynamoDB; the chain state is
// the indexer's mirror (`chain`), so it lags the chain by the indexer's delay and says so with
// `chain.updatedBlock`. Nothing here asks the chain or changes anything.
import { BatchGetCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import type { Hex } from "@keel/schemas";
import { represents } from "../auth";
import { type Env, table } from "../config";
import { ddb, lower } from "../db";
import { HttpError } from "../http";
import type { OrderItem, ProposalItem } from "../tables";
import { attestationHashOf, poFrom } from "./codec";
import { getParties, identities, representedSafes } from "./parties";
import { type Ctx, listProposals, queryIndex } from "./proposals";
import { advanceOf, CANCELLABLE_STATES, lockedIn } from "./rules";

export type Role = "importer" | "exporter" | "carrier" | "arbiter";

export interface OrderView {
  orderId: Hex;
  label?: string;
  safe: string;
  exporter: string;
  order: Record<string, unknown>;
  terms: Record<string, unknown>;
  sigImporter: Hex;
  sigExporter: Hex;
  shipment?: OrderItem["shipment"];
  // Only the hashes of the files ingest read; the extractions stay server side
  documents?: { fileHashes: Hex[] };
  closing?: OrderItem["closing"];
  // Escrow state from the indexer's mirror; "NONE" until it sees OrderOpened
  state: string;
  chain?: OrderItem["chain"];
  // Token minor units, decimal strings
  totalAmount: string;
  advance: string;
  locked: string;
  createdAt: number;
  you: Role[];
}

export const stateOf = (o: Pick<OrderItem, "chain">) => o.chain?.state ?? "NONE";

export function orderView(o: OrderItem, you: Role[]): OrderView {
  const po = poFrom(o.order);
  const { documents, uploaders: _uploaders, ...rest } = o;
  return {
    ...rest,
    ...(documents && { documents: { fileHashes: documents.fileHashes } }),
    state: stateOf(o),
    totalAmount: po.totalAmount.toString(),
    advance: advanceOf(po).toString(),
    locked: lockedIn(o.chain?.state, po).toString(),
    you,
  };
}

// The roles the caller has in an order: importer through a Safe it represents, the exporter
// itself or through its representatives, the carrier and the arbiter themselves.
export async function rolesIn(signer: Hex, o: OrderItem, env?: Env): Promise<Role[]> {
  const po = poFrom(o.order);
  const items = await getParties([o.safe, o.exporter], env);
  const you: Role[] = [];
  if (represents(signer, o.safe, items.get(o.safe)?.representatives)) you.push("importer");
  if (represents(signer, o.exporter, items.get(o.exporter)?.representatives)) you.push("exporter");
  if (represents(signer, po.carrier)) you.push("carrier");
  if (represents(signer, po.arbiter)) you.push("arbiter");
  return you;
}

export async function loadOrder(orderId: string, env?: Env): Promise<OrderItem> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(orderId)) throw new HttpError(404, "not_found");
  const r = await ddb().send(new GetCommand({ TableName: table("orders", env), Key: { orderId: lower(orderId) }, ConsistentRead: true }));
  if (!r.Item) throw new HttpError(404, "not_found");
  return r.Item as OrderItem;
}

// Only the parties of the order (and their representatives) see it. A stranger gets the same 404
// as an unknown id, so it cannot probe which orders exist.
export async function getOrder(signer: Hex, orderId: string, env?: Env): Promise<OrderView> {
  const o = await loadOrder(orderId, env);
  const you = await rolesIn(signer, o, env);
  if (!you.length) throw new HttpError(404, "not_found");
  return orderView(o, you);
}

async function batchOrders(ids: readonly string[], env?: Env): Promise<OrderItem[]> {
  const t = table("orders", env);
  const out: OrderItem[] = [];
  const keys = [...new Set(ids.map(lower))];
  for (let i = 0; i < keys.length; i += 100) {
    let request: Record<string, { Keys: Record<string, unknown>[] }> | undefined = { [t]: { Keys: keys.slice(i, i + 100).map((orderId) => ({ orderId })) } };
    while (request && Object.keys(request).length) {
      const r = await ddb().send(new BatchGetCommand({ RequestItems: request }));
      out.push(...((r.Responses?.[t] ?? []) as OrderItem[]));
      request = r.UnprocessedKeys as typeof request;
    }
  }
  return out;
}

// The caller's orders as importer (orders of the Safes it represents, GSI bySafe) and as exporter
// (its fully signed proposals, GSI byExporter of proposals, since orders have no exporter index).
// Carrier and arbiter orders are not listed: those parties open an order by its id.
export async function listOrders(signer: Hex, ctx: Ctx): Promise<OrderView[]> {
  const ids = await identities(signer, ctx.safe, ctx.env);
  const found = new Map<string, OrderItem>();
  for (const id of ids) {
    for (const o of await queryIndex<OrderItem>(table("orders", ctx.env), "bySafe", "safe", id)) found.set(o.orderId, o);
    const signed = (await queryIndex<ProposalItem>(table("proposals", ctx.env), "byExporter", "exporter", id)).filter((p) => p.status === "fully_signed");
    for (const o of await batchOrders(signed.map((p) => p.orderId), ctx.env)) found.set(o.orderId, o);
  }
  const views: OrderView[] = [];
  for (const o of found.values()) {
    const you = await rolesIn(signer, o, ctx.env);
    if (you.length) views.push(orderView(o, you));
  }
  return views.sort((a, b) => b.createdAt - a.createdAt);
}

// ---------------------------------------------------------------- what needs you

export type NeedAction =
  | "sign_as_exporter"
  | "sign_as_importer"
  | "approve_balance"
  | "sign_cancel"
  | "upload_documents";

export interface Need {
  action: NeedAction;
  orderId: Hex;
  label?: string;
  as: "importer" | "exporter";
  // sign_cancel: the nonce the other side signed, which this side must sign too
  cancelNonce?: string;
  // approve_balance: the attestation the importer would accept
  attestationHash?: Hex;
}

// What the caller can do now and nobody else will do for it. Built from the stored data only:
//   sign_as_exporter     proposal awaiting_exporter, caller acts for the exporter
//   sign_as_importer     proposal awaiting_importer, caller acts for the importer
//   approve_balance      order SHIPPED with no BalanceApproval yet, caller acts for the importer
//                        (optional: the balance also leaves with the verifier's DocumentDecision)
//   sign_cancel          the other side signed a cancellation in the state the mirror still shows, this side not
//   upload_documents     order ADVANCE_PAID without documents, caller is one of its uploaders
// Carrier attestations and arbiter resolutions are not listed: those parties have no index here.
export async function needsYou(signer: Hex, ctx: Ctx): Promise<Need[]> {
  const needs: Need[] = [];
  for (const p of await listProposals(signer, ctx)) {
    if (p.status === "awaiting_exporter" && p.you.includes("exporter")) needs.push({ action: "sign_as_exporter", orderId: p.orderId, label: p.label, as: "exporter" });
    if (p.status === "awaiting_importer" && p.you.includes("importer")) needs.push({ action: "sign_as_importer", orderId: p.orderId, label: p.label, as: "importer" });
  }
  const me = lower(signer);
  for (const v of await listOrders(signer, ctx)) {
    const base = { orderId: v.orderId, ...(v.label && { label: v.label }) };
    if (v.state === "SHIPPED" && v.you.includes("importer") && !v.closing?.balanceApproval) {
      const o = await loadOrder(v.orderId, ctx.env);
      const attestationHash = attestationHashOf(o);
      needs.push({ action: "approve_balance", ...base, as: "importer", ...(attestationHash && { attestationHash }) });
    }
    const cancel = v.closing?.cancel;
    // The pair counts only while the mirror still shows the state the cancellation was signed in:
    // a state change moves the escrow's cancel nonce, so the stored one would be dead
    if (cancel && cancel.state === v.state && (CANCELLABLE_STATES as readonly string[]).includes(v.state)) {
      if (v.you.includes("importer") && !cancel.sigImporter && cancel.sigExporter) needs.push({ action: "sign_cancel", ...base, as: "importer", cancelNonce: cancel.cancelNonce });
      if (v.you.includes("exporter") && !cancel.sigExporter && cancel.sigImporter) needs.push({ action: "sign_cancel", ...base, as: "exporter", cancelNonce: cancel.cancelNonce });
    }
    if (v.state === "ADVANCE_PAID" && !v.documents) {
      const o = await loadOrder(v.orderId, ctx.env);
      const mine = o.uploaders.find((u) => lower(u.address) === me);
      if (mine) needs.push({ action: "upload_documents", ...base, as: mine.party });
    }
  }
  return needs;
}

// ---------------------------------------------------------------- wallet

export interface WalletView {
  safe: string;
  // Orders by escrow state (mirror), "NONE" for signed orders the escrow has not opened yet
  byState: Record<string, number>;
  // Held by the escrow for this Safe's orders (balance after the advance), token minor units
  locked: string;
  // Totals of signed orders not funded yet (NONE and OPEN): what the Safe will deposit
  pendingFunding: string;
  orders: { orderId: Hex; label?: string; state: string; totalAmount: string; locked: string }[];
}

export async function wallet(signer: Hex, ctx: Ctx, only?: string): Promise<WalletView[]> {
  let safes = await representedSafes(signer, ctx.safe, ctx.env);
  if (only) {
    if (!safes.includes(lower(only))) throw new HttpError(403, "not_representative");
    safes = [lower(only)];
  }
  const out: WalletView[] = [];
  for (const safe of safes) {
    const orders = await queryIndex<OrderItem>(table("orders", ctx.env), "bySafe", "safe", safe);
    const byState: Record<string, number> = {};
    let locked = 0n;
    let pending = 0n;
    const rows: WalletView["orders"] = [];
    for (const o of orders.sort((a, b) => b.createdAt - a.createdAt)) {
      const po = poFrom(o.order);
      const state = stateOf(o);
      byState[state] = (byState[state] ?? 0) + 1;
      const held = lockedIn(o.chain?.state, po);
      locked += held;
      if (state === "NONE" || state === "OPEN") pending += po.totalAmount;
      rows.push({ orderId: o.orderId, ...(o.label && { label: o.label }), state, totalAmount: po.totalAmount.toString(), locked: held.toString() });
    }
    out.push({ safe, byState, locked: locked.toString(), pendingFunding: pending.toString(), orders: rows });
  }
  return out;
}
