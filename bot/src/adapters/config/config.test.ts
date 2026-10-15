import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "./env";
import { parseOrders } from "./orders-file";
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

describe("parseOrders", () => {
  const ID = `0x${"0".repeat(60)}0142`;
  const accounts = new Set(["acme-imports", "lingnan", "hk-arbitration"]);
  const exists = (a: string) => accounts.has(a);
  const order = (o: object = {}) => ({
    orders: { [ID]: { label: "PO-0142", importer: "acme-imports", exporter: "lingnan", shipmentDeadline: 1795132800, ...o } },
  });

  it("loads orders by bytes32 id, case insensitive", () => {
    const book = parseOrders(order({ arbiter: "hk-arbitration" }), exists);
    expect(book.get(ID.toUpperCase().replace("0X", "0x"))).toEqual({
      orderRef: ID,
      label: "PO-0142",
      parties: { importer: "acme-imports", exporter: "lingnan", arbiter: "hk-arbitration" },
      shipmentDeadline: 1795132800,
    });
  });

  it("fails on an invalid label", () => {
    for (const label of ["PO-912345678", "po-0142", "CALL56912345678"]) {
      expect(() => parseOrders(order({ label }), exists)).toThrow(/does not validate/);
    }
  });

  it("fails on an account outside the directory or repeated in an order", () => {
    expect(() => parseOrders(order({ exporter: "someone" }), exists)).toThrow(/someone is not in BOT_RECIPIENTS_FILE/);
    expect(() => parseOrders(order({ exporter: "acme-imports" }), exists)).toThrow(/different account/);
  });

  it("fails on a key that is not a bytes32 or an extra field", () => {
    expect(() => parseOrders({ orders: { "PO-0142": order().orders[ID] } }, exists)).toThrow(ConfigError);
    expect(() => parseOrders(order({ payoutAddress: "0xabc" }), exists)).toThrow(ConfigError);
  });
});

describe("loadConfig, ingest", () => {
  const INGEST = "i".repeat(32);
  it("reads the ingest token, the personal account and the orders file", () => {
    const c = loadConfig({ ...base, BOT_INGEST_TOKEN: INGEST, BOT_PERSONAL_ACCOUNT_ID: "ana", BOT_ORDERS_FILE: "examples/orders.json" });
    expect(c).toMatchObject({ ingestToken: INGEST, personalAccountId: "ana", ordersFile: "examples/orders.json" });
  });

  it("requires distinct tokens", () => {
    expect(() => loadConfig({ ...base, BOT_INGEST_TOKEN: INGEST, BOT_INBOUND_TOKEN: INGEST })).toThrow(/BOT_INBOUND_TOKEN/);
    expect(() => loadConfig({ ...base, BOT_INGEST_TOKEN: INGEST, INGEST_WEBHOOK_TOKEN: INGEST })).toThrow(/INGEST_WEBHOOK_TOKEN/);
    expect(() => loadConfig({ ...base, BOT_INGEST_TOKEN: "short" })).toThrow(/BOT_INGEST_TOKEN/);
    expect(() => loadConfig({ ...base, BOT_PERSONAL_ACCOUNT_ID: "Not An Id" })).toThrow(/BOT_PERSONAL_ACCOUNT_ID/);
  });
});
