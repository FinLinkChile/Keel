// HTTP entry points of ingest. Closed by default.
//   POST /inbound         raw MIME from the mail forwarder      Bearer INGEST_WEBHOOK_TOKEN
//   GET  /admin/settings  current LLM and DMARC settings         Bearer INGEST_ADMIN_TOKEN
//   PUT  /admin/settings  change them (audited)                  Bearer INGEST_ADMIN_TOKEN
// Without a webhook token the server does not start; without an admin token the admin
// routes do not exist. The two tokens must differ: the forwarder cannot administer.
import { createHash, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type RequestListener, type Server, type ServerResponse } from "node:http";
import type { DNSResolver } from "mailauth";
import { z } from "zod";
import { ALIAS_IDS } from "@keel/schemas";
import { MAX_EMAIL_BYTES } from "./email/mime";
import { receiveEmail, type EmailOutcome } from "./email/receive";
import type { AliasTable } from "./parser";
import { initialSettings, keysFromEnv, SettingsError, SettingsStore, type SettingsAudit } from "./settings";
import { IngestStore } from "./store";

const MIN_TOKEN_LENGTH = 32;
const MAX_ADMIN_BODY_BYTES = 16 * 1024;
const ACTOR_RE = /^[\w.@+-]{1,64}$/;

const AliasTableSchema = z.array(
  z
    .object({
      alias: z.enum(ALIAS_IDS),
      rut: z.string().regex(/^[0-9]{7,8}[0-9K]$/),
      emailDomain: z.string().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/),
      knownDestinations: z
        .array(
          z.discriminatedUnion("kind", [
            z
              .object({
                kind: z.literal("evm_address"),
                value: z
                  .string()
                  .regex(/^0x[0-9a-f]{40}$/)
                  .transform((v) => v as `0x${string}`),
              })
              .strict(),
            z.object({ kind: z.literal("bank_account"), value: z.string().regex(/^[0-9]{6,24}$/) }).strict(),
          ]),
        )
        .optional(),
    })
    .strict(),
);

export class ServerConfigError extends Error {
  override name = "ServerConfigError";
}

export interface LogEntry {
  at: string;
  messageHash: string;
  status: EmailOutcome["status"];
  reason?: string;
  auth: EmailOutcome["auth"];
}

export interface ServerDeps {
  webhookToken: string;
  adminToken?: string;
  aliases: AliasTable;
  settings: SettingsStore;
  store: IngestStore;
  resolver?: DNSResolver;
  // The activity log. Receives typed fields only, never message content.
  log?: (entry: LogEntry | SettingsAudit) => void;
}

const digest = (s: string) => createHash("sha256").update(s).digest();
const sameToken = (given: string, expected: string) => timingSafeEqual(digest(given), digest(expected));

function bearer(req: IncomingMessage, expected: string): boolean {
  const auth = req.headers.authorization ?? "";
  return auth.startsWith("Bearer ") && sameToken(auth.slice(7), expected);
}

function reply(res: ServerResponse, code: number, body: object): void {
  res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage, limit: number): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).byteLength;
    if (size > limit) return null;
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

const header = (req: IncomingMessage, name: string) => {
  const v = req.headers[name];
  return typeof v === "string" && v.length > 0 && v.length < 256 ? v : undefined;
};

