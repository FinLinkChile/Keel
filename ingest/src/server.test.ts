import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ALIAS_IDS } from "@keel/schemas";
import { createHandler, ServerConfigError, type LogEntry, type ProformaLogEntry, type SignedOrderLogEntry, type TradeLogEntry } from "./server";
import { SettingsStore, type SettingsAudit } from "./settings";
import { IngestStore } from "./store";
import { composeEmail, fakeDns, makeDomain, signEmail } from "./testing/renderEmail";
import { renderInvoice, sampleSpec } from "./testing/renderInvoice";
import { renderCommercialInvoice } from "./testing/renderTrade";
import { LEGIT_SETS, testAccount } from "./testing/tradeCorpus";
import { CORPUS_CHAIN_ID, corpusOrders } from "./testing/tradeCorpusRunner";
import { fileHash, uploadDomain, UPLOAD_TYPES } from "./trade/upload";

const WEBHOOK = "w".repeat(40);
const ADMIN = "a".repeat(40);

let server: Server;
let url: string;
let settings: SettingsStore;
const logs: (LogEntry | SettingsAudit | TradeLogEntry | ProformaLogEntry | SignedOrderLogEntry)[] = [];

const newStore = () =>
  SettingsStore.open({
    fallback: { provider: "anthropic", model: "claude-opus-5-5", requireDmarc: true },
    keys: { anthropic: "ka", "openai-compatible": "kc" },
    urls: { "openai-compatible": "https://qwen.example/v1" },
    audit: (e) => logs.push(e),
  });

