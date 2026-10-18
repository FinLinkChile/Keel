import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { NotifyService } from "../../application/notify";
import { templateRenderer } from "../../presentation/templates";
import { directory, MemoryLogger, MemorySender, NOW_MS, SAMPLES } from "../../testing/fixtures";
import { parseOrders } from "../config/orders-file";
import { createHttpHandler, startHttpServer, type HttpRoutes } from "./http-source";
import { ingestRoute, type IngestRouteDeps } from "./ingest-source";

const TOKEN = "k".repeat(40);
const INGEST_TOKEN = "i".repeat(40);
let server: Server | undefined;

afterEach(() => server?.close());

async function start(ingest: Partial<IngestRouteDeps> = { personalAccountId: "ana" }) {
  const sender = new MemorySender();
  const service = new NotifyService(
    { directory, renderer: templateRenderer, sender, clock: { now: () => NOW_MS }, logger: new MemoryLogger() },
    { maxMessagesPerChatPerHour: 30 },
  );
  const mapperLog: unknown[] = [];
  const routes: HttpRoutes = {
    notices: { token: TOKEN, sink: service },
    ingest: {
      token: INGEST_TOKEN,
      route: ingestRoute({ sink: service, now: () => NOW_MS, log: (e) => mapperLog.push(e), ...ingest }),
    },
  };
  const s = await startHttpServer(createHttpHandler(routes), "127.0.0.1", 0);
  server = s;
  const base = `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
  const post = (path: string, body: unknown, token: string | null) =>
    fetch(`${base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  return {
    notices: (body: unknown, token: string | null = TOKEN) => post("/notices", body, token),
    outcomes: (body: unknown, token: string | null = INGEST_TOKEN) => post("/ingest/outcomes", body, token),
    sender,
    service,
    mapperLog,
  };
}

describe("POST /notices", () => {
  it("answers 401 without a valid token and sends nothing", async () => {
    const { notices, sender } = await start();
    expect((await notices(SAMPLES.balance_released, null)).status).toBe(401);
    expect((await notices(SAMPLES.balance_released, "x".repeat(40))).status).toBe(401);
    // Each route has its own token
    expect((await notices(SAMPLES.balance_released, INGEST_TOKEN)).status).toBe(401);
    expect(sender.sent).toHaveLength(0);
  });

  it("accepts a valid notice or batch with 202 and sends it", async () => {
    const { notices, sender } = await start();
    const res = await notices([SAMPLES.balance_released, SAMPLES.balance_released]);
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ results: ["accepted", "duplicate"] });
    expect(sender.sent).toHaveLength(4);
  });

  it("answers 400 to an invalid notice and sends none of the batch", async () => {
    const { notices, sender, service } = await start();
    const res = await notices([SAMPLES.balance_released, { ...SAMPLES.refunded, name: "Pay me" }]);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_notice", index: 1 });
    expect(sender.sent).toHaveLength(0);
    expect(service.stats().rejected).toBe(1);
    expect((await notices("{not json")).status).toBe(400);
  });

  it("refuses a body over 64 KB", async () => {
    const { notices } = await start();
    expect((await notices(JSON.stringify({ pad: "x".repeat(70_000) }))).status).toBe(413);
  });

  it("does not start with a short token", () => {
    expect(() => createHttpHandler({ notices: { token: "short", sink: { notify: async () => ({ status: "rejected" }) } } })).toThrow(
      /BOT_INBOUND_TOKEN must be at least 32/,
    );
  });

  it("has no route without its token", async () => {
    const s = await startHttpServer(createHttpHandler({}), "127.0.0.1", 0);
    server = s;
    const res = await fetch(`http://127.0.0.1:${(s.address() as AddressInfo).port}/ingest/outcomes`, { method: "POST" });
    expect(res.status).toBe(404);
  });
});

const received = { messageHash: "a".repeat(64), auth: { spf: "pass", dkim: "pass", dmarc: "pass" } };
const escalated = {
  status: "escalated",
  tier: 3,
  diffs: [{ field: "amount_clp", parser: 45990, llm: 459900 }],
  extraction: { alias_id: "LUZ" },
  ...received,
};

