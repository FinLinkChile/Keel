// HTTP way into the notices queue, for producers that cannot write to SQS themselves. Same routes
// and bodies as the local bot (docs/interfaces/avisos-al-bot.md), but the answer is only that the
// body was queued: validation, deduplication and sending happen in botNotify, so the per-notice
// statuses the local bot returns are not available here.
//   POST /notices          a Notice or an array of 1 to 100      Bearer secret bot_inbound_token
//   POST /ingest/outcomes  ingest's own output                   Bearer secret bot_inbound_token
// The body is checked only for its top-level shape and queued as it came. 202 { queued: true };
// 401 wrong token; 400 bad_json / bad_request; 413 over 64 KB; 503 the queue refused it.
//
// Environment: NOTICES_QUEUE_URL, KEEL_CHAIN_ID. Secret: bot_inbound_token.
import { api, HttpError, type Request } from "../http";
import { enqueueNotice, type NoticeMessage } from "../notices";
import { botRuntime, jsonBody, requireToken } from "../bot/runtime";

const MAX_BODY_BYTES = 64 * 1024;
const MAX_NOTICES = 100;

const isObject = (v: unknown): v is object => typeof v === "object" && v !== null && !Array.isArray(v);

async function queue(message: NoticeMessage) {
  if (!(await enqueueNotice(message))) throw new HttpError(503, "queue_unavailable");
  return { status: 202, body: { queued: true } };
}

async function notices(req: Request) {
  await requireToken(req, botRuntime(), "bot_inbound_token");
  const json = jsonBody(req, MAX_BODY_BYTES);
  const list = Array.isArray(json) ? json : [json];
  if (list.length === 0 || list.length > MAX_NOTICES || !list.every(isObject)) throw new HttpError(400, "bad_request");
  return queue({ kind: "notices", notices: list });
}

async function ingestOutcomes(req: Request) {
  await requireToken(req, botRuntime(), "bot_inbound_token");
  const json = jsonBody(req, MAX_BODY_BYTES);
  if (!isObject(json) || typeof (json as { source?: unknown }).source !== "string") throw new HttpError(400, "bad_request");
  return queue({ kind: "ingest_outcome", payload: json });
}

export const handler = api(
  { "POST /notices": notices, "POST /ingest/outcomes": ingestOutcomes },
  { "POST /notices": { auth: false }, "POST /ingest/outcomes": { auth: false } },
);
