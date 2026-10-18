// SQS consumer of the notices queue: the bot's sending half in AWS. Each message is
// { kind: "notices" } or { kind: "ingest_outcome" } (aws/src/notices.ts) and goes through the same
// validation, routing, templates and cap as the local bot's HTTP routes (bot/src/adapters/inbound/
// queue-source.ts). What the local bot keeps in memory (seen notice ids, per-chat claims, document
// holds, hourly counters) lives in the bot table, so it holds across invocations.
//
// Partial batch response (the event source mapping needs ReportBatchItemFailures):
// - a send Telegram may accept later (429, 5xx, network) or a store error: the message is
//   reported and SQS delivers it again; the per-chat claims keep chats already reached from
//   getting it twice;
// - an invalid message: logged with its id and the error code, and dropped. It never comes back.
//
// Environment: BOT_TABLE, KEEL_CHAIN_ID (or KEEL_SECRETS_PREFIX), APP_BASE_URL (optional),
// BOT_PERSONAL_ACCOUNT_ID (optional, enables Keel Personal ingest outcomes),
// BOT_MAX_MESSAGES_PER_CHAT_PER_HOUR (default 30). Secret: telegram_bot_token.
import type { SQSBatchResponse, SQSEvent } from "aws-lambda";
import { AccountId, handleQueueMessage, KvDirectory, KvNotifyState, KvOrders, NotifyService, templateRenderer } from "@keel/bot";
import type { Env } from "../config";
import { botRuntime, logJson } from "../bot/runtime";

const DEFAULT_MAX_PER_HOUR = 30;

function maxPerHour(env: Env): number {
  const n = Number(env.BOT_MAX_MESSAGES_PER_CHAT_PER_HOUR ?? DEFAULT_MAX_PER_HOUR);
  return Number.isInteger(n) && n >= 1 && n <= 1000 ? n : DEFAULT_MAX_PER_HOUR;
}

// Lambda's second argument is its context, so the environment is not a parameter of `handler`
export const handler = (event: SQSEvent): Promise<SQSBatchResponse> => notifyBatch(event, process.env);

export async function notifyBatch(event: SQSEvent, env: Env): Promise<SQSBatchResponse> {
  const rt = botRuntime(env);
  const kv = rt.kv();
  const orders = new KvOrders(kv);
  const personal = AccountId.safeParse(env.BOT_PERSONAL_ACCOUNT_ID);
  const service = new NotifyService(
    {
      // One per invocation: a batch reads each account once, the next one sees operator changes
      directory: new KvDirectory(kv),
      renderer: templateRenderer,
      sender: await rt.sender(),
      clock: { now: rt.now },
      logger: { log: logJson },
      state: new KvNotifyState(kv, rt.now),
    },
    { maxMessagesPerChatPerHour: maxPerHour(env) },
  );

  const batchItemFailures: SQSBatchResponse["batchItemFailures"] = [];
  // One message at a time: the hourly cap and Telegram's own limits count in order
  for (const record of event.Records) {
    try {
      const outcome = await handleQueueMessage(record.body, {
        sink: service,
        personalAccountId: personal.success ? personal.data : undefined,
        orders: (orderId) => orders.book(orderId),
        now: rt.now,
        log: (entry) => logJson({ ...entry, messageId: record.messageId }),
      });
      logJson({ event: "queue_message", messageId: record.messageId, outcome });
      if (outcome === "retry") batchItemFailures.push({ itemIdentifier: record.messageId });
    } catch (e) {
      // The store or the secret failed: worth another try. Error class name only.
      logJson({ event: "queue_message_failed", messageId: record.messageId, error: (e as Error).name });
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }
  return { batchItemFailures };
}
