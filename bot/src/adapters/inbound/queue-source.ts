// Notices from the SQS notices queue (aws/src/notices.ts). A message carries exactly the body of
// one of the two HTTP routes, so it goes through the same code:
//   { "kind": "notices", "notices": <Notice | Notice[]> }      same as POST /notices
//   { "kind": "ingest_outcome", "payload": <ingest's body> }   same as POST /ingest/outcomes
//
// The outcome tells the queue what to do with the message:
// - "delivered": done, including notices that were duplicates or had no chat;
// - "invalid": the envelope, a notice or the ingest payload does not validate. Logged (kind and
//   error code only) and dropped: retrying cannot fix it;
// - "retry": a send failed for a reason that may pass (RetryableSendError). Delivering the same
//   message again reaches only the chats still pending, thanks to the per-chat claims.
// An exception (the store is down) is left to the caller, which retries the message too.
import { z } from "zod";
import type { NoticeOrigin, NotifyResult } from "../../application/notify";
import { OrderBook } from "../config/orders-file";
import { deliverNotices, type NoticeSink } from "./http-source";
import { deliverIngest } from "./ingest-source";
import { TradeOutcomeShape } from "./ingest-trade-mapper";

export type QueueOutcome = "delivered" | "retry" | "invalid";

const Envelope = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("notices"), notices: z.union([z.array(z.unknown()), z.looseObject({})]) }),
  z.object({ kind: z.literal("ingest_outcome"), payload: z.looseObject({}) }),
]);

export type QueueLog = (
  entry: { event: "queue_invalid"; kind?: string; error: string } | { event: "ingest_mapper_failed"; source: string; error: string },
) => void;

export interface QueueSourceDeps {
  sink: NoticeSink;
  // Personal sources are enabled only when the personal account is configured
  personalAccountId?: string;
  // Trade uploads are enabled only with an order lookup: ingest names an order by its bytes32 id
  orders?: (orderId: string) => Promise<OrderBook>;
  now: () => number;
  log: QueueLog;
}

export async function handleQueueMessage(body: string, deps: QueueSourceDeps): Promise<QueueOutcome> {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    deps.log({ event: "queue_invalid", error: "invalid_json" });
    return "invalid";
  }
  const envelope = Envelope.safeParse(json);
  if (!envelope.success) {
    deps.log({ event: "queue_invalid", error: "invalid_envelope" });
    return "invalid";
  }

  // Remembers whether any send asked for a retry
  let retry = false;
  const sink: NoticeSink = {
    async notify(input: unknown, origin?: NoticeOrigin): Promise<NotifyResult> {
      const result = await deps.sink.notify(input, origin);
      if (result.status === "accepted" && result.retry) retry = true;
      return result;
    },
  };

  const message = envelope.data;
  let delivery;
  if (message.kind === "notices") {
    delivery = await deliverNotices(sink, message.notices);
  } else {
    delivery = await deliverIngest(
      {
        sink,
        personalAccountId: deps.personalAccountId,
        orders: deps.orders ? await orderBookFor(message.payload, deps.orders) : undefined,
        now: deps.now,
        log: deps.log,
      },
      message.payload,
    );
  }
  if (delivery.code >= 400) {
    const error = (delivery.body as { error?: unknown }).error;
    deps.log({ event: "queue_invalid", kind: message.kind, error: typeof error === "string" ? error : "unknown" });
    return "invalid";
  }
  return retry ? "retry" : "delivered";
}

// The trade mapper reads an order book; here it holds only the order the outcome names. A payload
// that is not a trade upload, or names no order, gets an empty book and fails in the mapper.
async function orderBookFor(payload: Record<string, unknown>, lookup: (orderId: string) => Promise<OrderBook>): Promise<OrderBook> {
  const outcome = payload.source === "trade_upload" ? TradeOutcomeShape.safeParse(payload.outcome) : undefined;
  const orderId = outcome?.success && "orderId" in outcome.data ? outcome.data.orderId : undefined;
  return orderId ? lookup(orderId) : new OrderBook(new Map());
}
