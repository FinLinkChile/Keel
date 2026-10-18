// The bot handlers with fakes only: an in-memory store, a recording sender, fixed secrets, a fake
// SQS client and a primed deployment cache. Nothing reaches AWS or Telegram.
import type { SSMClient } from "@aws-sdk/client-ssm";
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2, SQSEvent } from "aws-lambda";
import { MemoryKeyValueStore, RecipientsAdmin, RetryableSendError, type Message } from "@keel/bot";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { deployment, resetDeploymentCache } from "../config";
import { setSqs } from "../notices";
import { setBotRuntime } from "../bot/runtime";
import { handler as botAdmin } from "./botAdmin";
import { notifyBatch } from "./botNotify";
import { handler as noticesIn } from "./noticesIn";

const NOW = Date.UTC(2026, 9, 14, 12);
const INBOUND = "i".repeat(40);
const ADMIN = "a".repeat(40);
const SECRETS: Record<string, string> = { bot_inbound_token: INBOUND, bot_admin_token: ADMIN, telegram_bot_token: "1:x" };

const DIRECTORY = {
  accounts: {
    "acme-imports": { kind: "company", name: "Acme Imports", roles: { owner: [111], operator: [222] } },
    lingnan: { kind: "company", name: "Lingnan Hydrocolloids", roles: { owner: [444] } },
  },
};

const funded = (id: string) => ({
  id,
  mode: "trade",
  kind: "order_funded",
  occurredAt: NOW / 1000,
  orderRef: "po-0142",
  orderLabel: "PO-0142",
  parties: { importer: "acme-imports", exporter: "lingnan" },
  amountMinor: 4_800_000,
  currency: "USD",
});

let kv: MemoryKeyValueStore;
let sent: { chatId: number; message: Message }[];
let failOnce: Set<number>;
let queued: string[];

beforeAll(async () => {
  // api() reads the deployment once per container; prime it with a fake SSM
  const prefix = "/keel/84532/";
  const ssm = {
    send: async () => ({
      Parameters: [
        { Name: `${prefix}chain-id`, Value: "84532" },
        { Name: `${prefix}escrow`, Value: `0x${"11".repeat(20)}` },
        { Name: `${prefix}safe`, Value: `0x${"22".repeat(20)}` },
      ],
    }),
  } as unknown as SSMClient;
  await deployment({ KEEL_CHAIN_ID: "84532" }, ssm);
  process.env.NOTICES_QUEUE_URL = "https://sqs.test/notices";
});

afterAll(() => {
  resetDeploymentCache();
  setBotRuntime(undefined);
  setSqs(undefined);
});

beforeEach(async () => {
  kv = new MemoryKeyValueStore(() => NOW);
  sent = [];
  failOnce = new Set();
  queued = [];
  await new RecipientsAdmin(kv, () => NOW).apply(DIRECTORY, "test");
  setBotRuntime({
    kv: () => kv,
    now: () => NOW,
    secret: async (name) => SECRETS[name]!,
    sender: async () => ({
      async send(chatId, message) {
        if (failOnce.delete(chatId)) throw new RetryableSendError("telegram");
        sent.push({ chatId, message });
      },
    }),
  });
  setSqs({ send: async (cmd: { input: { MessageBody?: string } }) => void queued.push(cmd.input.MessageBody!) } as never);
});

const sqsEvent = (...bodies: object[]): SQSEvent =>
  ({ Records: bodies.map((b, i) => ({ messageId: `m-${i}`, body: typeof b === "string" ? b : JSON.stringify(b) })) }) as SQSEvent;

function http(routeKey: string, body: unknown, headers: Record<string, string> = {}): APIGatewayProxyEventV2 {
  const [method, path] = routeKey.split(" ") as [string, string];
  return {
    routeKey,
    rawPath: path,
    headers,
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    isBase64Encoded: false,
    requestContext: { http: { method } },
  } as unknown as APIGatewayProxyEventV2;
}

const call = async (h: (e: APIGatewayProxyEventV2) => Promise<unknown>, e: APIGatewayProxyEventV2) => {
  const r = (await h(e)) as APIGatewayProxyStructuredResultV2;
  return { status: r.statusCode, body: JSON.parse(String(r.body)) };
};

