// The agent's store on DynamoDB. AgentStore is synchronous (the engine reads it in the middle of a
// step), so each invocation loads a snapshot first: the orders of one Safe through the GSI bySafe
// and the parties those orders name, then serves every read from memory. A pass lasts seconds and
// the chain is the source of truth, so a snapshot that is a few seconds old only delays a step to
// the next pass; it never makes the agent send something the escrow would accept wrongly.
// Items hold the JSON of the demo files (../tables.ts), revived by the engine's own revivers.
import { BatchGetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { FINAL_ESCROW_STATES, type Hex } from "@keel/schemas";
import {
  type AgentStore,
  type Registry,
  reviveDocuments,
  reviveOrder,
  reviveRegistry,
  reviveShipment,
  type StoredDocuments,
  type StoredOrder,
  type StoredShipment,
} from "@keel/engine";
import { type Env, table } from "../config";
import { ddb, lower } from "../db";
import type { OrderItem, PartyItem } from "../tables";

const FINAL = new Set<string>(FINAL_ESCROW_STATES);
// BatchGetItem takes at most 100 keys per request
const BATCH = 100;

export class DynamoSnapshotStore implements AgentStore {
  private readonly revived = new Map<string, StoredOrder>();

  private constructor(
    private readonly orders: ReadonlyMap<string, OrderItem>,
    private readonly snapshot: Registry,
  ) {}

  static async load(safe: string, env: Env = process.env): Promise<DynamoSnapshotStore> {
    const items: OrderItem[] = [];
    let ExclusiveStartKey: Record<string, unknown> | undefined;
    do {
      const page = await ddb().send(
        new QueryCommand({
          TableName: table("orders", env),
          IndexName: "bySafe",
          KeyConditionExpression: "#safe = :safe",
          ExpressionAttributeNames: { "#safe": "safe" },
          ExpressionAttributeValues: { ":safe": lower(safe) },
          ExclusiveStartKey,
        }),
      );
      items.push(...((page.Items ?? []) as OrderItem[]));
      ExclusiveStartKey = page.LastEvaluatedKey;
    } while (ExclusiveStartKey);

    // An order the indexer saw reach a final state never moves again: no RPC read for it
    const live = items.filter((o) => !(o.chain && FINAL.has(o.chain.state)));
    const orders = new Map(live.map((o) => [lower(o.orderId), o]));

    // The registry the engine reads: the importer's tax id, the exporter's history and each
    // party's bot account (importer, exporter, arbiter name the notices)
    const addresses = new Set<string>([lower(safe)]);
    for (const o of live) {
      const po = o.order as { importer?: string; exporter?: string; arbiter?: string };
      for (const a of [po.importer, po.exporter, po.arbiter, o.exporter]) if (typeof a === "string") addresses.add(lower(a));
    }
    const parties = await batchGetParties([...addresses], env);
    const registry = reviveRegistry({
      parties: parties.map((p) => ({
        address: p.address,
        ...(p.taxId !== undefined && { taxId: p.taxId }),
        ...(p.account !== undefined && { account: p.account }),
      })),
      history: Object.fromEntries(parties.filter((p) => p.history).map((p) => [p.address, p.history!])),
    });
    return new DynamoSnapshotStore(orders, registry);
  }

  orderIds(): Hex[] {
    return [...this.orders.values()].map((o) => o.orderId);
  }

  order(orderId: Hex): StoredOrder | null {
    const key = lower(orderId);
    const item = this.orders.get(key);
    if (!item) return null;
    let order = this.revived.get(key);
    if (!order) {
      order = reviveOrder(item);
      this.revived.set(key, order);
    }
    return order;
  }

  shipment(orderId: Hex): StoredShipment | null {
    const item = this.orders.get(lower(orderId));
    return item?.shipment ? reviveShipment(item.shipment) : null;
  }

  documents(orderId: Hex): StoredDocuments | null {
    const item = this.orders.get(lower(orderId));
    return item?.documents ? reviveDocuments(item.documents) : null;
  }

  registry(): Registry {
    return this.snapshot;
  }
}

async function batchGetParties(addresses: string[], env: Env): Promise<PartyItem[]> {
  const name = table("parties", env);
  const found: PartyItem[] = [];
  for (let i = 0; i < addresses.length; i += BATCH) {
    let keys: Record<string, unknown>[] | undefined = addresses.slice(i, i + BATCH).map((address) => ({ address }));
    // Unprocessed keys come back under throttling; a few retries, then the pass fails and the next one retries
    for (let attempt = 0; keys && keys.length > 0; attempt++) {
      if (attempt === 5) throw new Error("parties: BatchGetItem left keys unprocessed");
      const out = await ddb().send(new BatchGetCommand({ RequestItems: { [name]: { Keys: keys } } }));
      found.push(...((out.Responses?.[name] ?? []) as PartyItem[]));
      keys = out.UnprocessedKeys?.[name]?.Keys as Record<string, unknown>[] | undefined;
    }
  }
  return found;
}
