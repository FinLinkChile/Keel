// One agent pass per relayer at a time. Two passes with the same relayer would race for the
// nonce; the FIFO queue already serializes passes of one Safe, and this lock covers a relayer
// shared by several Safes. It replaces reserved concurrency, which new accounts may not allow.
// The lock expires on its own (`ttl`) if a Lambda dies holding it.
import { DeleteCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "node:crypto";
import { type Env, table } from "./config";
import { ddb, isConditionFailed, nowSeconds } from "./db";
import { stateId } from "./tables";

export interface Lock {
  release(): Promise<void>;
}

export async function acquire(relayer: string, holdSeconds: number, env: Env = process.env): Promise<Lock | null> {
  const id = stateId.lock(relayer);
  const owner = randomUUID();
  const now = nowSeconds();
  try {
    await ddb().send(
      new PutCommand({
        TableName: table("agentState", env),
        Item: { id, owner, ttl: now + holdSeconds },
        // Free, or held by a pass that should have finished already
        ConditionExpression: "attribute_not_exists(id) OR #ttl < :now",
        ExpressionAttributeNames: { "#ttl": "ttl" },
        ExpressionAttributeValues: { ":now": now },
      }),
    );
  } catch (e) {
    if (isConditionFailed(e)) return null;
    throw e;
  }
  return {
    async release() {
      try {
        await ddb().send(
          new DeleteCommand({
            TableName: table("agentState", env),
            Key: { id },
            ConditionExpression: "#owner = :owner",
            ExpressionAttributeNames: { "#owner": "owner" },
            ExpressionAttributeValues: { ":owner": owner },
          }),
        );
      } catch (e) {
        // Someone else took it after it expired: nothing to release
        if (!isConditionFailed(e)) throw e;
      }
    },
  };
}
