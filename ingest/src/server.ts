// HTTP entry points of ingest. Closed by default.
//   POST /inbound         raw MIME from the mail forwarder      Bearer INGEST_WEBHOOK_TOKEN
//   GET  /admin/settings  current LLM and DMARC settings         Bearer INGEST_ADMIN_TOKEN
//   PUT  /admin/settings  change them (audited)                  Bearer INGEST_ADMIN_TOKEN
//   POST /trade/documents a Keel Trade document from the app       EIP-712 signature of a party
// Without a webhook token the server does not start; without an admin token the admin
// routes do not exist. The two tokens must differ: the forwarder cannot administer.
// Without an orders file the trade route does not exist.
import { createHash, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type RequestListener, type Server, type ServerResponse } from "node:http";
import type { DNSResolver } from "mailauth";
import { z } from "zod";
import { ALIAS_IDS } from "@keel/schemas";
import { MAX_EMAIL_BYTES } from "./email/mime";
import { receiveEmail, type EmailOutcome } from "./email/receive";
import type { AliasTable } from "./parser";
import { MAX_PDF_BYTES } from "./pdf/text";
import { receiveTradeDocument, type TradeOutcome } from "./trade/receive";
import { staticOrders, type OrderRegistry, type TradeOrderEntry } from "./trade/upload";
import { initialSettings, keysFromEnv, SettingsError, SettingsStore, type SettingsAudit } from "./settings";
import { IngestStore } from "./store";

const MIN_TOKEN_LENGTH = 32;
const MAX_ADMIN_BODY_BYTES = 16 * 1024;
// A base64 PDF of MAX_PDF_BYTES plus the JSON envelope
const MAX_TRADE_BODY_BYTES = Math.ceil((MAX_PDF_BYTES * 4) / 3) + 16 * 1024;
const ACTOR_RE = /^[\w.@+-]{1,64}$/;

const hex = (bytes: number) =>
  z
    .string()
    .regex(new RegExp(`^0x[0-9a-fA-F]{${bytes * 2}}$`))
    .transform((v) => v.toLowerCase() as `0x${string}`);

const destination = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("evm_address"), value: hex(20) }).strict(),
  z.object({ kind: z.literal("bank_account"), value: z.string().regex(/^[0-9A-Z]{6,34}$/) }).strict(),
]);

const OrdersSchema = z.array(
  z
    .object({
      orderId: hex(32),
      payoutAddress: hex(20),
      carrier: hex(20),
      uploaders: z
        .array(z.object({ address: hex(20), party: z.enum(["importer", "exporter"]) }).strict())
        .min(1),
      knownDestinations: z.array(destination).optional(),
    })
    .strict(),
);

const TradeUploadBody = z
  .object({
    orderId: hex(32),
    docType: z.string().max(32),
    issuedAt: z.number().int().positive(),
    signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/),
    // The PDF, base64
    file: z.string().max(MAX_TRADE_BODY_BYTES),
  })
  .strict();

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

export interface TradeLogEntry {
  at: string;
  kind: "trade_document";
  orderId: string;
  fileHash?: string;
  status: TradeOutcome["status"];
  reason?: string;
}

export interface ServerDeps {
  webhookToken: string;
  adminToken?: string;
  aliases: AliasTable;
  settings: SettingsStore;
  store: IngestStore;
  resolver?: DNSResolver;
  // Keel Trade uploads. Without it the route does not exist.
  trade?: { orders: OrderRegistry; chainId: number };
  // The activity log. Receives typed fields only, never message content.
  log?: (entry: LogEntry | SettingsAudit | TradeLogEntry) => void;
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

  // The signature is the authentication: it binds a registered representative to the exact file.
  const tradeUpload = async (req: IncomingMessage, res: ServerResponse, trade: NonNullable<ServerDeps["trade"]>) => {
    const raw = await readBody(req, MAX_TRADE_BODY_BYTES);
    if (raw === null) return reply(res, 413, { error: "too_large" });
    let body: z.infer<typeof TradeUploadBody>;
    try {
      body = TradeUploadBody.parse(JSON.parse(raw.toString("utf8")));
    } catch {
      return reply(res, 400, { error: "invalid_request" });
    }
    const outcome = await receiveTradeDocument(
      {
        orderId: body.orderId,
        docType: body.docType,
        issuedAt: body.issuedAt,
        signature: body.signature as `0x${string}`,
        file: new Uint8Array(Buffer.from(body.file, "base64")),
      },
      trade.orders,
      await deps.settings.getExtractor(),
      { store: deps.store, chainId: trade.chainId },
    );
    const reason = "reason" in outcome ? String(outcome.reason) : undefined;
    const fileHash = "fileHash" in outcome ? outcome.fileHash : undefined;
    log({ at: new Date().toISOString(), kind: "trade_document", orderId: body.orderId, fileHash, status: outcome.status, reason });
    if (outcome.status === "rejected") {
      const code = { too_large: 413, unknown_order: 404, unknown_doc_type: 400, bad_signature: 401, stale_signature: 401, not_a_party: 403 }[outcome.reason];
      return reply(res, code, { status: "rejected", reason: outcome.reason });
    }
    reply(res, 200, outcome);
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
      if (req.url === "/trade/documents" && req.method === "POST" && deps.trade) return await tradeUpload(req, res, deps.trade);
      reply(res, 404, { error: "not_found" });
    } catch (e) {
      console.error("request failed", e instanceof Error ? e.name : "unknown");
      if (!res.headersSent) reply(res, 500, { error: "internal" });
    }
  };
}

// INGEST_WEBHOOK_TOKEN, INGEST_ADMIN_TOKEN (optional), INGEST_ALIASES_FILE (Keel Personal),
// INGEST_ORDERS_FILE and INGEST_CHAIN_ID (Keel Trade), INGEST_DB_FILE (default ingest.db),
// INGEST_SETTINGS_FILE (optional), INGEST_HOST (default 127.0.0.1), INGEST_PORT (default 8788),
// the per-provider API keys and the initial LLM_* settings.
export async function startServer(env: Record<string, string | undefined> = process.env): Promise<Server> {
  if (!env.INGEST_ALIASES_FILE && !env.INGEST_ORDERS_FILE) {
    throw new ServerConfigError("set INGEST_ALIASES_FILE (Keel Personal), INGEST_ORDERS_FILE (Keel Trade) or both");
  }
  const aliases = env.INGEST_ALIASES_FILE
    ? AliasTableSchema.parse(JSON.parse(await readFile(env.INGEST_ALIASES_FILE, "utf8")))
    : [];
  let trade: ServerDeps["trade"];
  if (env.INGEST_ORDERS_FILE) {
    const chainId = Number(env.INGEST_CHAIN_ID);
    if (!Number.isSafeInteger(chainId) || chainId <= 0) throw new ServerConfigError("INGEST_CHAIN_ID must be a positive integer");
    const orders: TradeOrderEntry[] = OrdersSchema.parse(JSON.parse(await readFile(env.INGEST_ORDERS_FILE, "utf8")));
    trade = { orders: staticOrders(orders), chainId };
  }
  const log = (entry: LogEntry | SettingsAudit | TradeLogEntry) => console.log(JSON.stringify(entry));
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
    trade,
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
