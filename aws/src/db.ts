// DynamoDB access shared by every handler. Items are plain JSON with bigints as decimal strings,
// the same format as the demo files of engine/src/agent/store.ts, so one reviver reads both.
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

let client: DynamoDBDocumentClient | undefined;

export function ddb(): DynamoDBDocumentClient {
  client ??= DynamoDBDocumentClient.from(new DynamoDBClient({}), {
    marshallOptions: { removeUndefinedValues: true, convertClassInstanceToMap: false },
  });
  return client;
}

// For tests: inject a client (for example one pointed at DynamoDB Local) or a fake
export function setDdb(c: DynamoDBDocumentClient | undefined) {
  client = c;
}

// JSON with bigints as decimal strings, and addresses and hashes kept as they are
export function toItem<T>(value: T): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
}

export const nowSeconds = () => Math.floor(Date.now() / 1000);

// A ConditionalCheckFailedException means the guarded write lost: a duplicate, a taken lock or
// a broken uniqueness rule. Callers treat it as an answer, not as an error.
export function isConditionFailed(e: unknown): boolean {
  const name = (e as { name?: string } | null)?.name;
  return name === "ConditionalCheckFailedException" || name === "TransactionCanceledException";
}

export const lower = (address: string) => address.toLowerCase();
