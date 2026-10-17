// POST /ingest/outcomes: ingest posts its own output as is, and the bot maps it with its own
// mappers. Area 3 does not need to know the Notice format.
//   { "source": "email", "outcome": <EmailOutcome> }                                   Personal
//   { "source": "change_digest", "since": "<ISO>", "requests": [<StoredChangeRequest>] } Personal
//   { "source": "trade_upload", "outcome": <TradeOutcome> }                            Trade
// 400 if the body lacks the minimal shape or the mapper fails; 202 with the status otherwise:
// accepted, duplicate, rejected (the notice did not validate) or ignored (nothing to tell).
// A trade upload can give several notices; then the status is the first of accepted, duplicate,
// rejected, ignored that any of them has, and `notices` lists each one's status.
// The mapper's output still goes through NotifyService validation: this is not a trusted path.
import type { EmailOutcome, StoredChangeRequest } from "@keel/ingest";
import { z } from "zod";
import type { Notice } from "../../domain/notice";
import type { OrderBook } from "../config/orders-file";
import { reply, type JsonRoute, type NoticeSink } from "./http-source";
import { mapChangeDigest, mapEmailOutcome } from "./ingest-mapper";
import { mapTradeOutcome } from "./ingest-trade-mapper";

const MAX_DIGEST_REQUESTS = 500;

// Only what is needed to choose a mapper. The mapper reads the rest, and the notice it produces
// is validated by NotifyService.
const Body = z.discriminatedUnion("source", [
  z.object({ source: z.literal("email"), outcome: z.looseObject({ status: z.string() }) }),
  z.object({
    source: z.literal("change_digest"),
    since: z.iso.datetime(),
    requests: z.array(z.looseObject({ id: z.number().int(), aliasId: z.string() })).max(MAX_DIGEST_REQUESTS),
  }),
  z.object({ source: z.literal("trade_upload"), outcome: z.looseObject({ status: z.string() }) }),
]);

export interface IngestRouteDeps {
  sink: NoticeSink;
  // Personal sources are enabled only when the personal account is configured
  personalAccountId?: string;
  // Trade sources are enabled only with BOT_ORDERS_FILE: ingest names orders by bytes32 id
  orders?: OrderBook;
  now: () => number;
  // Error class name only: a mapper error could echo a payload.
  log: (entry: { event: "ingest_mapper_failed"; source: string; error: string }) => void;
}

export function ingestRoute(deps: IngestRouteDeps): JsonRoute {
  return async (json, res) => {
    const body = Body.safeParse(json);
    if (!body.success) return reply(res, 400, { error: "invalid_body" });
    const { source } = body.data;

    if (source === "trade_upload") {
      if (!deps.orders) return reply(res, 400, { error: "source_disabled", source });
      let notices: Notice[];
      try {
        notices = mapTradeOutcome(body.data.outcome, { orders: deps.orders, now: deps.now });
      } catch (err) {
        deps.log({ event: "ingest_mapper_failed", source, error: err instanceof Error ? err.name : "unknown" });
        return reply(res, 400, { error: "mapper_failed", source });
      }
      const results: string[] = [];
      // Born from a document: it counts toward the per-chat cap, whatever its kind
      for (const notice of notices) results.push((await deps.sink.notify(notice, "document")).status);
      const status = (["accepted", "duplicate", "rejected"] as const).find((s) => results.includes(s)) ?? "ignored";
      return reply(res, 202, notices.length > 1 ? { status, notices: results } : { status });
    }

    const accountId = deps.personalAccountId;
    if (!accountId) return reply(res, 400, { error: "source_disabled", source });
    const opts = { accountId, now: deps.now };

    let notice: Notice | null;
    try {
      notice =
        source === "email"
          ? mapEmailOutcome(body.data.outcome as unknown as EmailOutcome, opts)
          : mapChangeDigest(body.data.requests as unknown as StoredChangeRequest[], new Date(body.data.since), opts);
    } catch (err) {
      deps.log({ event: "ingest_mapper_failed", source, error: err instanceof Error ? err.name : "unknown" });
      return reply(res, 400, { error: "mapper_failed", source });
    }
    if (notice === null) return reply(res, 202, { status: "ignored" });
    const result = await deps.sink.notify(notice, "document");
    reply(res, 202, { status: result.status });
  };
}
