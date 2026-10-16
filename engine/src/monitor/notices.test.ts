import type { Hex } from "@keel/schemas";
import { describe, expect, it } from "vitest";
// The bot's own schema (Area 4): the monitor's notices must pass it, or the bot drops them
import { Notice } from "../../../bot/src/domain/notice";
import type { AgentStore } from "../agent/store";
import type { MonitorEvent } from "./monitor";
import { monitorNotifier, toMonitorNotices } from "./notices";

const GATE: Hex = "0x0000000000000000000000000000000000006a7e";
const SAFE: Hex = "0x0000000000000000000000000000000000005afe";
const TX: Hex = `0x${"ab".repeat(32)}`;
const PAUSE_TX: Hex = `0x${"cd".repeat(32)}`;
const AT = 1_762_000_000;

const event = (over: Partial<MonitorEvent>): MonitorEvent => ({ kind: "change", reason: "GATE_PAUSED", txHash: TX, blockNumber: 7n, ...over });
const store = (account?: string): AgentStore =>
  ({ registry: () => ({ parties: [{ address: SAFE, ...(account && { account }) }], history: {} }) }) as unknown as AgentStore;

describe("monitor notices for the bot (T2.8)", () => {
  it("queued suppliers and third parties are change_queued notices the bot accepts", () => {
    const supplier = toMonitorNotices(event({ reason: "SUPPLIER_QUEUED", changeId: 5n, activatesAt: 1_762_000_120n }), "acme-imports", GATE, AT);
    const party = toMonitorNotices(event({ reason: "THIRD_PARTY_QUEUED", changeId: 6n, activatesAt: 1_762_000_120n }), "acme-imports", GATE, AT);
    expect(supplier).toEqual([
      { id: `change:${GATE}:5`, occurredAt: AT, mode: "trade", accountId: "acme-imports", kind: "change_queued", changeKind: "supplier_added", effectiveAt: 1_762_000_120 },
    ]);
    expect(party[0]).toMatchObject({ changeKind: "role_change" });
    for (const n of [...supplier, ...party]) expect(Notice.safeParse(n).success).toBe(true);
  });

  it("a pause is one gate_paused notice, whether the monitor paused or the log shows it later", () => {
    const fromIncident = toMonitorNotices(event({ kind: "incident", reason: "UNKNOWN_FUNDING_PDR", action: "paused", pauseTx: PAUSE_TX }), "acme-imports", GATE, AT);
    const fromLog = toMonitorNotices(event({ reason: "GATE_PAUSED", txHash: PAUSE_TX }), "acme-imports", GATE, AT);
    const pausedIds = [...fromIncident, ...fromLog].filter((n) => n.kind === "gate_paused").map((n) => n.id);
    expect(new Set(pausedIds).size).toBe(1);
    expect(Notice.safeParse(fromLog[0]).success).toBe(true);
  });

  it("an incident names the transaction; its notice kind is a proposal the bot does not accept yet", () => {
    const [alert] = toMonitorNotices(event({ kind: "incident", reason: "UNKNOWN_DOCUMENT_DECISION", action: "alerted" }), "acme-imports", GATE, AT);
    expect(alert).toEqual({ id: `${TX}:unauthorized`, occurredAt: AT, mode: "trade", accountId: "acme-imports", kind: "unauthorized_execution", txHash: TX });
    // [PROPUESTA] to Area 4: when the bot adds the kind, flip this expectation
    expect(Notice.safeParse(alert).success).toBe(false);
  });

  it("changes no bot notice fits are only logged", () => {
    for (const reason of ["POLICY_SIGNER_SET", "POLICY_HASH_SET", "COSIGNER_SET", "CHANGE_VETOED", "GATE_UNPAUSED"] as const) {
      expect(toMonitorNotices(event({ reason }), "acme-imports", GATE, AT)).toEqual([]);
    }
  });

  it("posts one notice per request, logs bigints as text and never throws", async () => {
    const bodies: unknown[] = [];
    const lines: Record<string, unknown>[] = [];
    const notify = monitorNotifier({
      store: store("acme-imports"),
      safe: SAFE,
      gate: GATE,
      endpoint: { url: "http://127.0.0.1:8789", token: "t".repeat(32) },
      now: () => AT,
      log: (l) => lines.push(l),
      fetch: (async (_: URL, init: RequestInit) => {
        bodies.push(JSON.parse(init.body as string));
        return new Response(null, { status: bodies.length === 1 ? 400 : 202 });
      }) as typeof fetch,
    });
    await notify(event({ kind: "incident", reason: "UNKNOWN_FUNDING_PDR", action: "paused", pauseTx: PAUSE_TX }));
    expect(bodies).toHaveLength(2);
    expect(lines[0]).toMatchObject({ monitor: { blockNumber: "7", reason: "UNKNOWN_FUNDING_PDR" } });
    expect(lines).toContainEqual({ bot: "rejected", status: 400, id: `${TX}:unauthorized` });

    const down = monitorNotifier({ store: store("acme-imports"), safe: SAFE, gate: GATE, endpoint: { url: "http://127.0.0.1:8789", token: "t".repeat(32) }, log: () => {}, fetch: (() => Promise.reject(new TypeError("down"))) as typeof fetch });
    await expect(down(event({}))).resolves.toBeUndefined();
  });

  it("without the importer's bot account nothing is posted", async () => {
    const lines: Record<string, unknown>[] = [];
    const notify = monitorNotifier({ store: store(), safe: SAFE, gate: GATE, endpoint: { url: "http://127.0.0.1:8789", token: "t".repeat(32) }, log: (l) => lines.push(l), fetch: (() => expect.unreachable()) as never });
    await notify(event({}));
    expect(lines).toContainEqual({ bot: "skipped", reason: "ACCOUNT_MISSING", txHash: TX });
  });
});
