// Monitor events for the bot (T2.8, Area 4): wallet notices about the importer's account, never
// about one order's documents. Like the agent's notices, no free text: accounts, enums, hashes and
// timestamps only, and posting never blocks the monitor.
import type { Hex } from "@keel/schemas";
import { type BotEndpoint, postNotices } from "../agent/notices";
import type { AgentStore } from "../agent/store";
import type { MonitorEvent } from "./monitor";

interface WalletFields {
  id: string;
  occurredAt: number;
  mode: "trade";
  accountId: string;
}

export type MonitorNotice = WalletFields &
  (
    | { kind: "change_queued"; changeKind: "supplier_added" | "role_change"; effectiveAt: number }
    | { kind: "gate_paused" }
    // [PROPUESTA] to Area 4: the bot has no notice for an execution the engine never decided
    | { kind: "unauthorized_execution"; txHash: Hex }
  );

const same = (a: Hex, b: Hex) => a.toLowerCase() === b.toLowerCase();

// One notice per bot request: a kind the bot does not know yet must not take the others down.
export function toMonitorNotices(event: MonitorEvent, accountId: string, gate: Hex, occurredAt: number): MonitorNotice[] {
  const base = { occurredAt, mode: "trade" as const, accountId };
  // The gate's own pause and the GatePaused log of that same transaction share one id
  const paused = (tx: Hex): MonitorNotice => ({ ...base, id: `paused:${tx}`, kind: "gate_paused" });
  switch (event.reason) {
    case "UNKNOWN_FUNDING_PDR":
    case "UNKNOWN_DOCUMENT_DECISION":
      return [
        { ...base, id: `${event.txHash}:unauthorized`, kind: "unauthorized_execution", txHash: event.txHash },
        ...(event.action === "paused" && event.pauseTx ? [paused(event.pauseTx)] : []),
      ];
    case "SUPPLIER_QUEUED":
    case "THIRD_PARTY_QUEUED":
      return [
        {
          ...base,
          id: `change:${gate}:${event.changeId}`,
          kind: "change_queued",
          changeKind: event.reason === "SUPPLIER_QUEUED" ? "supplier_added" : "role_change",
          effectiveAt: Number(event.activatesAt),
        },
      ];
    case "GATE_PAUSED":
      return [paused(event.txHash)];
    default:
      // Signer, rules version, cosigner, vetoes and resumes: logged, no bot notice fits them yet
      return [];
  }
}

export interface MonitorNotifierDeps {
  store: AgentStore;
  safe: Hex;
  gate: Hex;
  endpoint?: BotEndpoint;
  fetch?: typeof fetch;
  now?: () => number;
  log?: (line: Record<string, unknown>) => void;
}

const printable = (event: MonitorEvent) => JSON.parse(JSON.stringify(event, (_, v) => (typeof v === "bigint" ? v.toString() : v)));

// Logs every event as a JSON line and, with the bot configured, posts its notices.
export function monitorNotifier(deps: MonitorNotifierDeps) {
  const log = deps.log ?? ((line) => console.log(JSON.stringify(line)));
  const now = deps.now ?? (() => Math.floor(Date.now() / 1000));
  const doFetch = deps.fetch ?? fetch;

  return async (event: MonitorEvent): Promise<void> => {
    log({ monitor: printable(event) });
    if (!deps.endpoint) return;
    const accountId = deps.store.registry().parties.find((p) => same(p.address, deps.safe))?.account;
    if (!accountId) {
      log({ bot: "skipped", reason: "ACCOUNT_MISSING", txHash: event.txHash });
      return;
    }
    for (const notice of toMonitorNotices(event, accountId, deps.gate, now())) {
      try {
        const status = await postNotices(doFetch, deps.endpoint, [notice]);
        if (status !== 202) log({ bot: "rejected", status, id: notice.id });
      } catch (e) {
        log({ bot: "unreachable", id: notice.id, error: (e as Error).name });
      }
    }
  };
}
