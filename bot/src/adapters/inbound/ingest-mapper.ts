// Maps what ingest produces (Keel Personal) to the bot's Notice. Written against ingest's types,
// but not wired to ingest: how producers reach the bot is not decided yet, and wiring it is
// Area 3's side.
// Type-only imports: ingest pulls heavy SDKs that the bot must not load.
// Ingest knows no accounts, so the personal accountId comes from configuration.
//
// Not mapped on purpose:
// - "quarantined": stays in ingest's log, so spam never becomes a notification;
// - "duplicate": nothing new happened;
// - "ready": the engine decides and pays, and its own notices follow.
// The sender's domain, the proposed destinations and any document text are dropped here.
import type { EmailOutcome, StoredChangeRequest } from "@keel/ingest";
import type { PersonalNotice } from "../../domain/notice";

export interface IngestMapperOptions {
  // The personal account ingest reads bills for
  accountId: string;
  // Unix ms
  now: () => number;
}

const seconds = (ms: number) => Math.floor(ms / 1000);

export function mapEmailOutcome(outcome: EmailOutcome, opts: IngestMapperOptions): PersonalNotice | null {
  const base = { mode: "personal" as const, accountId: opts.accountId, occurredAt: seconds(opts.now()) };
  switch (outcome.status) {
    case "escalated":
      return {
        ...base,
        id: `ingest:escalated:${outcome.messageHash}`,
        kind: "invoice_needs_cosign",
        aliasId: outcome.extraction.alias_id,
        // The parser's reading is a, the LLM's is b.
        diffs: outcome.diffs.map((d) => ({ field: d.field, a: d.parser, b: d.llm })),
      };
    case "held":
      return { ...base, id: `ingest:held:${outcome.messageHash}`, kind: "invoice_held", reason: outcome.reason };
    case "change_requested": {
      const request = outcome.changeRequest;
      return {
        ...base,
        id: `ingest:change:${request.id}`,
        occurredAt: seconds(Date.parse(request.createdAt)) || base.occurredAt,
        kind: "change_requested",
        aliasId: request.aliasId,
        triggers: [...new Set(request.triggers)],
        requestId: request.id,
      };
    }
    case "quarantined":
    case "duplicate":
    case "ready":
      return null;
  }
}

// IngestStore.changeDigest(since): the grouping is ingest's (T3.2); the bot sends what arrives.
export function mapChangeDigest(
  requests: readonly StoredChangeRequest[],
  since: Date,
  opts: IngestMapperOptions,
): PersonalNotice | null {
  const last = requests.at(-1);
  if (!last) return null;
  return {
    mode: "personal",
    accountId: opts.accountId,
    occurredAt: seconds(opts.now()),
    // Same window and same last request: same digest, sent once.
    id: `ingest:digest:${seconds(since.getTime())}:${last.id}`,
    kind: "change_digest",
    count: requests.length,
    aliasIds: [...new Set(requests.map((r) => r.aliasId))],
  };
}
