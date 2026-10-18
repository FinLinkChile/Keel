// Proposals: the PurchaseOrder on its way to two signatures (docs/flujo/paso-1-firma-orden.md).
// The moves are the app's (app/src/data/proposalFlow.ts), now on a server shared by both sides:
//
//   POST /proposals                     importer representative     -> awaiting_exporter
//   POST …/exporter-signature           exporter (may counter)      awaiting_exporter -> awaiting_importer
//   POST …/importer-signature           importer representative     awaiting_importer -> fully_signed
//   POST …/reject                       either side                 awaiting_* -> rejected
//
// The importer signs last, over a version the supplier already signed. Every signature is checked
// here the way TradeEscrow.open will check it (ECDSA or ERC-1271 over the escrow's EIP-712 digest),
// so a stored `fully_signed` proposal is one `open` should accept; `open` checks it all again.
// `fully_signed` is what the registrar's Stream filter waits for: the order then exists for the
// agent, which opens and funds it. The API itself never calls the chain to change anything.
//
// Each transition is one conditional write on the status it leaves, so two signatures sent at the
// same time cannot overwrite each other: the second gets 409 wrong_status.
import { GetCommand, PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { Hex, OrderTerms, PurchaseOrder } from "@keel/schemas";
import { z } from "zod";
import { type Env, table } from "../config";
import { ddb, isConditionFailed, lower } from "../db";
import { HttpError } from "../http";
import type { ProposalItem, ProposalStatus } from "../tables";
import { chainDeps, escrowDigest } from "./chain";
import { OrderTermsWire, PurchaseOrderWire, poFrom, signature, termsFrom, toJson } from "./codec";
import { actsFor, identities } from "./parties";
import { checkOrder, LABEL, labelOf, orderDifferences, same } from "./rules";

export interface Ctx {
  chainId: number;
  escrow: Hex;
  safe: Hex;
  // The escrow's token, when the deployment publishes it
  token?: Hex;
  now: number;
  env?: Env;
}

// ---------------------------------------------------------------- wire

export const CreateBody = z.strictObject({
  po: PurchaseOrderWire,
  terms: OrderTermsWire,
  // "PO-0131"; derived from terms.orderNumber when absent
  label: z.string().regex(LABEL).optional(),
  // What the importer typed about the goods. Free text between the two companies: never signed,
  // never sent to the bot (notices carry no free text).
  goods: z.string().max(500).optional(),
});

export const ExporterBody = z.strictObject({
  signature,
  // A counter offer: the order the exporter signs instead. Same orderId (same importer, exporter
  // and nonce); the original stays in `proposed` and the importer sees the differences.
  po: PurchaseOrderWire.optional(),
  terms: OrderTermsWire.optional(),
});

export const ImporterBody = z.strictObject({ signature });

export interface ProposalView {
  orderId: Hex;
  status: ProposalStatus;
  label?: string;
  goods?: string;
  importer: string;
  exporter: string;
  po: Record<string, unknown>;
  terms: Record<string, unknown>;
  proposed: { po: Record<string, unknown>; terms: Record<string, unknown> };
  // Fields where po/terms differ from `proposed` (a counter offer), app names
  differences: string[];
  sigExporter?: Hex;
  sigImporter?: Hex;
  importerSigner?: string;
  createdAt: number;
  updatedAt: number;
  exporterSignedAt?: number;
  importerSignedAt?: number;
  rejectedBy?: string;
  // The sides the caller acts for in this proposal
  you: ("importer" | "exporter")[];
}

export function proposalView(item: ProposalItem, you: ProposalView["you"]): ProposalView {
  const proposed = item.proposed ?? { po: item.po, terms: item.terms };
  let differences: string[] = [];
  try {
    differences = orderDifferences({ po: poFrom(item.po), terms: termsFrom(item.terms) }, { po: poFrom(proposed.po), terms: termsFrom(proposed.terms) });
  } catch {
    // An item that does not revive has nothing sensible to compare
  }
  const { po, terms, ...rest } = item;
  return { ...rest, po, terms, proposed, differences, you };
}

// ---------------------------------------------------------------- reads

export async function loadProposal(orderId: string, env?: Env): Promise<ProposalItem> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(orderId)) throw new HttpError(404, "not_found");
  const r = await ddb().send(new GetCommand({ TableName: table("proposals", env), Key: { orderId: lower(orderId) }, ConsistentRead: true }));
  if (!r.Item) throw new HttpError(404, "not_found");
  return r.Item as ProposalItem;
}

async function sides(signer: Hex, item: Pick<ProposalItem, "importer" | "exporter">, env?: Env): Promise<ProposalView["you"]> {
  const you: ProposalView["you"] = [];
  if (await actsFor(signer, item.importer, env)) you.push("importer");
  if (await actsFor(signer, item.exporter, env)) you.push("exporter");
  return you;
}

