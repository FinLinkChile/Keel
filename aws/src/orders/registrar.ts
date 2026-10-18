// The registrar turns a fully signed proposal into an order (docs/flujo/paso-1-firma-orden.md).
// It runs on the proposals Stream, filtered by Terraform to status fully_signed, and does three
// things, each safe to repeat because a Stream delivers at least once:
//
//   1. creates the OrderItem the agent reads (engine StoredOrder plus both signatures), once:
//      attribute_not_exists(orderId);
//   2. in the same transaction, appends the order total to the exporter's amount history (engine
//      Registry.history, input of the funding rules), so a retry never counts an order twice;
//   3. registers in the ingest table who may upload documents for the order and where the
//      exporter is paid (ingest TradeOrderEntry), both taken from the signed PurchaseOrder.
//
// It does not call `open`: the agent opens and funds on its next pass, through the gate, after the
// engine evaluated the order. It sends no notice either: the bot's `order_opened` says the escrow
// opened the order, which is only true once OrderOpened is on chain (the indexer/monitor see it).
// The bot has no "ready to fund" notice today.
import { GetCommand, PutCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import type { Hex } from "@keel/schemas";
import { type Env, table } from "../config";
import { ddb, isConditionFailed, lower, nowSeconds } from "../db";
import type { OrderItem, ProposalItem } from "../tables";
import { poFrom, termsFrom } from "./codec";
import { actors, getParties } from "./parties";
import { checkOrder } from "./rules";

// ingest/src/trade/upload.ts TradeOrderEntry, as the ingest table holds it:
//   { pk: "order#<orderId>", sk: "entry", ...TradeOrderEntry }   (flat: aws/src/ingest/repo.ts orderEntry reads the fields from the item)
export interface TradeOrderEntry {
  orderId: Hex;
  payoutAddress: Hex;
  carrier: Hex;
  uploaders: { address: Hex; party: "importer" | "exporter" }[];
}
export const ingestKey = (orderId: string) => ({ pk: `order#${lower(orderId)}`, sk: "entry" });

export type RegisterOutcome = "created" | "exists" | "skipped";

const log = (line: Record<string, unknown>) => console.log(JSON.stringify({ event: "registrar", ...line }));

export async function registerOrder(orderId: string, opts: { escrow: Hex; env?: Env; now?: number }): Promise<RegisterOutcome> {
  const env = opts.env;
  // Read the proposal again instead of trusting the Stream image: the item is the authority
  const r = await ddb().send(new GetCommand({ TableName: table("proposals", env), Key: { orderId: lower(orderId) }, ConsistentRead: true }));
  const p = r.Item as ProposalItem | undefined;
  if (!p || p.status !== "fully_signed" || !p.sigImporter || !p.sigExporter) {
    log({ orderId, outcome: "skipped", reason: "not_fully_signed" });
    return "skipped";
  }

  const po = poFrom(p.po);
  const terms = termsFrom(p.terms);
  // The API checked all of this before storing the signatures; checked again because an order
  // that cannot be opened is better left out than handed to the agent. The deadline is left out:
  // time passed since the signatures, and the escrow decides that one at `open`.
  const problems = checkOrder(po, terms, { now: 0, escrow: opts.escrow }).filter((x) => x !== "deadline_passed");
  if (problems.length) {
    log({ orderId, outcome: "skipped", reason: "invalid_order", problems });
    return "skipped";
  }

  const parties = await getParties([p.importer, p.exporter], env);
  const uploaders = [
    ...actors(p.importer, parties.get(p.importer)).map((address) => ({ address, party: "importer" as const })),
    ...actors(p.exporter, parties.get(p.exporter)).map((address) => ({ address, party: "exporter" as const })),
  ];
  // A Safe without representatives cannot upload: a Safe cannot sign an upload request
  if (!parties.get(p.importer)?.representatives?.length) log({ orderId, warning: "importer_without_representatives" });

  const order: OrderItem = {
    orderId: lower(p.orderId) as Hex,
    safe: lower(p.importer),
    exporter: lower(p.exporter),
    order: p.po,
    terms: p.terms,
    ...(p.label && { label: p.label }),
    sigImporter: p.sigImporter,
    sigExporter: p.sigExporter,
    uploaders,
    createdAt: opts.now ?? nowSeconds(),
  };

  let outcome: RegisterOutcome = "created";
  try {
    await ddb().send(
      new TransactWriteCommand({
        TransactItems: [
          { Put: { TableName: table("orders", env), Item: order, ConditionExpression: "attribute_not_exists(orderId)" } },
          {
            Update: {
              TableName: table("parties", env),
              Key: { address: lower(p.exporter) },
              UpdateExpression: "SET history = list_append(if_not_exists(history, :empty), :total), #kind = if_not_exists(#kind, :exporter)",
              ExpressionAttributeNames: { "#kind": "kind" },
              ExpressionAttributeValues: { ":empty": [], ":total": [po.totalAmount.toString()], ":exporter": "exporter" },
            },
          },
        ],
      }),
    );
  } catch (e) {
    if (!isConditionFailed(e)) throw e;
    const existing = await ddb().send(new GetCommand({ TableName: table("orders", env), Key: { orderId: order.orderId }, ConsistentRead: true }));
    // A cancelled transaction for another reason must be retried by the Stream
    if (!existing.Item) throw e;
    outcome = "exists";
  }

  // Always written, also on a repeat: a crash between the two writes is repaired by the retry
  const entry: TradeOrderEntry = {
    orderId: order.orderId,
    payoutAddress: po.payoutAddress,
    carrier: po.carrier,
    uploaders: uploaders.map((u) => ({ address: u.address as Hex, party: u.party })),
  };
  await ddb().send(new PutCommand({ TableName: table("ingest", env), Item: { ...entry, ...ingestKey(order.orderId) } }));
  log({ orderId: order.orderId, outcome });
  return outcome;
}

// The Stream records this handler cares about: inserts and modifications with status fully_signed.
// Terraform filters already; this filter is the second layer.
export interface StreamRecord {
  eventName?: string;
  dynamodb?: { Keys?: Record<string, { S?: string }>; NewImage?: Record<string, { S?: string }> };
}

export function orderIdsOf(records: readonly StreamRecord[]): string[] {
  const ids = records
    .filter((r) => r.eventName !== "REMOVE" && r.dynamodb?.NewImage?.status?.S === "fully_signed")
    .map((r) => r.dynamodb?.Keys?.orderId?.S)
    .filter((id): id is string => !!id && /^0x[0-9a-fA-F]{64}$/.test(id));
  return [...new Set(ids)];
}