describe("botNotify", () => {
  it("delivers a queued notice to the right chats once and drops the duplicate", async () => {
    const env = { BOT_TABLE: "bot" };
    expect(await notifyBatch(sqsEvent({ kind: "notices", notices: [funded("n-1")] }), env)).toEqual({ batchItemFailures: [] });
    expect(sent.map((s) => s.chatId)).toEqual([111, 222, 444]);
    // The same notice again, in a later invocation
    expect(await notifyBatch(sqsEvent({ kind: "notices", notices: funded("n-1") }), env)).toEqual({ batchItemFailures: [] });
    expect(sent).toHaveLength(3);
  });

  it("keeps the hourly cap across two invocations", async () => {
    const env = { BOT_TABLE: "bot", BOT_MAX_MESSAGES_PER_CHAT_PER_HOUR: "2" };
    await notifyBatch(sqsEvent({ kind: "notices", notices: [funded("a-1"), funded("a-2")] }), env);
    await notifyBatch(sqsEvent({ kind: "notices", notices: [funded("a-3")] }, { kind: "notices", notices: [funded("a-4")] }), env);
    const toOwner = sent.filter((s) => s.chatId === 111).map((s) => s.message.text);
    expect(toOwner).toHaveLength(3);
    expect(toOwner[2]).toBe("More alerts arrived this hour. See them in Keel.");
  });

  it("reports a retryable send for redelivery, and the redelivery reaches only that chat", async () => {
    failOnce.add(222);
    const event = sqsEvent({ kind: "notices", notices: [funded("r-1")] });
    expect(await notifyBatch(event, {})).toEqual({ batchItemFailures: [{ itemIdentifier: "m-0" }] });
    expect(await notifyBatch(event, {})).toEqual({ batchItemFailures: [] });
    expect(sent.map((s) => s.chatId).sort()).toEqual([111, 222, 444]);
  });

  it("drops invalid messages without asking for a retry", async () => {
    const result = await notifyBatch(
      sqsEvent("{not json" as unknown as object, { kind: "nope" }, { kind: "notices", notices: [{ ...funded("x"), kind: "wire_now" }] }),
      {},
    );
    expect(result).toEqual({ batchItemFailures: [] });
    expect(sent).toHaveLength(0);
  });

  it("logs every dropped message as queue_invalid with its id and code", async () => {
    const lines: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((l: string) => void lines.push(l));
    try {
      await notifyBatch(sqsEvent("{not json" as unknown as object, { kind: "nope" }), {});
    } finally {
      spy.mockRestore();
    }
    const invalid = lines.map((l) => JSON.parse(l)).filter((e) => e.event === "queue_invalid");
    expect(invalid).toEqual([
      expect.objectContaining({ messageId: "m-0", code: "invalid_json" }),
      expect.objectContaining({ messageId: "m-1", code: "invalid_envelope" }),
    ]);
  });
});

describe("noticesIn", () => {
  it("rejects a wrong token and queues nothing", async () => {
    const r = await call(noticesIn, http("POST /notices", funded("n-1"), { authorization: `Bearer ${"x".repeat(40)}` }));
    expect(r).toEqual({ status: 401, body: { error: "unauthorized" } });
    expect((await call(noticesIn, http("POST /notices", funded("n-1")))).status).toBe(401);
    expect(queued).toHaveLength(0);
  });

  it("queues notices and ingest outcomes as they came", async () => {
    const auth = { authorization: `Bearer ${INBOUND}` };
    expect(await call(noticesIn, http("POST /notices", funded("n-1"), auth))).toEqual({ status: 202, body: { queued: true } });
    const payload = { source: "email", outcome: { status: "ignored" } };
    expect((await call(noticesIn, http("POST /ingest/outcomes", payload, auth))).status).toBe(202);
    expect(queued.map((q) => JSON.parse(q))).toEqual([
      { kind: "notices", notices: [funded("n-1")] },
      { kind: "ingest_outcome", payload },
    ]);
    expect((await call(noticesIn, http("POST /ingest/outcomes", [payload], auth))).status).toBe(400);
    expect((await call(noticesIn, http("POST /notices", "{", auth))).body).toEqual({ error: "bad_json" });
  });
});

describe("botAdmin", () => {
  const auth = { authorization: `Bearer ${ADMIN}`, "x-admin-actor": "ops@keel" };

  it("rejects a wrong token and a missing actor", async () => {
    expect((await call(botAdmin, http("GET /bot/recipients", undefined, { authorization: `Bearer ${INBOUND}` }))).status).toBe(401);
    expect(await call(botAdmin, http("PUT /bot/recipients", DIRECTORY, { authorization: `Bearer ${ADMIN}` }))).toEqual({
      status: 400,
      body: { error: "missing_actor" },
    });
  });

  it("changes the directory, audits it and reads it back", async () => {
    const change = { accounts: { lingnan: { kind: "company", name: "Lingnan Hydrocolloids", roles: { owner: [444], operator: [555] } } } };
    expect(await call(botAdmin, http("PUT /bot/recipients", change, auth))).toEqual({
      status: 200,
      body: { changed: true, at: new Date(NOW).toISOString(), accounts: ["lingnan"], orders: [] },
    });
    const view = await call(botAdmin, http("GET /bot/recipients", undefined, auth));
    expect(view.body.accounts.lingnan.roles).toEqual({ owner: [444], operator: [555] });
    expect((await kv.query("audit#recipients", "")).map((a) => a.actor)).toEqual(["test", "ops@keel"]);
    expect(await call(botAdmin, http("PUT /bot/recipients", change, auth))).toEqual({ status: 200, body: { changed: false } });
  });

  it("refuses to delete an account that a stored order names", async () => {
    const order = { label: "PO-0142", importer: "acme-imports", exporter: "lingnan", shipmentDeadline: 1_800_000_000 };
    const id = `0x${"12".repeat(32)}`;
    expect((await call(botAdmin, http("PUT /bot/recipients", { orders: { [id]: order } }, auth))).status).toBe(200);
    const r = await call(botAdmin, http("PUT /bot/recipients", { accounts: { lingnan: null } }, auth));
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("invalid_recipients");
    expect(r.body.message).toContain("PO-0142");
  });

  it("refuses a change the rules reject", async () => {
    const bad = { accounts: { lingnan: { kind: "personal", name: "Lingnan", roles: { operator: [555] } } } };
    const r = await call(botAdmin, http("PUT /bot/recipients", bad, auth));
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("invalid_recipients");
  });
});
