// The bot's KeyValueStore (bot/src/adapters/kv/store.ts) on the bot table: pk, sk and TTL
// attribute `ttl`. DynamoDB deletes expired items late, so every read drops an item past its
// `ttl`, and a conditional write treats it as absent. Reads are strongly consistent: a duplicate
// check must see the write of the invocation before.
import { DeleteCommand, GetCommand, PutCommand, QueryCommand, UpdateCommand, type DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { KeyValueStore, KvItem } from "@keel/bot";
import { ddb, isConditionFailed } from "../db";

type Client = Pick<DynamoDBDocumentClient, "send">;

export class DynamoKeyValueStore implements KeyValueStore {
  constructor(
    private readonly tableName: string,
    private readonly client: Client = ddb(),
    // Unix ms
    private readonly now: () => number = () => Date.now(),
  ) {}

  private nowS(): number {
    return Math.floor(this.now() / 1000);
  }

  private live(item: KvItem | undefined): KvItem | undefined {
    if (!item) return undefined;
    return typeof item.ttl === "number" && item.ttl <= this.nowS() ? undefined : item;
  }

  async get(pk: string, sk: string): Promise<KvItem | undefined> {
    const r = await this.client.send(new GetCommand({ TableName: this.tableName, Key: { pk, sk }, ConsistentRead: true }));
    return this.live(r.Item);
  }

  async query(pk: string, skPrefix: string): Promise<KvItem[]> {
    const out: KvItem[] = [];
    let ExclusiveStartKey: Record<string, unknown> | undefined;
    do {
      const r = await this.client.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: skPrefix ? "pk = :pk AND begins_with(sk, :prefix)" : "pk = :pk",
          ExpressionAttributeValues: { ":pk": pk, ...(skPrefix ? { ":prefix": skPrefix } : {}) },
          ConsistentRead: true,
          ExclusiveStartKey,
        }),
      );
      for (const item of r.Items ?? []) if (this.live(item)) out.push(item);
      ExclusiveStartKey = r.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    return out;
  }

  async put(pk: string, sk: string, item: KvItem, opts: { ifAbsent?: boolean; ttl?: number } = {}): Promise<boolean> {
    try {
      await this.client.send(
        new PutCommand({
          TableName: this.tableName,
          Item: { ...item, pk, sk, ...(opts.ttl !== undefined ? { ttl: opts.ttl } : {}) },
          ...(opts.ifAbsent
            ? {
                ConditionExpression: "attribute_not_exists(pk) OR #ttl <= :now",
                ExpressionAttributeNames: { "#ttl": "ttl" },
                ExpressionAttributeValues: { ":now": this.nowS() },
              }
            : {}),
        }),
      );
      return true;
    } catch (e) {
      if (opts.ifAbsent && isConditionFailed(e)) return false;
      throw e;
    }
  }

  async delete(pk: string, sk: string): Promise<void> {
    await this.client.send(new DeleteCommand({ TableName: this.tableName, Key: { pk, sk } }));
  }

  async increment(pk: string, sk: string, attr: string, max: number, ttl: number): Promise<number | undefined> {
    try {
      const r = await this.client.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { pk, sk },
          UpdateExpression: "SET #a = if_not_exists(#a, :zero) + :one, #ttl = if_not_exists(#ttl, :ttl)",
          ConditionExpression: "attribute_not_exists(#a) OR #a < :max",
          ExpressionAttributeNames: { "#a": attr, "#ttl": "ttl" },
          ExpressionAttributeValues: { ":zero": 0, ":one": 1, ":ttl": ttl, ":max": max },
          ReturnValues: "UPDATED_NEW",
        }),
      );
      return Number(r.Attributes?.[attr]);
    } catch (e) {
      if (isConditionFailed(e)) return undefined;
      throw e;
    }
  }

  async decrement(pk: string, sk: string, attr: string): Promise<void> {
    try {
      await this.client.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { pk, sk },
          UpdateExpression: "SET #a = #a - :one",
          ConditionExpression: "#a > :zero",
          ExpressionAttributeNames: { "#a": attr },
          ExpressionAttributeValues: { ":zero": 0, ":one": 1 },
        }),
      );
    } catch (e) {
      if (!isConditionFailed(e)) throw e;
    }
  }

  async setOnce(pk: string, sk: string, attr: string, ttl: number): Promise<boolean> {
    try {
      await this.client.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { pk, sk },
          UpdateExpression: "SET #a = :true, #ttl = if_not_exists(#ttl, :ttl)",
          ConditionExpression: "attribute_not_exists(#a)",
          ExpressionAttributeNames: { "#a": attr, "#ttl": "ttl" },
          ExpressionAttributeValues: { ":true": true, ":ttl": ttl },
        }),
      );
      return true;
    } catch (e) {
      if (isConditionFailed(e)) return false;
      throw e;
    }
  }
}
