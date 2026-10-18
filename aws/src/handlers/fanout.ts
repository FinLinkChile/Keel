// Fan-out of the agent (EventBridge, every minute). Lists the Safes with at least one order the
// agent still has to act on (LIVE_STATES: no chain mirror yet counts as NONE) and sends one
// message per Safe to the FIFO agent queue. MessageGroupId = Safe serializes the passes of one
// Safe; MessageDeduplicationId = Safe + minute makes a repeated fan-out in the same minute a no-op.
// The fan-out decides nothing: the agent re-reads every order from the chain.
import { SendMessageCommand } from "@aws-sdk/client-sqs";
import { ScanCommand } from "@aws-sdk/lib-dynamodb";
import { type Env, required, table } from "../config";
import { ddb, lower } from "../db";
import { LIVE_STATES, type OrderItem } from "../tables";
import { logLine, sqsClient } from "../agent/clients";

const LIVE = new Set<string>(LIVE_STATES);

// A Scan reads the whole table every minute. At the scale of the prototype (tens of orders) that
// is a few read units; with thousands of orders a GSI on the chain state, or a sparse "live"
// attribute, should replace it.
export async function liveSafes(env: Env = process.env): Promise<string[]> {
  const safes = new Set<string>();
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const page = await ddb().send(
      new ScanCommand({
        TableName: table("orders", env),
        ProjectionExpression: "#safe, #chain",
        ExpressionAttributeNames: { "#safe": "safe", "#chain": "chain" },
        ExclusiveStartKey,
      }),
    );
    for (const item of (page.Items ?? []) as Pick<OrderItem, "safe" | "chain">[]) {
      if (typeof item.safe === "string" && LIVE.has(item.chain?.state ?? "NONE")) safes.add(lower(item.safe));
    }
    ExclusiveStartKey = page.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return [...safes].sort();
}

export async function fanOut(env: Env = process.env, now: () => number = Date.now): Promise<string[]> {
  const queue = required(env, "AGENT_QUEUE_URL");
  const safes = await liveSafes(env);
  const minute = Math.floor(now() / 60_000);
  for (const safe of safes) {
    await sqsClient().send(
      new SendMessageCommand({ QueueUrl: queue, MessageBody: JSON.stringify({ safe }), MessageGroupId: safe, MessageDeduplicationId: `${safe}-${minute}` }),
    );
  }
  logLine({ fanout: "sent", safes: safes.length, minute });
  return safes;
}

export const handler = async (): Promise<void> => {
  await fanOut();
};
