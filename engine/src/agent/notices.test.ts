import type { Hex, OrderTerms, PurchaseOrder } from "@keel/schemas";
import { describe, expect, it } from "vitest";
import type { AgentEvent } from "./agent";
import type { OrderRecord } from "./escrow";
import { type BotNotice, botNotifier, toNotices } from "./notices";
import type { AgentStore, Registry, StoredOrder } from "./store";

const address = (n: number): Hex => `0x${n.toString(16).padStart(40, "0")}`;
const ORDER_ID: Hex = `0x${"31".padStart(64, "0")}`;
const IMPORTER = address(0x5afe);
const EXPORTER = address(0xe1);
const ARBITER = address(0xa4b1);
const DEADLINE = 1_795_132_800n;
const AT = 1_794_900_000;

const po = { orderId: ORDER_ID, importer: IMPORTER, exporter: EXPORTER, arbiter: ARBITER, advanceBps: 3000, shipmentDeadline: DEADLINE } as PurchaseOrder;
const record = (state: OrderRecord["state"]): OrderRecord => ({ po, state, orderHash: "0x", attestationHash: "0x", shippedAt: 0n });
const terms = { currency: "USD", invoiceAmountMinor: 4_800_000n } as OrderTerms;

const memoryStore = (over: { label?: string; parties?: Registry["parties"] } = {}): AgentStore => ({
  orderIds: () => [ORDER_ID],
  order: () => ({ order: po, terms, ...("label" in over ? over.label && { label: over.label } : { label: "PO-0131" }) }) as StoredOrder,
  shipment: () => ({ attestation: { onBoardDate: 1_794_000_000n } as never, sigCarrier: "0x" }),
  documents: () => null,
  registry: () => ({
    parties: over.parties ?? [
      { address: IMPORTER, account: "acme-imports" },
      { address: EXPORTER, account: "lingnan" },
      { address: ARBITER, account: "hk-arbitration" },
    ],
    knownSuppliers: [],
    history: {},
  }),
});

const parties = { importer: "acme-imports", exporter: "lingnan", arbiter: "hk-arbitration" };
const header = (suffix: string) => ({ id: `${ORDER_ID}:${suffix}`, occurredAt: AT, mode: "trade", orderRef: ORDER_ID, orderLabel: "PO-0131", parties });
const event = (over: Partial<AgentEvent>): AgentEvent => ({ orderId: ORDER_ID, state: "OPEN", outcome: "held", reason: "SENT", ...over });
const notices = (e: AgentEvent, state = e.state, store = memoryStore()) => toNotices(e, record(state), store, AT);

