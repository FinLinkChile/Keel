// Tells the Telegram bot (Area 4) what ingest produced, as its interface asks:
// POST {BOT_URL}/ingest/outcomes with ingest's own output, and the bot maps it
// (docs/interfaces/avisos-al-bot.md). Optional and never in the payment path: without
// BOT_URL nothing is sent, and a slow or failing bot never delays or changes an outcome.
import type { EmailOutcome } from "./email/receive";
import type { StoredChangeRequest } from "./repo";
import type { TradeOutcome } from "./trade/receive";

export type BotPayload =
  | { source: "email"; outcome: EmailOutcome }
  | { source: "trade_upload"; outcome: TradeOutcome }
  | { source: "change_digest"; since: string; requests: StoredChangeRequest[] };

export interface BotNotifier {
  // Fire and forget: returns at once, the delivery runs on its own
  send(payload: BotPayload): void;
  // For tests and shutdown: settles when every delivery started so far has finished
  idle(): Promise<void>;
}

export interface BotLogEntry {
  at: string;
  kind: "bot_notify_failed";
  source: BotPayload["source"];
  // HTTP status or the error's class name, never the payload
  error: string;
}

export class BotConfigError extends Error {
  override name = "BotConfigError";
}

export const BOT_TIMEOUT_MS = 3000;
const MIN_TOKEN_LENGTH = 32;
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function createBotNotifier(options: {
  url: string;
  token: string;
  log: (entry: BotLogEntry) => void;
  fetch?: typeof fetch;
  timeoutMs?: number;
}): BotNotifier {
  let endpoint: URL;
  try {
    endpoint = new URL("/ingest/outcomes", options.url);
  } catch {
    throw new BotConfigError("BOT_URL is not a valid URL");
  }
  // The token and the outcomes travel to it
  if (endpoint.protocol !== "https:" && !(endpoint.protocol === "http:" && LOOPBACK.has(endpoint.hostname))) {
    throw new BotConfigError("BOT_URL must use https (plain http only to localhost)");
  }
  if (options.token.length < MIN_TOKEN_LENGTH) {
    throw new BotConfigError(`BOT_INGEST_TOKEN must be at least ${MIN_TOKEN_LENGTH} characters`);
  }
  const doFetch = options.fetch ?? fetch;
  const pending = new Set<Promise<void>>();

  const deliver = async (payload: BotPayload) => {
    const fail = (error: string) =>
      options.log({ at: new Date().toISOString(), kind: "bot_notify_failed", source: payload.source, error });
    try {
      const res = await doFetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${options.token}` },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(options.timeoutMs ?? BOT_TIMEOUT_MS),
      });
      if (!res.ok) fail(`http_${res.status}`);
    } catch (e) {
      fail(e instanceof Error ? e.name : "unknown");
    }
  };

  return {
    send(payload) {
      const p = deliver(payload).finally(() => pending.delete(p));
      pending.add(p);
    },
    async idle() {
      await Promise.all([...pending]);
    },
  };
}

// BOT_URL and BOT_INGEST_TOKEN. Without BOT_URL there is no notifier. The token must differ
// from ingest's own tokens: the bot must not be able to post email or administer ingest.
export function botNotifierFromEnv(
  env: Record<string, string | undefined>,
  log: (entry: BotLogEntry) => void,
): BotNotifier | undefined {
  if (!env.BOT_URL) return undefined;
  const token = env.BOT_INGEST_TOKEN ?? "";
  if (token === env.INGEST_WEBHOOK_TOKEN || token === env.INGEST_ADMIN_TOKEN) {
    throw new BotConfigError("BOT_INGEST_TOKEN must differ from the ingest tokens");
  }
  return createBotNotifier({ url: env.BOT_URL, token, log });
}

export const DIGEST_INTERVAL_HOURS = 24;

// The change digest payload since `since`, or undefined when there is nothing new. Shared by the
// local timer below and the daily Lambda (aws/src/handlers/digest.ts).
export async function changeDigestPayload(
  digest: (since: Date) => StoredChangeRequest[] | Promise<StoredChangeRequest[]>,
  since: Date,
): Promise<BotPayload | undefined> {
  const requests = await digest(since);
  return requests.length > 0 ? { source: "change_digest", since: since.toISOString(), requests } : undefined;
}

// Sends IngestRepo.changeDigest once per interval, only when there is something new (T3.2:
// one summary instead of a notification each). The timer does not keep the process alive.
export function scheduleChangeDigest(
  notifier: BotNotifier,
  digest: (since: Date) => StoredChangeRequest[] | Promise<StoredChangeRequest[]>,
  hours = DIGEST_INTERVAL_HOURS,
  now: () => Date = () => new Date(),
): { stop(): void; tick(): Promise<void> } {
  let since = now();
  const tick = async () => {
    const until = now();
    const payload = await changeDigestPayload(digest, since);
    if (payload) notifier.send(payload);
    since = until;
  };
  const timer = setInterval(() => {
    tick().catch((e: unknown) => console.error("change digest failed", e instanceof Error ? e.name : "unknown"));
  }, hours * 60 * 60 * 1000);
  timer.unref();
  return { stop: () => clearInterval(timer), tick };
}
