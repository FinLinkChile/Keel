import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { NotifyService } from "../../application/notify";
import { templateRenderer } from "../../presentation/templates";
import { directory, MemoryLogger, MemorySender, NOW_MS, SAMPLES } from "../../testing/fixtures";
import { createNoticeHandler, startNoticeServer } from "./http-source";

const TOKEN = "k".repeat(40);
let server: Server | undefined;

afterEach(() => server?.close());

async function start() {
  const sender = new MemorySender();
  const service = new NotifyService(
    { directory, renderer: templateRenderer, sender, clock: { now: () => NOW_MS }, logger: new MemoryLogger() },
    { maxMessagesPerChatPerHour: 30 },
  );
  server = await startNoticeServer(createNoticeHandler(TOKEN, service), "127.0.0.1", 0);
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/notices`;
  const post = (body: unknown, token: string | null = TOKEN) =>
    fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  return { post, sender, service };
}

describe("POST /notices", () => {
  it("answers 401 without a valid token and sends nothing", async () => {
    const { post, sender } = await start();
    expect((await post(SAMPLES.balance_released, null)).status).toBe(401);
    expect((await post(SAMPLES.balance_released, "x".repeat(40))).status).toBe(401);
    expect(sender.sent).toHaveLength(0);
  });

  it("accepts a valid notice or batch with 202 and sends it", async () => {
    const { post, sender } = await start();
    const res = await post([SAMPLES.balance_released, SAMPLES.balance_released]);
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ results: ["accepted", "duplicate"] });
    expect(sender.sent).toHaveLength(4);
  });

  it("answers 400 to an invalid notice and sends none of the batch", async () => {
    const { post, sender, service } = await start();
    const res = await post([SAMPLES.balance_released, { ...SAMPLES.refunded, name: "Pay me" }]);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_notice", index: 1 });
    expect(sender.sent).toHaveLength(0);
    expect(service.stats().rejected).toBe(1);
    expect((await post("{not json")).status).toBe(400);
  });

  it("refuses a body over 64 KB", async () => {
    const { post } = await start();
    expect((await post(JSON.stringify({ pad: "x".repeat(70_000) }))).status).toBe(413);
  });

  it("does not start with a short token", () => {
    expect(() => createNoticeHandler("short", { notify: async () => ({ status: "rejected" }) })).toThrow(/32/);
  });
});