describe("agent notices for the bot (T2.6)", () => {
  it("a deposit becomes order_funded and advance_released, split like the escrow", () => {
    expect(notices(event({ outcome: "sent", status: "success", action: "fund" }))).toEqual([
      { ...header("order_funded"), kind: "order_funded", amountMinor: 4_800_000, currency: "USD" },
      { ...header("advance_released"), kind: "advance_released", amountMinor: 1_440_000, currency: "USD" },
    ]);
  });

  it("each later step names the amount that moved", () => {
    const sent = (action: AgentEvent["action"], state: AgentEvent["state"]) => notices(event({ outcome: "sent", status: "success", action, state })) as BotNotice[];
    expect(sent("submitShipment", "ADVANCE_PAID")).toEqual([{ ...header("shipment_accepted"), kind: "shipment_accepted", onBoardDate: 1_794_000_000 }]);
    expect(sent("releaseBalance", "SHIPPED")).toEqual([{ ...header("balance_released"), kind: "balance_released", amountMinor: 3_360_000, currency: "USD" }]);
    expect(sent("refundAfterDeadline", "ADVANCE_PAID")).toEqual([{ ...header("refunded"), kind: "refunded", amountMinor: 3_360_000, currency: "USD" }]);
  });

  it("a hold carries the reason, the amount and, before shipment, the deadline (D8)", () => {
    expect(notices(event({ hold: "cambio_en_cola", reason: "SUPPLIER_NEW" }))).toEqual([
      { ...header("held:1:new_supplier_wait"), kind: "operation_held", reason: "new_supplier_wait", amountMinor: 4_800_000, currency: "USD", deadline: Number(DEADLINE) },
    ]);
    expect(notices(event({ state: "SHIPPED", hold: "retenida", reason: "DOCUMENTS_DO_NOT_CONFORM", rules: [] }))).toEqual([
      { ...header("held:3:documents_mismatch"), kind: "operation_held", reason: "documents_mismatch", amountMinor: 4_800_000, currency: "USD" },
    ]);
  });

  it("maps every hold the agent can raise", () => {
    const reasonOf = (reason: AgentEvent["reason"], rules?: AgentEvent["rules"]) => ((notices(event({ reason, rules })) as BotNotice[])[0] as { reason: string }).reason;
    expect(reasonOf("COSIGNATURE_NEEDED")).toBe("over_limit_cosign");
    expect(reasonOf("FUNDING_BLOCKED")).toBe("funding_blocked");
    expect(reasonOf("SIMULATION_REVERTED")).toBe("simulation_failed");
    expect(reasonOf("ATTESTATION_UNKNOWN")).toBe("agent_data_incomplete");
    expect(reasonOf("IMPORTER_NOT_REGISTERED")).toBe("agent_data_incomplete");
    expect(reasonOf("ON_BOARD_BEFORE_FUNDING")).toBe("agent_data_incomplete");
    expect(reasonOf("SHIPMENT_CUTOFF")).toBe("simulation_failed");
    expect(reasonOf("DOCUMENTS_DO_NOT_CONFORM", [{ rule: "hidden-text", ok: false, reason: "HIDDEN_TEXT" }])).toBe("hidden_text");
    expect(reasonOf("DOCUMENTS_DO_NOT_CONFORM", [{ rule: "account-change", ok: false, reason: "ACCOUNT_CHANGE_MENTIONED" }])).toBe("account_change_mention");
  });

  it("one deadline reminder per threshold, with the days left", () => {
    expect(notices(event({ state: "ADVANCE_PAID", outcome: "notice", reason: "DEADLINE_SOON", daysLeft: 2, reminder: 3 }))).toEqual([
      { ...header("deadline:3"), kind: "deadline_approaching", deadline: Number(DEADLINE), daysLeft: 2 },
    ]);
  });

  it("sends nothing for waiting, failed or reverted steps", () => {
    expect(notices(event({ outcome: "waiting", reason: "GATE_NOT_DEPLOYED" }))).toBe("NOTHING_TO_NOTIFY");
    expect(notices(event({ outcome: "failed", reason: "AGENT_ERROR" }))).toBe("NOTHING_TO_NOTIFY");
    expect(notices(event({ outcome: "sent", status: "reverted", action: "fund" }))).toBe("NOTHING_TO_NOTIFY");
  });

  it("never names an address: without a label or an account there is no notice", () => {
    expect(notices(event({ reason: "SUPPLIER_NEW" }), "OPEN", memoryStore({ label: undefined }))).toBe("LABEL_MISSING");
    expect(notices(event({ reason: "SUPPLIER_NEW" }), "OPEN", memoryStore({ label: "PO20260042" }))).toBe("LABEL_MISSING");
    expect(notices(event({ reason: "SUPPLIER_NEW" }), "OPEN", memoryStore({ parties: [{ address: IMPORTER, account: "acme-imports" }] }))).toBe("ACCOUNT_MISSING");
    expect(toNotices(event({ reason: "SUPPLIER_NEW" }), undefined, memoryStore(), AT)).toBe("ORDER_UNKNOWN");
  });

  it("the arbiter is left out when it has no account of its own", () => {
    const store = memoryStore({ parties: [{ address: IMPORTER, account: "acme-imports" }, { address: EXPORTER, account: "lingnan" }] });
    const [held] = notices(event({ reason: "SUPPLIER_NEW" }), "OPEN", store) as BotNotice[];
    expect(held!.parties).toEqual({ importer: "acme-imports", exporter: "lingnan" });
  });
});

describe("posting to the bot", () => {
  const endpoint = { url: "http://127.0.0.1:8789", token: "t".repeat(32) };
  const held = event({ hold: "cambio_en_cola", reason: "SUPPLIER_NEW" });

  it("posts the notices with the bearer token and logs the event", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const lines: Record<string, unknown>[] = [];
    const notify = botNotifier({
      store: memoryStore(),
      endpoint,
      now: () => AT,
      log: (l) => lines.push(l),
      fetch: (async (url: URL, init: RequestInit) => {
        calls.push({ url: String(url), init });
        return new Response(null, { status: 202 });
      }) as typeof fetch,
    });
    await notify(held, record("OPEN"));
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("http://127.0.0.1:8789/notices");
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe(`Bearer ${endpoint.token}`);
    expect(JSON.parse(calls[0]!.init.body as string)[0]).toMatchObject({ kind: "operation_held", reason: "new_supplier_wait" });
    expect(lines).toEqual([held]);
  });

  it("a bot that is down or refuses is only logged, never thrown, and the token is not logged", async () => {
    const lines: Record<string, unknown>[] = [];
    const down = botNotifier({ store: memoryStore(), endpoint, log: (l) => lines.push(l), fetch: (async () => Promise.reject(new TypeError("fetch failed"))) as typeof fetch });
    await expect(down(held, record("OPEN"))).resolves.toBeUndefined();
    const refuses = botNotifier({ store: memoryStore(), endpoint, log: (l) => lines.push(l), fetch: (async () => new Response(null, { status: 400 })) as typeof fetch });
    await refuses(held, record("OPEN"));
    expect(lines.filter((l) => l.bot)).toEqual([
      { bot: "unreachable", orderId: ORDER_ID, error: "TypeError" },
      { bot: "rejected", orderId: ORDER_ID, status: 400, ids: [`${ORDER_ID}:held:1:new_supplier_wait`] },
    ]);
    expect(JSON.stringify(lines)).not.toContain(endpoint.token);
  });

  it("without the bot configured it only logs", async () => {
    const lines: Record<string, unknown>[] = [];
    const notify = botNotifier({ store: memoryStore(), log: (l) => lines.push(l), fetch: (() => expect.unreachable()) as never });
    await notify(held, record("OPEN"));
    expect(lines).toEqual([held]);
  });
});