export function createHandler(deps: ServerDeps): RequestListener {
  if (deps.webhookToken.length < MIN_TOKEN_LENGTH) {
    throw new ServerConfigError(`INGEST_WEBHOOK_TOKEN must be at least ${MIN_TOKEN_LENGTH} characters`);
  }
  if (deps.adminToken !== undefined) {
    if (deps.adminToken.length < MIN_TOKEN_LENGTH) {
      throw new ServerConfigError(`INGEST_ADMIN_TOKEN must be at least ${MIN_TOKEN_LENGTH} characters`);
    }
    if (sameToken(deps.adminToken, deps.webhookToken)) {
      throw new ServerConfigError("INGEST_ADMIN_TOKEN must differ from INGEST_WEBHOOK_TOKEN");
    }
  }
  const log = deps.log ?? ((entry) => console.log(JSON.stringify(entry)));

  const inbound = async (req: IncomingMessage, res: ServerResponse) => {
    if (!bearer(req, deps.webhookToken)) return reply(res, 401, { error: "unauthorized" });
    const raw = await readBody(req, MAX_EMAIL_BYTES);
    if (raw === null) return reply(res, 413, { error: "too_large" });
    const { settings } = deps.settings.get();
    const outcome = await receiveEmail(
      raw,
      { ip: header(req, "x-envelope-ip"), helo: header(req, "x-envelope-helo"), mailFrom: header(req, "x-envelope-from") },
      deps.aliases,
      await deps.settings.getExtractor(),
      { requireDmarc: settings.requireDmarc, store: deps.store, resolver: deps.resolver },
    );
    const reason = "reason" in outcome ? String(outcome.reason) : undefined;
    log({ at: new Date().toISOString(), messageHash: outcome.messageHash, status: outcome.status, reason, auth: outcome.auth });
    reply(res, 200, { status: outcome.status, ...(reason ? { reason } : {}) });
  };

  const admin = async (req: IncomingMessage, res: ServerResponse, adminToken: string) => {
    if (!bearer(req, adminToken)) return reply(res, 401, { error: "unauthorized" });
    if (req.method === "GET") {
      return reply(res, 200, { ...deps.settings.get(), availableProviders: deps.settings.availableProviders() });
    }
    if (req.method !== "PUT") return reply(res, 405, { error: "method_not_allowed" });
    const actor = header(req, "x-admin-actor");
    if (!actor || !ACTOR_RE.test(actor)) return reply(res, 400, { error: "missing_actor" });
    const body = await readBody(req, MAX_ADMIN_BODY_BYTES);
    if (body === null) return reply(res, 413, { error: "too_large" });
    let change: unknown;
    try {
      change = JSON.parse(body.toString("utf8"));
    } catch {
      return reply(res, 400, { error: "invalid_json" });
    }
    try {
      const updated = await deps.settings.update(change, actor);
      return reply(res, 200, { ...updated, availableProviders: deps.settings.availableProviders() });
    } catch (e) {
      if (e instanceof SettingsError) return reply(res, 400, { error: "invalid_settings", message: e.message });
      throw e;
    }
  };

  return async (req, res) => {
    try {
      if (req.url === "/inbound" && req.method === "POST") return await inbound(req, res);
      if (req.url === "/admin/settings" && deps.adminToken) return await admin(req, res, deps.adminToken);
      reply(res, 404, { error: "not_found" });
    } catch (e) {
      console.error("request failed", e instanceof Error ? e.name : "unknown");
      if (!res.headersSent) reply(res, 500, { error: "internal" });
    }
  };
}

// INGEST_WEBHOOK_TOKEN, INGEST_ADMIN_TOKEN (optional), INGEST_ALIASES_FILE, INGEST_DB_FILE
// (default ingest.db), INGEST_SETTINGS_FILE (optional), INGEST_HOST (default 127.0.0.1),
// INGEST_PORT (default 8788), the per-provider API keys and the initial LLM_* settings.
export async function startServer(env: Record<string, string | undefined> = process.env): Promise<Server> {
  if (!env.INGEST_ALIASES_FILE) throw new ServerConfigError("INGEST_ALIASES_FILE is not set");
  const aliases = AliasTableSchema.parse(JSON.parse(await readFile(env.INGEST_ALIASES_FILE, "utf8")));
  const log = (entry: LogEntry | SettingsAudit) => console.log(JSON.stringify(entry));
  const settings = await SettingsStore.open({
    fallback: initialSettings(env),
    keys: keysFromEnv(env),
    file: env.INGEST_SETTINGS_FILE || undefined,
    audit: log,
  });
  const handler = createHandler({
    webhookToken: env.INGEST_WEBHOOK_TOKEN ?? "",
    adminToken: env.INGEST_ADMIN_TOKEN || undefined,
    aliases,
    settings,
    store: new IngestStore(env.INGEST_DB_FILE || "ingest.db"),
    log,
  });
  const host = env.INGEST_HOST || "127.0.0.1";
  const port = Number(env.INGEST_PORT || 8788);
  return new Promise((resolve) => {
    const server = createServer(handler).listen(port, host, () => {
      console.log(`ingest listening on http://${host}:${port}`);
      resolve(server);
    });
  });
}