beforeAll(async () => {
  settings = await newStore();
  const handler = createHandler({
    webhookToken: WEBHOOK,
    adminToken: ADMIN,
    aliases: [{ alias: ALIAS_IDS[0], rut: "761234560", emailDomain: "aduanasperez.cl" }],
    settings,
    store: new IngestStore(":memory:"),
    resolver: fakeDns([{ domain: makeDomain("aduanasperez.cl") }]),
    log: (e) => logs.push(e),
  });
  server = createServer(handler);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

const call = (method: string, path: string, opts: { token?: string; body?: Buffer | string; actor?: string } = {}) =>
  fetch(`${url}${path}`, {
    method,
    body: opts.body,
    headers: {
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      ...(opts.actor ? { "x-admin-actor": opts.actor } : {}),
      "x-envelope-ip": "192.0.2.66",
    },
  });

const json = async (res: Response) => (await res.json()) as Record<string, unknown>;

describe("server setup", () => {
  it("refuses short tokens, and an admin token equal to the webhook token", async () => {
    const store = await newStore();
    const base = { aliases: [], settings: store, store: new IngestStore(":memory:") };
    expect(() => createHandler({ ...base, webhookToken: "" })).toThrow(ServerConfigError);
    expect(() => createHandler({ ...base, webhookToken: WEBHOOK, adminToken: "short" })).toThrow(ServerConfigError);
    expect(() => createHandler({ ...base, webhookToken: WEBHOOK, adminToken: WEBHOOK })).toThrow(/differ/);
  });

  it("has no admin routes when no admin token is configured", async () => {
    const handler = createHandler({ webhookToken: WEBHOOK, aliases: [], settings: await newStore(), store: new IngestStore(":memory:") });
    const s = createServer(handler);
    await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
    const res = await fetch(`http://127.0.0.1:${(s.address() as AddressInfo).port}/admin/settings`, {
      headers: { authorization: `Bearer ${ADMIN}` },
    });
    expect(res.status).toBe(404);
    await new Promise<void>((r) => s.close(() => r()));
  });
});

describe("POST /inbound", () => {
  it("rejects missing or wrong tokens, including the admin token", async () => {
    expect((await call("POST", "/inbound", { body: "x" })).status).toBe(401);
    expect((await call("POST", "/inbound", { body: "x", token: ADMIN })).status).toBe(401);
  });

  it("quarantines an unauthenticated email and logs only typed fields", async () => {
    const raw = composeEmail({ from: "facturas@aduanasperez.cl", pdfs: [await renderInvoice(sampleSpec())] });
    const res = await call("POST", "/inbound", { body: raw, token: WEBHOOK });
    expect(await json(res)).toEqual({ status: "quarantined", reason: "not_authenticated" });
    const entry = logs.at(-1)!;
    expect(Object.keys(entry).sort()).toEqual(["at", "auth", "messageHash", "reason", "status"]);
    expect(JSON.stringify(entry)).not.toContain("facturas@");
  });

  it("quarantines a perfectly authenticated but unregistered domain before the model", async () => {
    const other = makeDomain("evil.cl");
    const raw = await signEmail(composeEmail({ from: "x@evil.cl", pdfs: [await renderInvoice(sampleSpec())] }), other);
    expect((await json(await call("POST", "/inbound", { body: raw, token: WEBHOOK }))).status).toBe("quarantined");
  });
});

describe("/admin/settings", () => {
  it("rejects the webhook token", async () => {
    expect((await call("GET", "/admin/settings", { token: WEBHOOK })).status).toBe(401);
  });

  it("returns the settings and the providers that have a key, never the keys", async () => {
    const res = await call("GET", "/admin/settings", { token: ADMIN });
    const body = await json(res);
    expect(body).toMatchObject({
      settings: { provider: "anthropic", requireDmarc: true },
      availableProviders: ["anthropic", "openai-compatible"],
    });
    const text = JSON.stringify(body);
    expect(text).not.toContain("ka");
    expect(text).not.toContain("kc");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("changes the DMARC policy and records who did it", async () => {
    const res = await call("PUT", "/admin/settings", { token: ADMIN, actor: "dani", body: JSON.stringify({ requireDmarc: false }) });
    expect(res.status).toBe(200);
    expect(settings.get()).toMatchObject({ settings: { requireDmarc: false }, updatedBy: "dani" });
    expect(logs.at(-1)).toMatchObject({ type: "settings_changed", actor: "dani", changes: { requireDmarc: { from: true, to: false } } });
  });

  it("shows where documents go but refuses to change it", async () => {
    const res = await call("PUT", "/admin/settings", { token: ADMIN, actor: "dani", body: JSON.stringify({ baseURL: "https://attacker.example" }) });
    expect(res.status).toBe(400);
    const body = await json(await call("GET", "/admin/settings", { token: ADMIN }));
    expect(body).toHaveProperty("baseURL");
    expect(JSON.stringify(body)).not.toContain("attacker");
  });

  it("requires an actor and valid input", async () => {
    expect((await call("PUT", "/admin/settings", { token: ADMIN, body: "{}" })).status).toBe(400);
    const bad = await call("PUT", "/admin/settings", { token: ADMIN, actor: "dani", body: JSON.stringify({ provider: "gemini", model: "x" }) });
    expect(bad.status).toBe(400);
    expect((await json(bad)).message).toMatch(/GEMINI_API_KEY/);
    expect((await call("PUT", "/admin/settings", { token: ADMIN, actor: "dani", body: "not json" })).status).toBe(400);
  });
});

describe("POST /trade/documents", () => {
  const set = LEGIT_SETS[0]!;
  let tradeUrl: string;
  let tradeServer: Server;

  beforeAll(async () => {
    const handler = createHandler({
      webhookToken: WEBHOOK,
      aliases: [],
      settings: await newStore(),
      store: new IngestStore(":memory:"),
      trade: { orders: corpusOrders, chainId: CORPUS_CHAIN_ID },
      log: (e) => logs.push(e),
    });
    tradeServer = createServer(handler);
    await new Promise<void>((r) => tradeServer.listen(0, "127.0.0.1", r));
    tradeUrl = `http://127.0.0.1:${(tradeServer.address() as AddressInfo).port}/trade/documents`;
  });

  afterAll(() => new Promise<void>((r) => tradeServer.close(() => r())));

  const body = async (bytes: Uint8Array, signer = testAccount(`${set.id}:exporter`)) => {
    const issuedAt = Math.floor(Date.now() / 1000);
    const signature = await signer.signTypedData({
      domain: uploadDomain(CORPUS_CHAIN_ID),
      types: UPLOAD_TYPES,
      primaryType: "DocumentUpload",
      message: { orderId: set.order.orderId, docType: "COMMERCIAL_INVOICE", fileHash: fileHash(bytes), issuedAt: BigInt(issuedAt) },
    });
    return JSON.stringify({
      orderId: set.order.orderId,
      docType: "COMMERCIAL_INVOICE",
      issuedAt,
      signature,
      file: Buffer.from(bytes).toString("base64"),
    });
  };
  const post = (b: string) => fetch(tradeUrl, { method: "POST", body: b });

  it("does not exist without an orders registry", async () => {
    expect((await call("POST", "/trade/documents", { body: "{}" })).status).toBe(404);
  });

  it("refuses a malformed request and a signer who is not a party", async () => {
    expect((await post("{}")).status).toBe(400);
    const res = await post(await body(await renderCommercialInvoice(set.invoice), testAccount("outsider")));
    expect(res.status).toBe(403);
    expect(await json(res)).toEqual({ status: "rejected", reason: "not_a_party" });
  });

  it("quarantines a signed file that is not a PDF before reading it, and logs typed fields only", async () => {
    const res = await post(await body(new TextEncoder().encode("PK\u0003\u0004")));
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ status: "quarantined", reason: "not_pdf", party: "exporter" });
    expect(logs.at(-1)).toMatchObject({ kind: "trade_document", orderId: set.order.orderId, status: "quarantined", reason: "not_pdf" });
  });
});

describe("bot notifications and CORS", () => {
  const set = LEGIT_SETS[0]!;
  const APP = "https://app.keel.example";
  let base: string;
  let srv: Server;
  const sent: unknown[] = [];

  beforeAll(async () => {
    const handler = createHandler({
      webhookToken: WEBHOOK,
      aliases: [{ alias: ALIAS_IDS[0], rut: "761234560", emailDomain: "aduanasperez.cl" }],
      settings: await newStore(),
      store: new IngestStore(":memory:"),
      resolver: fakeDns([{ domain: makeDomain("aduanasperez.cl") }]),
      trade: { orders: corpusOrders, chainId: CORPUS_CHAIN_ID },
      bot: { send: (p) => sent.push(p), idle: async () => {} },
      appOrigin: APP,
      log: () => {},
    });
    srv = createServer(handler);
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  });

  afterAll(() => new Promise<void>((r) => srv.close(() => r())));

  it("tells the bot every email and trade outcome, as is", async () => {
    const raw = composeEmail({ from: "facturas@aduanasperez.cl", pdfs: [await renderInvoice(sampleSpec())] });
    await fetch(`${base}/inbound`, { method: "POST", body: raw, headers: { authorization: `Bearer ${WEBHOOK}` } });
    await fetch(`${base}/trade/documents`, {
      method: "POST",
      body: JSON.stringify({ orderId: set.order.orderId, docType: "COMMERCIAL_INVOICE", issuedAt: 1, signature: `0x${"00".repeat(65)}`, file: "" }),
    });
    expect(sent).toMatchObject([
      { source: "email", outcome: { status: "quarantined" } },
      { source: "trade_upload", outcome: { status: "rejected" } },
    ]);
  });

  it("answers CORS on the trade route for the app's origin only", async () => {
    const pre = await fetch(`${base}/trade/documents`, { method: "OPTIONS", headers: { origin: APP } });
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-origin")).toBe(APP);
    expect(pre.headers.get("access-control-allow-methods")).toBe("POST");
    const other = await fetch(`${base}/trade/documents`, { method: "OPTIONS", headers: { origin: "https://evil.example" } });
    expect(other.headers.get("access-control-allow-origin")).toBeNull();
    const inbound = await fetch(`${base}/inbound`, { method: "POST", headers: { origin: APP } });
    expect(inbound.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("refuses an origin that is not exact or not https", async () => {
    const base = { webhookToken: WEBHOOK, aliases: [], settings: await newStore(), store: new IngestStore(":memory:") };
    for (const bad of ["http://app.example", "https://app.example/path", "*", "app.example"]) {
      expect(() => createHandler({ ...base, appOrigin: bad }), bad).toThrow(ServerConfigError);
    }
  });
});