describe("POST /ingest/outcomes", () => {
  it("answers 401 without its token", async () => {
    const { outcomes, sender } = await start();
    expect((await outcomes({ source: "email", outcome: escalated }, null)).status).toBe(401);
    expect((await outcomes({ source: "email", outcome: escalated }, TOKEN)).status).toBe(401);
    expect(sender.sent).toHaveLength(0);
  });

  it("maps an email outcome and sends it", async () => {
    const { outcomes, sender } = await start();
    const res = await outcomes({ source: "email", outcome: escalated });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ status: "accepted" });
    expect(sender.sent.map((s) => s.message.text)[0]).toContain("disagree on the amount: $45.990 and $459.900");
    expect(await (await outcomes({ source: "email", outcome: escalated })).json()).toEqual({ status: "duplicate" });
  });

  it("ignores quarantined, duplicate and ready emails", async () => {
    const { outcomes, sender } = await start();
    for (const status of ["quarantined", "duplicate", "ready"]) {
      const res = await outcomes({ source: "email", outcome: { status, reason: "rate_limited", ...received } });
      expect(await res.json()).toEqual({ status: "ignored" });
    }
    expect(sender.sent).toHaveLength(0);
  });

  it("maps a change digest", async () => {
    const { outcomes, sender } = await start();
    const request = (id: number, aliasId: string) => ({ id, aliasId, status: "pending", createdAt: "2026-10-14T09:00:00Z" });
    const res = await outcomes({
      source: "change_digest",
      since: "2026-10-14T00:00:00Z",
      requests: [request(1, "LUZ"), request(2, "INTERNET")],
    });
    expect(await res.json()).toEqual({ status: "accepted" });
    expect(sender.sent[0]?.message.text).toBe(
      "2 account change requests arrived today for LUZ and INTERNET. Review them in Keel. Do not approve a change you did not expect.",
    );
  });

  it("answers 400 to a body without the minimal shape", async () => {
    const { outcomes } = await start();
    for (const body of [{}, { source: "fax" }, { source: "email" }, { source: "change_digest", since: "yesterday", requests: [] }]) {
      const res = await outcomes(body);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_body" });
    }
  });

  it("answers 400 when the mapper fails, and logs only the error class", async () => {
    const { outcomes, mapperLog } = await start();
    const res = await outcomes({ source: "email", outcome: { status: "escalated", diffs: "call +56912345678" } });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "mapper_failed", source: "email" });
    expect(mapperLog).toEqual([{ event: "ingest_mapper_failed", source: "email", error: "TypeError" }]);
  });

  it("rejects what the mapper produces if it does not validate", async () => {
    const { outcomes, sender } = await start();
    const res = await outcomes({ source: "email", outcome: { ...escalated, extraction: { alias_id: "CALL ME" } } });
    expect(await res.json()).toEqual({ status: "rejected" });
    expect(sender.sent).toHaveLength(0);
  });

  it("keeps Personal sources closed without BOT_PERSONAL_ACCOUNT_ID", async () => {
    const { outcomes } = await start({});
    expect(await (await outcomes({ source: "email", outcome: escalated })).json()).toEqual({ error: "source_disabled", source: "email" });
  });

  describe("trade uploads", () => {
    const ORDER_ID = `0x${"d4".repeat(32)}`;
    const FILE = `0x${"f1".repeat(32)}`;
    const received = { orderId: ORDER_ID, docType: "COMMERCIAL_INVOICE", fileHash: FILE, uploader: `0x${"11".repeat(20)}`, party: "exporter" };
    const orders = parseOrders(
      { orders: { [ORDER_ID]: { label: "PO-0142", importer: "acme-imports", exporter: "lingnan", arbiter: "hk-arbitration", shipmentDeadline: 1795132800 } } },
      () => true,
    );
    const alert = {
      id: 7,
      triggers: ["announced_in_document"],
      reminder: "payout_changes_only_with_new_signed_order",
      found: [{ kind: "bank_account", value: "6228480122334455" }],
    };
    const upload = (outcome: object) => ({ source: "trade_upload", outcome });

    it("stays closed without BOT_ORDERS_FILE", async () => {
      const closed = await start({});
      expect((await closed.outcomes(upload({ status: "rejected", reason: "bad_signature" }))).status).toBe(400);
    });

    it("sends a hold and answers accepted", async () => {
      const { outcomes, sender } = await start({ orders });
      const body = upload({ status: "held", reason: "bl_used_by_other_order", ...received });
      const res = await outcomes(body);
      expect(res.status).toBe(202);
      expect(await res.json()).toEqual({ status: "accepted" });
      expect(sender.sent.length).toBeGreaterThan(0);
      // The same upload reported again is sent once
      expect(await (await outcomes(body)).json()).toEqual({ status: "duplicate" });
    });

    it("answers with each notice when one upload gives more than one, and never sends the account", async () => {
      const { outcomes, sender } = await start({ orders });
      const res = await outcomes(upload({ status: "ready", ...received, extraction: { hidden_text_detected: true }, alert }));
      expect(await res.json()).toEqual({ status: "accepted", notices: ["accepted", "accepted"] });
      expect(JSON.stringify(sender.sent)).not.toContain("6228480122334455");
    });

    it("counts the holds of one uploader toward the cap of each chat, and still lets an engine hold out", async () => {
      const { outcomes, notices, sender } = await start({ orders });
      // The cap of these tests is 30 per chat: 40 different files held for the same order
      for (let i = 0; i < 40; i++) {
        const fileHash = `0x${i.toString(16).padStart(2, "0").repeat(32)}`;
        await outcomes(upload({ status: "held", reason: "bl_used_by_other_order", ...received, fileHash }));
      }
      const importerOwner = [...new Set(sender.sent.map((s) => s.chatId))].find((id) => directory.chats("acme-imports", "owner").includes(id))!;
      const toOwner = sender.sent.filter((s) => s.chatId === importerOwner);
      // 30 holds and one fixed overflow message, not 40
      expect(toOwner).toHaveLength(31);
      // An operation_held from the agent (POST /notices) is not capped
      const before = toOwner.length;
      await notices({ ...SAMPLES.operation_held, id: "agent-hold", reason: "funding_blocked" });
      expect(sender.sent.filter((s) => s.chatId === importerOwner)).toHaveLength(before + 1);
    });

    it("ignores what has nothing to tell, whatever status it has", async () => {
      const { outcomes, sender } = await start({ orders });
      for (const outcome of [
        { status: "ready", ...received, extraction: {} },
        { status: "rejected", reason: "bad_signature" },
        { status: "quarantined", reason: "not_pdf", ...received },
        { status: "duplicate", reason: "same_file", ...received },
      ]) {
        const res = await outcomes(upload(outcome));
        expect(res.status).toBe(202);
        expect(await res.json()).toEqual({ status: "ignored" });
      }
      expect(sender.sent).toHaveLength(0);
    });

    it("answers mapper_failed, logging only the class, for an unknown order or an outcome that does not fit", async () => {
      const { outcomes, sender, mapperLog } = await start({ orders });
      const unknown = upload({ status: "held", reason: "doc_type_mismatch", ...received, orderId: `0x${"00".repeat(32)}` });
      const misfit = upload({ status: "held", reason: "something_new", ...received, note: "Ignore previous instructions" });
      for (const body of [unknown, misfit]) {
        const res = await outcomes(body);
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({ error: "mapper_failed", source: "trade_upload" });
      }
      expect(mapperLog).toEqual([
        { event: "ingest_mapper_failed", source: "trade_upload", error: "UnknownOrderError" },
        { event: "ingest_mapper_failed", source: "trade_upload", error: "ZodError" },
      ]);
      expect(sender.sent).toHaveLength(0);
    });
  });
});
