import { describe, expect, it } from "vitest";
import { BotConfigError, botNotifierFromEnv, createBotNotifier, scheduleChangeDigest, type BotLogEntry, type BotPayload } from "./botNotifier";
import type { StoredChangeRequest } from "./store";

const TOKEN = "b".repeat(40);
const payload: BotPayload = { source: "change_digest", since: "2026-10-15T00:00:00.000Z", requests: [] };

describe("createBotNotifier", () => {
  it("posts ingest's output to /ingest/outcomes with the bearer token", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const bot = createBotNotifier({
      url: "https://bot.example",
      token: TOKEN,
      log: () => {},
      fetch: async (url, init) => (calls.push({ url: String(url), init: init! }), new Response(null, { status: 202 })),
    });
    bot.send(payload);
    await bot.idle();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://bot.example/ingest/outcomes");
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual(payload);
  });

  it("returns at once and only logs when the bot fails, is slow or answers an error", async () => {
    const logs: BotLogEntry[] = [];
    const failing = [
      async () => {
        throw new TypeError("fetch failed");
      },
      async () => new Response(null, { status: 500 }),
      (_: unknown, init?: RequestInit) =>
        new Promise<Response>((_r, reject) => init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason))),
    ];
    for (const fetch of failing) {
      const bot = createBotNotifier({ url: "https://bot.example", token: TOKEN, log: (e) => logs.push(e), fetch: fetch as typeof globalThis.fetch, timeoutMs: 20 });
      expect(() => bot.send(payload)).not.toThrow();
      await bot.idle();
    }
    expect(logs.map((l) => l.error)).toEqual(["TypeError", "http_500", "TimeoutError"]);
    expect(JSON.stringify(logs)).not.toContain(TOKEN);
  });

  it("refuses a plain http URL off this machine and a short token", () => {
    expect(() => createBotNotifier({ url: "http://bot.example", token: TOKEN, log: () => {} })).toThrow(BotConfigError);
    expect(() => createBotNotifier({ url: "http://127.0.0.1:8789", token: TOKEN, log: () => {} })).not.toThrow();
    expect(() => createBotNotifier({ url: "https://bot.example", token: "short", log: () => {} })).toThrow(/32/);
  });
});

describe("botNotifierFromEnv", () => {
  it("is off without BOT_URL and refuses reusing an ingest token", () => {
    expect(botNotifierFromEnv({}, () => {})).toBeUndefined();
    expect(() => botNotifierFromEnv({ BOT_URL: "https://bot.example", BOT_INGEST_TOKEN: TOKEN, INGEST_WEBHOOK_TOKEN: TOKEN }, () => {})).toThrow(
      /differ/,
    );
  });
});

describe("scheduleChangeDigest", () => {
  it("sends one summary per interval, only when there are new requests", async () => {
    const sent: BotPayload[] = [];
    const bot = { send: (p: BotPayload) => sent.push(p), idle: async () => {} };
    let clock = Date.parse("2026-10-15T00:00:00Z");
    const pending: StoredChangeRequest[] = [];
    const schedule = scheduleChangeDigest(bot, () => pending.splice(0), 24, () => new Date(clock));
    await schedule.tick();
    expect(sent).toEqual([]);
    pending.push({ id: 1, aliasId: "LUZ", status: "pending" } as StoredChangeRequest);
    clock += 24 * 3600 * 1000;
    await schedule.tick();
    schedule.stop();
    expect(sent).toMatchObject([{ source: "change_digest", requests: [{ id: 1 }] }]);
  });
});