export async function getProposal(signer: Hex, orderId: string, ctx: Ctx): Promise<ProposalView> {
  const item = await loadProposal(orderId, ctx.env);
  const you = await sides(signer, item, ctx.env);
  // Same answer as an unknown id: a stranger learns nothing about which orders exist
  if (!you.length) throw new HttpError(404, "not_found");
  return proposalView(item, you);
}

export async function queryIndex<T>(tableName: string, index: string, attribute: string, value: string): Promise<T[]> {
  const out: T[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const r = await ddb().send(
      new QueryCommand({
        TableName: tableName,
        IndexName: index,
        KeyConditionExpression: "#k = :v",
        ExpressionAttributeNames: { "#k": attribute },
        ExpressionAttributeValues: { ":v": value },
        ExclusiveStartKey,
      }),
    );
    out.push(...((r.Items ?? []) as T[]));
    ExclusiveStartKey = r.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return out;
}

// Every proposal where the caller is the importer (through a Safe it represents) or the exporter
// (itself or a party it represents). Newest first. Optional filter by status.
export async function listProposals(signer: Hex, ctx: Ctx, status?: string): Promise<ProposalView[]> {
  const ids = await identities(signer, ctx.safe, ctx.env);
  const t = table("proposals", ctx.env);
  const byId = new Map<string, { item: ProposalItem; you: Set<"importer" | "exporter"> }>();
  for (const id of ids) {
    for (const [index, attribute, side] of [
      ["byImporter", "importer", "importer"],
      ["byExporter", "exporter", "exporter"],
    ] as const) {
      for (const item of await queryIndex<ProposalItem>(t, index, attribute, id)) {
        const entry = byId.get(item.orderId) ?? { item, you: new Set() };
        entry.you.add(side);
        byId.set(item.orderId, entry);
      }
    }
  }
  return [...byId.values()]
    .filter(({ item }) => !status || item.status === status)
    .sort((a, b) => b.item.createdAt - a.item.createdAt)
    .map(({ item, you }) => proposalView(item, [...you]));
}

// ---------------------------------------------------------------- moves

function orderProblems(po: PurchaseOrder, terms: OrderTerms, ctx: Ctx) {
  const problems = checkOrder(po, terms, { now: ctx.now, escrow: ctx.escrow, token: ctx.token });
  if (problems.length) throw new HttpError(422, "invalid_order", { problems });
}

export async function createProposal(signer: Hex, body: z.infer<typeof CreateBody>, ctx: Ctx): Promise<ProposalView> {
  const { po, terms } = body;
  orderProblems(po, terms, ctx);
  // Only someone who represents po.importer proposes in its name
  if (!(await actsFor(signer, po.importer, ctx.env))) throw new HttpError(403, "not_importer");
  const label = body.label ?? labelOf(terms.orderNumber);
  const order = { po: toJson(po), terms: toJson(terms) };
  const item: ProposalItem = {
    orderId: lower(po.orderId) as Hex,
    importer: lower(po.importer),
    exporter: lower(po.exporter),
    status: "awaiting_exporter",
    ...order,
    proposed: order,
    ...(label && { label }),
    ...(body.goods?.trim() && { goods: body.goods.trim() }),
    createdAt: ctx.now,
    updatedAt: ctx.now,
  };
  try {
    // One proposal per orderId: a new version of an order uses a new nonce, hence a new id
    await ddb().send(new PutCommand({ TableName: table("proposals", ctx.env), Item: item, ConditionExpression: "attribute_not_exists(orderId)" }));
  } catch (e) {
    if (isConditionFailed(e)) throw new HttpError(409, "proposal_exists");
    throw e;
  }
  return proposalView(item, await sides(signer, item, ctx.env));
}

const purchaseOrderDigest = (ctx: Ctx, po: PurchaseOrder) => escrowDigest(ctx.chainId, ctx.escrow, "PurchaseOrder", po);

function wrongStatus(item: ProposalItem): never {
  throw new HttpError(409, "wrong_status", { status: item.status });
}

export async function exporterSigns(signer: Hex, orderId: string, body: z.infer<typeof ExporterBody>, ctx: Ctx): Promise<ProposalView> {
  const item = await loadProposal(orderId, ctx.env);
  if (!(await actsFor(signer, item.exporter, ctx.env))) throw new HttpError(403, "not_exporter");
  if (item.status !== "awaiting_exporter") wrongStatus(item);
  if (!!body.po !== !!body.terms) throw new HttpError(400, "bad_request");

  // The order the exporter signs: the one proposed, or its counter offer
  const po = body.po ?? poFrom(item.po);
  const terms = body.terms ?? termsFrom(item.terms);
  // A counter offer keeps the key: same orderId means same importer, exporter and nonce
  if (!same(po.orderId, item.orderId)) throw new HttpError(422, "invalid_order", { problems: ["bad_order_id"] });
  orderProblems(po, terms, ctx);

  const { verify } = await chainDeps(ctx.env);
  if (!(await verify(po.exporter, purchaseOrderDigest(ctx, po), body.signature))) throw new HttpError(422, "bad_exporter_signature");

  const counter = body.po ? { po: toJson(po), terms: toJson(terms) } : {};
  try {
    const r = await ddb().send(
      new UpdateCommand({
        TableName: table("proposals", ctx.env),
        Key: { orderId: item.orderId },
        UpdateExpression: `SET #status = :next, sigExporter = :sig, exporterSignedAt = :now, updatedAt = :now${body.po ? ", po = :po, terms = :terms" : ""}`,
        ConditionExpression: "#status = :from",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: {
          ":next": "awaiting_importer",
          ":from": "awaiting_exporter",
          ":sig": body.signature,
          ":now": ctx.now,
          ...(body.po && { ":po": counter.po, ":terms": counter.terms }),
        },
        ReturnValues: "ALL_NEW",
      }),
    );
    return proposalView(r.Attributes as ProposalItem, await sides(signer, item, ctx.env));
  } catch (e) {
    if (isConditionFailed(e)) wrongStatus(await loadProposal(orderId, ctx.env));
    throw e;
  }
}

export async function importerSigns(signer: Hex, orderId: string, body: z.infer<typeof ImporterBody>, ctx: Ctx): Promise<ProposalView> {
  const item = await loadProposal(orderId, ctx.env);
  if (!(await actsFor(signer, item.importer, ctx.env))) throw new HttpError(403, "not_importer");
  if (item.status !== "awaiting_importer" || !item.sigExporter) wrongStatus(item);
  const po = poFrom(item.po);
  // The deadline may have passed while the proposal waited
  orderProblems(po, termsFrom(item.terms), ctx);

  const digest = purchaseOrderDigest(ctx, po);
  const { verify } = await chainDeps(ctx.env);
  // Both signatures over the same digest, as `open` requires. The exporter's again: a Safe
  // exporter may have changed owners since it signed.
  if (!(await verify(po.exporter, digest, item.sigExporter))) throw new HttpError(422, "bad_exporter_signature");
  if (!(await verify(po.importer, digest, body.signature))) throw new HttpError(422, "bad_importer_signature");

  try {
    const r = await ddb().send(
      new UpdateCommand({
        TableName: table("proposals", ctx.env),
        Key: { orderId: item.orderId },
        // importerSigner is who sent the signature: for a Safe, the representative whose request
        // carried it. Which owners actually signed is the Safe's business (ERC-1271).
        UpdateExpression: "SET #status = :next, sigImporter = :sig, importerSigner = :who, importerSignedAt = :now, updatedAt = :now",
        // The exporter's signature checked above is still the stored one: nobody countered in between
        ConditionExpression: "#status = :from AND sigExporter = :sigExporter",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: {
          ":next": "fully_signed",
          ":from": "awaiting_importer",
          ":sig": body.signature,
          ":who": lower(signer),
          ":now": ctx.now,
          ":sigExporter": item.sigExporter,
        },
        ReturnValues: "ALL_NEW",
      }),
    );
    return proposalView(r.Attributes as ProposalItem, await sides(signer, item, ctx.env));
  } catch (e) {
    if (isConditionFailed(e)) wrongStatus(await loadProposal(orderId, ctx.env));
    throw e;
  }
}

export async function rejectProposal(signer: Hex, orderId: string, ctx: Ctx): Promise<ProposalView> {
  const item = await loadProposal(orderId, ctx.env);
  const you = await sides(signer, item, ctx.env);
  if (!you.length) throw new HttpError(404, "not_found");
  if (item.status !== "awaiting_exporter" && item.status !== "awaiting_importer") wrongStatus(item);
  try {
    const r = await ddb().send(
      new UpdateCommand({
        TableName: table("proposals", ctx.env),
        Key: { orderId: item.orderId },
        UpdateExpression: "SET #status = :next, rejectedBy = :who, updatedAt = :now",
        // A proposal already fully signed cannot be rejected here: that is a cancellation
        ConditionExpression: "#status = :a OR #status = :b",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: { ":next": "rejected", ":who": lower(signer), ":now": ctx.now, ":a": "awaiting_exporter", ":b": "awaiting_importer" },
        ReturnValues: "ALL_NEW",
      }),
    );
    return proposalView(r.Attributes as ProposalItem, you);
  } catch (e) {
    if (isConditionFailed(e)) wrongStatus(await loadProposal(orderId, ctx.env));
    throw e;
  }
}
