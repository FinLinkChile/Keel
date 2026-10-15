import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "./env";
import { parseDirectory } from "./recipients-file";

const TOKEN = "t".repeat(32);
const base = { BOT_RECIPIENTS_FILE: "recipients.json", TELEGRAM_ALLOWED_CHAT_IDS: "111, -100222" };

describe("loadConfig", () => {
  it("applies defaults and parses negative group ids", () => {
    const c = loadConfig({ ...base, TELEGRAM_BOT_TOKEN: "" });
    expect(c).toMatchObject({ sender: "console", host: "127.0.0.1", port: 8789, maxMessagesPerChatPerHour: 30 });
    expect([...c.allowedChatIds]).toEqual([111, -100222]);
    expect(c.inboundToken).toBeUndefined();
  });

  it("fails without a required variable", () => {
    expect(() => loadConfig({ TELEGRAM_ALLOWED_CHAT_IDS: "1" })).toThrow(/BOT_RECIPIENTS_FILE/);
    expect(() => loadConfig({ BOT_RECIPIENTS_FILE: "r.json" })).toThrow(/TELEGRAM_ALLOWED_CHAT_IDS/);
    expect(() => loadConfig({ ...base, BOT_SENDER: "telegram" })).toThrow(/TELEGRAM_BOT_TOKEN/);
  });

  it("rejects a short inbound token or one equal to the ingest token", () => {
    expect(() => loadConfig({ ...base, BOT_INBOUND_TOKEN: "short" })).toThrow(ConfigError);
    expect(() => loadConfig({ ...base, BOT_INBOUND_TOKEN: TOKEN, INGEST_WEBHOOK_TOKEN: TOKEN })).toThrow(/differ/);
    expect(loadConfig({ ...base, BOT_INBOUND_TOKEN: TOKEN }).inboundToken).toBe(TOKEN);
  });

  it("never puts a value in the error", () => {
    expect(() => loadConfig({ ...base, BOT_INBOUND_TOKEN: "secret-but-short" })).toThrow(/^invalid or missing: BOT_INBOUND_TOKEN$/);
  });

  it("trims the trailing slash of the app URL and rejects other schemes", () => {
    expect(loadConfig({ ...base, APP_BASE_URL: "https://keel.example/" }).appBaseUrl).toBe("https://keel.example");
    expect(() => loadConfig({ ...base, APP_BASE_URL: "javascript:alert(1)" })).toThrow(/APP_BASE_URL/);
  });
});

describe("parseDirectory", () => {
  const allowed = new Set([111, 222, 333]);
  const file = (accounts: object) => ({ accounts });

  it("loads names and chats per role", () => {
    const d = parseDirectory(
      file({ acme: { kind: "company", name: "Acme Imports", roles: { owner: [111], operator: [222] } } }),
      allowed,
    );
    expect(d.name("acme")).toBe("Acme Imports");
    expect(d.chats("acme", "operator")).toEqual([222]);
    expect(d.chats("acme", "cosigner")).toEqual([]);
    expect(d.describe(111)).toBe("Acme Imports (owner)");
  });

  it("fails if a chat is not in the allowlist", () => {
    expect(() => parseDirectory(file({ acme: { kind: "company", name: "Acme", roles: { owner: [999] } } }), allowed)).toThrow(
      /999 is not in TELEGRAM_ALLOWED_CHAT_IDS/,
    );
  });

  it("fails if a personal account has an operator", () => {
    expect(() => parseDirectory(file({ ana: { kind: "personal", name: "Ana", roles: { operator: [111] } } }), allowed)).toThrow(
      /personal account has no operator/,
    );
  });

  it("fails on a file that does not validate", () => {
    expect(() => parseDirectory(file({ "Bad Id": { kind: "company", name: "X", roles: {} } }), allowed)).toThrow(ConfigError);
    expect(() =>
      parseDirectory(file({ acme: { kind: "company", name: "Pay to https://evil.example", roles: {} } }), allowed),
    ).toThrow(ConfigError);
  });
});
