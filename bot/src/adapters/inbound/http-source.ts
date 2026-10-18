// HTTP entry points of the bot. Closed by default: a route exists only if its token is set.
//   POST /notices          a Notice or an array of them          Bearer BOT_INBOUND_TOKEN
//   POST /ingest/outcomes  ingest's own output, mapped here       Bearer BOT_INGEST_TOKEN
// Same pattern as ingest/src/server.ts: Bearer token compared in constant time, 64 KB body
// limit, listens on BOT_HOST. How producers reach the bot is not decided yet: these routes are
// a proposal.
import { createHash, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type RequestListener, type Server, type ServerResponse } from "node:http";
import type { NoticeOrigin, NotifyResult } from "../../application/notify";
import { Notice } from "../../domain/notice";
import { ConfigError } from "../config/env";

const MAX_BODY_BYTES = 64 * 1024;
const MAX_NOTICES = 100;
const MIN_TOKEN_LENGTH = 32;

const digest = (s: string) => createHash("sha256").update(s).digest();

export function reply(res: ServerResponse, code: number, body: object): void {
  res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).byteLength;
    if (size > MAX_BODY_BYTES) return null;
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

export interface NoticeSink {
  notify(input: unknown, origin?: NoticeOrigin): Promise<NotifyResult>;
}

// A route receives the parsed JSON body once the token and the size are checked.
export type JsonRoute = (json: unknown, res: ServerResponse) => Promise<void>;

export interface HttpRoutes {
  notices?: { token: string; sink: NoticeSink };
  ingest?: { token: string; route: JsonRoute };
}

export function createHttpHandler(routes: HttpRoutes): RequestListener {
  const table = new Map<string, { expected: Buffer; route: JsonRoute }>();
  const add = (path: string, name: string, token: string, route: JsonRoute) => {
    if (token.length < MIN_TOKEN_LENGTH) throw new ConfigError(`${name} must be at least ${MIN_TOKEN_LENGTH} characters`);
    table.set(path, { expected: digest(token), route });
  };
  if (routes.notices) add("/notices", "BOT_INBOUND_TOKEN", routes.notices.token, noticesRoute(routes.notices.sink));
  if (routes.ingest) add("/ingest/outcomes", "BOT_INGEST_TOKEN", routes.ingest.token, routes.ingest.route);

  return async (req, res) => {
    const entry = table.get(req.url ?? "");
    if (!entry) return reply(res, 404, { error: "not_found" });
    if (req.method !== "POST") return reply(res, 405, { error: "method_not_allowed" });
    const auth = req.headers.authorization ?? "";
    if (!(auth.startsWith("Bearer ") && timingSafeEqual(digest(auth.slice(7)), entry.expected))) {
      return reply(res, 401, { error: "unauthorized" });
    }
    const body = await readBody(req);
    if (body === null) return reply(res, 413, { error: "too_large" });
    let json: unknown;
    try {
      json = JSON.parse(body.toString("utf8"));
    } catch {
      return reply(res, 400, { error: "invalid_json" });
    }
    await entry.route(json, res);
  };
}

// What a route answers, apart from how it travels: the HTTP routes reply with it, and the queue
// source (queue-source.ts) reads the code to tell a bad message from a delivered one.
export interface Delivery {
  code: number;
  body: object;
}

function noticesRoute(sink: NoticeSink): JsonRoute {
  return async (json, res) => {
    const { code, body } = await deliverNotices(sink, json);
    reply(res, code, body);
  };
}

// The body is a Notice or an array of them. 400 if any notice does not validate (nothing is
// sent), 202 otherwise with each notice's status.
export async function deliverNotices(sink: NoticeSink, json: unknown): Promise<Delivery> {
  const notices = Array.isArray(json) ? json : [json];
  if (notices.length === 0 || notices.length > MAX_NOTICES) return { code: 400, body: { error: "bad_batch_size" } };
  // All or nothing at the schema level, so a producer never gets half a batch sent.
  const invalid = notices.findIndex((n) => !Notice.safeParse(n).success);
  if (invalid >= 0) {
    // Through the service anyway, so the rejection is logged and counted like any other.
    await sink.notify(notices[invalid]);
    return { code: 400, body: { error: "invalid_notice", index: invalid } };
  }
  const results: NotifyResult["status"][] = [];
  for (const n of notices) results.push((await sink.notify(n)).status);
  return { code: 202, body: { results } };
}

export function startHttpServer(handler: RequestListener, host: string, port: number): Promise<Server> {
  return new Promise((resolve) => {
    const server = createServer(handler).listen(port, host, () => resolve(server));
  });
}
