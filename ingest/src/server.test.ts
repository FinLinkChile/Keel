import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ALIAS_IDS } from "@keel/schemas";
import { createHandler, ServerConfigError, type LogEntry } from "./server";
import { SettingsStore, type SettingsAudit } from "./settings";
import { IngestStore } from "./store";
import { composeEmail, fakeDns, makeDomain, signEmail } from "./testing/renderEmail";
import { renderInvoice, sampleSpec } from "./testing/renderInvoice";

const WEBHOOK = "w".repeat(40);
const ADMIN = "a".repeat(40);

let server: Server;
let url: string;
let settings: SettingsStore;
const logs: (LogEntry | SettingsAudit)[] = [];

const newStore = () =>
  SettingsStore.open({
    fallback: { provider: "anthropic", model: "claude-opus-5-5", requireDmarc: true },
    keys: { anthropic: "ka", "openai-compatible": "kc" },
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

  it("requires an actor and valid input", async () => {
    expect((await call("PUT", "/admin/settings", { token: ADMIN, body: "{}" })).status).toBe(400);
    const bad = await call("PUT", "/admin/settings", { token: ADMIN, actor: "dani", body: JSON.stringify({ provider: "gemini", model: "x" }) });
    expect(bad.status).toBe(400);
    expect((await json(bad)).message).toMatch(/GEMINI_API_KEY/);
    expect((await call("PUT", "/admin/settings", { token: ADMIN, actor: "dani", body: "not json" })).status).toBe(400);
  });
});
