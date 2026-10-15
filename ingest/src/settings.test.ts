import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { initialSettings, keysFromEnv, SettingsError, SettingsStore, type SettingsAudit } from "./settings";

const fallback = { provider: "anthropic" as const, model: "claude-opus-5-5", requireDmarc: true };
const keys = { anthropic: "ka", "openai-compatible": "kc" };

const open = async (file?: string, audit: SettingsAudit[] = []) =>
  SettingsStore.open({ fallback, keys, file, audit: (e) => audit.push(e) });

describe("initial settings", () => {
  it("require DMARC unless explicitly relaxed", () => {
    expect(initialSettings({}).requireDmarc).toBe(true);
    expect(initialSettings({ INGEST_REQUIRE_DMARC: "no" }).requireDmarc).toBe(true);
    expect(initialSettings({ INGEST_REQUIRE_DMARC: "false" }).requireDmarc).toBe(false);
  });

  it("read one key per provider, with LLM_API_KEY for the initial one", () => {
    expect(keysFromEnv({ LLM_API_KEY: "a", OPENAI_API_KEY: "o" })).toEqual({ anthropic: "a", openai: "o" });
    expect(keysFromEnv({ LLM_PROVIDER: "gemini", LLM_API_KEY: "g" })).toEqual({ gemini: "g" });
  });
});

describe("SettingsStore", () => {
  it("switches to a configured provider and audits every changed field", async () => {
    const audit: SettingsAudit[] = [];
    const store = await open(undefined, audit);
    await store.update(
      { provider: "openai-compatible", model: "qwen-plus", baseURL: "https://qwen.example/v1", requireDmarc: false },
      "dani",
    );
    expect(store.get()).toMatchObject({
      settings: { provider: "openai-compatible", model: "qwen-plus", requireDmarc: false },
      updatedBy: "dani",
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]!.changes).toEqual({
      provider: { from: "anthropic", to: "openai-compatible" },
      model: { from: "claude-opus-5-5", to: "qwen-plus" },
      baseURL: { from: undefined, to: "https://qwen.example/v1" },
      requireDmarc: { from: true, to: false },
    });
    expect((await store.getExtractor()).provider).toBe("openai-compatible");
  });

  it("refuses a provider with no API key, and never accepts a key over the API", async () => {
    const store = await open();
    await expect(store.update({ provider: "gemini", model: "x" }, "dani")).rejects.toThrow(/GEMINI_API_KEY/);
    await expect(store.update({ apiKey: "sk-attacker" }, "dani")).rejects.toThrow(SettingsError);
    expect(store.get().settings.provider).toBe("anthropic");
  });

  it("applies the TLS rule to the base URL", async () => {
    const store = await open();
    await expect(
      store.update({ provider: "openai-compatible", model: "q", baseURL: "http://qwen.example/v1" }, "dani"),
    ).rejects.toThrow(/https/);
  });

  it("drops the base URL when leaving openai-compatible", async () => {
    const store = await open();
    await store.update({ provider: "openai-compatible", model: "q", baseURL: "https://qwen.example/v1" }, "dani");
    await store.update({ provider: "anthropic", model: "claude-opus-5-5" }, "dani");
    expect(store.get().settings.baseURL).toBeUndefined();
  });

  it("keeps the proxy of Claude when another setting changes", async () => {
    const store = await open();
    await store.update({ baseURL: "https://proxy.example" }, "dani");
    await store.update({ requireDmarc: false }, "dani");
    expect(store.get().settings).toMatchObject({ provider: "anthropic", baseURL: "https://proxy.example" });
  });

  it("does not audit a change that changes nothing", async () => {
    const audit: SettingsAudit[] = [];
    const store = await open(undefined, audit);
    await store.update({ requireDmarc: true }, "dani");
    expect(audit).toHaveLength(0);
  });

  it("persists to a private file and reloads it", async () => {
    const file = join(await mkdtemp(join(tmpdir(), "keel-settings-")), "settings.json");
    const store = await open(file);
    await store.update({ requireDmarc: false }, "dani");
    expect(JSON.parse(await readFile(file, "utf8")).settings.requireDmarc).toBe(false);
    expect((await stat(file)).mode & 0o077).toBe(0);
    expect((await open(file)).get()).toMatchObject({ settings: { requireDmarc: false }, updatedBy: "dani" });
  });
});
