// Ingest settings on the ingest table, so every Lambda instance reads the same ones, and each
// change is written together with its audit entry ("who changed what") in one transaction.
// A change computed from settings another instance has replaced since is refused, not merged.
import { GetCommand, TransactWriteCommand, type DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { SettingsAudit, SettingsBackend, StoredSettings } from "@keel/ingest";
import { ddb, isConditionFailed } from "../db";
import { ingestKey } from "./repo";

type Client = Pick<DynamoDBDocumentClient, "send">;

export function dynamoSettingsBackend(table: string, client?: Client): SettingsBackend {
  const db = () => client ?? ddb();
  return {
    async load() {
      const r = (await db().send(new GetCommand({ TableName: table, Key: ingestKey.settings(), ConsistentRead: true }))) as {
        Item?: Record<string, unknown>;
      };
      if (!r.Item) return undefined;
      return { settings: r.Item.settings, updatedAt: r.Item.updatedAt, updatedBy: r.Item.updatedBy } as StoredSettings;
    },

    async save(next: StoredSettings, audit: SettingsAudit, previous: StoredSettings) {
      try {
        await db().send(
          new TransactWriteCommand({
            TransactItems: [
              {
                Put: {
                  TableName: table,
                  Item: { ...ingestKey.settings(), ...next },
                  // Nobody saved since `previous` was read (or nothing was ever saved)
                  ConditionExpression: "attribute_not_exists(pk) OR (updatedAt = :at AND updatedBy = :by)",
                  ExpressionAttributeValues: { ":at": previous.updatedAt, ":by": previous.updatedBy },
                },
              },
              { Put: { TableName: table, Item: { ...ingestKey.audit(audit.at), ...audit } } },
            ],
          }),
        );
        return true;
      } catch (e) {
        if (isConditionFailed(e)) return false;
        throw e;
      }
    },
  };
}
