// POST /notices: the local entry point for producers. Same pattern as ingest/src/server.ts:
// Bearer token compared in constant time, body size limit, listens on BOT_HOST.
// The body is a Notice or an array of them. 401 without a valid token, 400 if any notice
// does not validate (nothing is sent), 202 otherwise.
// How producers reach the bot is open decision 15: this is the current assumption.
import { createHash, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type RequestListener, type Server, type ServerResponse } from "node:http";
import type { NotifyResult } from "../../application/notify";
import { Notice } from "../../domain/notice";
import { ConfigError } from "../config/env";

const MAX_BODY_BYTES = 64 * 1024;
const MAX_NOTICES = 100;
const MIN_TOKEN_LENGTH = 32;

const digest = (s: string) => createHash("sha256").update(s).digest();

function reply(res: ServerResponse, code: number, body: object): void {
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
  notify(input: unknown): Promise<NotifyResult>;
}

export function createNoticeHandler(token: string, sink: NoticeSink): RequestListener {
  if (token.length < MIN_TOKEN_LENGTH) throw new ConfigError(`BOT_INBOUND_TOKEN must be at least ${MIN_TOKEN_LENGTH} characters`);
  const expected = digest(token);
  const authorized = (req: IncomingMessage) => {
    const auth = req.headers.authorization ?? "";
    return auth.startsWith("Bearer ") && timingSafeEqual(digest(auth.slice(7)), expected);
  };

  return async (req, res) => {
    if (req.url !== "/notices") return reply(res, 404, { error: "not_found" });
    if (req.method !== "POST") return reply(res, 405, { error: "method_not_allowed" });
    if (!authorized(req)) return reply(res, 401, { error: "unauthorized" });
    const body = await readBody(req);
    if (body === null) return reply(res, 413, { error: "too_large" });

    let json: unknown;
    try {
      json = JSON.parse(body.toString("utf8"));
    } catch {
      return reply(res, 400, { error: "invalid_json" });
    }
    const notices = Array.isArray(json) ? json : [json];
    if (notices.length === 0 || notices.length > MAX_NOTICES) return reply(res, 400, { error: "bad_batch_size" });
    // All or nothing at the schema level, so a producer never gets half a batch sent.
    const invalid = notices.findIndex((n) => !Notice.safeParse(n).success);
    if (invalid >= 0) {
      // Through the service anyway, so the rejection is logged and counted like any other.
      await sink.notify(notices[invalid]);
      return reply(res, 400, { error: "invalid_notice", index: invalid });
    }

    const results: NotifyResult["status"][] = [];
    for (const n of notices) results.push((await sink.notify(n)).status);
    reply(res, 202, { results });
  };
}

export function startNoticeServer(handler: RequestListener, host: string, port: number): Promise<Server> {
  return new Promise((resolve) => {
    const server = createServer(handler).listen(port, host, () => resolve(server));
  });
}
