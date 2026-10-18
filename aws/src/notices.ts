// Notices to the bot travel through the SQS notices queue instead of an HTTP POST. A message
// carries exactly what the bot's two inbound endpoints receive today
// (docs/interfaces/avisos-al-bot.md), so the bot's mapping is reused unchanged:
//
//   { kind: "notices", notices }          body of POST /notices (agent, monitor, registrar…)
//   { kind: "ingest_outcome", payload }   body of POST /ingest/outcomes (ingest's BotPayload)
//
// A notice is never in the payment path: a failed send is logged and the caller goes on.
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { type Env, required, table } from "./config";
import { ddb, isConditionFailed, nowSeconds } from "./db";
import { stateId } from "./tables";

export type NoticeMessage = { kind: "notices"; notices: readonly object[] } | { kind: "ingest_outcome"; payload: object };

let sqs: Pick<SQSClient, "send"> | undefined;
export function setSqs(c: Pick<SQSClient, "send"> | undefined) {
  sqs = c;
}

export async function enqueueNotice(message: NoticeMessage, env: Env = process.env): Promise<boolean> {
  try {
    sqs ??= new SQSClient({});
    await sqs.send(new SendMessageCommand({ QueueUrl: required(env, "NOTICES_QUEUE_URL"), MessageBody: JSON.stringify(message) }));
    return true;
  } catch (e) {
    console.error(JSON.stringify({ event: "notice_enqueue_failed", kind: message.kind, error: (e as Error).name }));
    return false;
  }
}

// A Lambda forgets between invocations which notices it already sent. This records the key with
// a conditional write: true the first time, false for a repeat. Kept for 30 days.
export const NOTICE_TTL_SECONDS = 30 * 24 * 60 * 60;

export async function firstTime(key: string, env: Env = process.env): Promise<boolean> {
  try {
    await ddb().send(
      new PutCommand({
        TableName: table("agentState", env),
        Item: { id: stateId.notice(key), ttl: nowSeconds() + NOTICE_TTL_SECONDS },
        ConditionExpression: "attribute_not_exists(id)",
      }),
    );
    return true;
  } catch (e) {
    if (isConditionFailed(e)) return false;
    throw e;
  }
}

// Enqueue notices that each carry an `id` (the bot's notice id), once per id
export async function enqueueOnce(notices: readonly { id: string }[], env: Env = process.env): Promise<number> {
  const fresh: object[] = [];
  for (const n of notices) if (await firstTime(n.id, env)) fresh.push(n);
  if (fresh.length) await enqueueNotice({ kind: "notices", notices: fresh }, env);
  return fresh.length;
}
