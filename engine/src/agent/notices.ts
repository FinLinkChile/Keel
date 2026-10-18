// Notices of the agent for the bot (T2.6, Area 4). The agent emits reason codes; this adapter
// turns each event into the bot's own notices and posts them to its `POST /notices` route.
// No free text reaches the bot: labels, accounts, amounts and enums only (D8, T4.3).
// Notifying is never a step of the payment path: a bot that is down or slow is logged and the
// agent goes on (docs/interfaces/avisos-al-bot.md).
import type { Currency, Hex } from "@keel/schemas";
import type { DocumentRuleResult } from "../documents";
import type { AgentEvent, AgentReason } from "./agent";
import type { OrderRecord } from "./escrow";
import type { AgentStore } from "./store";

// Subset of the bot's Notice (bot/src/domain/notice.ts) that the agent produces. The bot
// validates every notice against its strict schema, so a drift here is rejected, never shown.
export type HeldReason =
  | "new_supplier_wait"
  | "over_limit_cosign"
  | "documents_mismatch"
  | "hidden_text"
  | "account_change_mention"
  // Asked by Area 2 for the agent's holds, accepted by Area 4 in PR #50
  | "funding_blocked"
  | "simulation_failed"
  | "agent_data_incomplete";

interface OrderFields {
  id: string;
  occurredAt: number;
  mode: "trade";
  orderRef: Hex;
  orderLabel: string;
  parties: { importer: string; exporter: string; arbiter?: string };
}

type Amount = { amountMinor: number; currency: Currency };

export type BotNotice = OrderFields &
  (
    | ({ kind: "order_funded" | "advance_released" | "balance_released" | "refunded" } & Amount)
    | { kind: "shipment_accepted"; onBoardDate: number; balanceReleasableAt?: number }
    | ({ kind: "operation_held"; reason: HeldReason; deadline?: number } & Partial<Amount>)
    | { kind: "deadline_approaching"; deadline: number; daysLeft: number }
  );

// Agent reasons of a hold, in the bot's words. A reason missing here is never sent.
const HELD: Partial<Record<AgentReason, HeldReason>> = {
  SUPPLIER_NEW: "new_supplier_wait",
  COSIGNATURE_NEEDED: "over_limit_cosign",
  FUNDING_BLOCKED: "funding_blocked",
  SIMULATION_REVERTED: "simulation_failed",
  // Not sent because it would fail on chain once mined: the closest existing reason
  SHIPMENT_CUTOFF: "simulation_failed",
  // The attestation the agent holds does not fit the order: the carrier must re-sign
  ON_BOARD_BEFORE_FUNDING: "agent_data_incomplete",
  DOCUMENTS_DO_NOT_CONFORM: "documents_mismatch",
  ATTESTATION_UNKNOWN: "agent_data_incomplete",
  IMPORTER_NOT_REGISTERED: "agent_data_incomplete",
};

const LABEL = /^[A-Z]{1,4}-[0-9]{1,6}$/;
const BPS = 10_000n;
const same = (a: Hex, b: Hex) => a.toLowerCase() === b.toLowerCase();
const STATE_CODE = { NONE: 0, OPEN: 1, ADVANCE_PAID: 2, SHIPPED: 3 } as Record<string, number>;

// Names the control only to the importer: the bot already shows the exporter a generic version
// of the document reasons, and the most specific one wins here.
function documentReason(rules: readonly unknown[] | undefined): HeldReason {
  const reasons = new Set((rules as DocumentRuleResult[] | undefined)?.map((r) => r.reason));
  if (reasons.has("HIDDEN_TEXT")) return "hidden_text";
  if (reasons.has("ACCOUNT_CHANGE_MENTIONED")) return "account_change_mention";
  return "documents_mismatch";
}

// Why a notice could not be built: the event still goes to the agent's log.
export type NoNotice = "NOTHING_TO_NOTIFY" | "ORDER_UNKNOWN" | "LABEL_MISSING" | "ACCOUNT_MISSING" | "AMOUNT_TOO_LARGE";

export function toNotices(event: AgentEvent, record: OrderRecord | undefined, store: AgentStore, occurredAt: number): BotNotice[] | NoNotice {
  const ofInterest =
    (event.outcome === "sent" && event.status === "success") || event.outcome === "held" || (event.outcome === "notice" && event.reason === "DEADLINE_SOON");
  if (!ofInterest || (event.outcome === "held" && !HELD[event.reason])) return "NOTHING_TO_NOTIFY";
  if (!record) return "ORDER_UNKNOWN";

  // The order is the escrow's; the store only adds what people read: label, accounts, terms
  const stored = store.order(event.orderId);
  if (!stored?.label || !LABEL.test(stored.label)) return "LABEL_MISSING";
  const { po } = record;
  const parties = store.registry().parties;
  const account = (address: Hex) => parties.find((p) => same(p.address, address))?.account;
  const importer = account(po.importer);
  const exporter = account(po.exporter);
  const arbiter = account(po.arbiter);
  if (!importer || !exporter) return "ACCOUNT_MISSING";

  // Amounts in the minor unit of the invoice currency, split like the escrow splits the token
  const total = stored.terms.invoiceAmountMinor;
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) return "AMOUNT_TOO_LARGE";
  const advance = (total * BigInt(po.advanceBps)) / BPS;
  const amount = (minor: bigint): Amount => ({ amountMinor: Number(minor), currency: stored.terms.currency });
  const deadline = Number(po.shipmentDeadline);

  // Deterministic ids: the bot sends each id once, also when two producers report the same step
  const base = (suffix: string) => ({
    id: `${event.orderId}:${suffix}`,
    occurredAt,
    mode: "trade" as const,
    orderRef: event.orderId,
    orderLabel: stored.label!,
    parties: { importer, exporter, ...(arbiter && arbiter !== importer && arbiter !== exporter && { arbiter }) },
  });

  if (event.outcome === "notice") {
    return [{ ...base(`deadline:${event.reminder}`), kind: "deadline_approaching", deadline, daysLeft: event.daysLeft ?? 0 }];
  }

  if (event.outcome === "held") {
    const reason = event.reason === "DOCUMENTS_DO_NOT_CONFORM" ? documentReason(event.rules) : HELD[event.reason]!;
    // Before shipment the deadline is what the importer works against (D8); after it, the escrow has none
    const before = event.state === "OPEN" || event.state === "ADVANCE_PAID";
    return [
      {
        ...base(`held:${STATE_CODE[event.state] ?? 9}:${reason}`),
        kind: "operation_held",
        reason,
        ...amount(total),
        ...(before && { deadline }),
      },
    ];
  }

  switch (event.action) {
    case "fund":
      return [
        { ...base("order_funded"), kind: "order_funded", ...amount(total) },
        ...(advance > 0n ? [{ ...base("advance_released"), kind: "advance_released" as const, ...amount(advance) }] : []),
      ];
    case "submitShipment": {
      const shipment = store.shipment(event.orderId);
      if (!shipment) return "ORDER_UNKNOWN";
      return [{ ...base("shipment_accepted"), kind: "shipment_accepted", onBoardDate: Number(shipment.attestation.onBoardDate) }];
    }
    // Released by the engine's DocumentDecision or by the importer's BalanceApproval: one notice id
    case "releaseBalance":
    case "approveBalance":
      return [{ ...base("balance_released"), kind: "balance_released", ...amount(total - advance) }];
    case "refundAfterDeadline":
      return total - advance > 0n ? [{ ...base("refunded"), kind: "refunded", ...amount(total - advance) }] : "NOTHING_TO_NOTIFY";
    // A cancel returns what the escrow still holds: nothing before the deposit, the balance after it
    case "cancel":
      return event.state !== "OPEN" && total - advance > 0n ? [{ ...base("refunded"), kind: "refunded", ...amount(total - advance) }] : "NOTHING_TO_NOTIFY";
    // open and resolve: the bot has no notice for them yet ([PROPUESTA] to Area 4), they are logged
    default:
      return "NOTHING_TO_NOTIFY";
  }
}

export interface BotEndpoint {
  // Base URL of the bot, such as http://127.0.0.1:8789
  url: string;
  // Bearer token of POST /notices (BOT_INBOUND_TOKEN on the bot side)
  token: string;
  timeoutMs?: number;
}

export interface BotNotifierDeps {
  store: AgentStore;
  endpoint?: BotEndpoint;
  fetch?: typeof fetch;
  now?: () => number;
  // One JSON line per event and per delivery problem. Never a token or a notice body.
  log?: (line: Record<string, unknown>) => void;
}

// The agent's notify: logs every event as a JSON line and, when the bot is configured, posts
// its notices. Returns the delivery so tests can wait for it; the agent never awaits it.
export function botNotifier(deps: BotNotifierDeps) {
  const log = deps.log ?? ((line) => console.log(JSON.stringify(line)));
  const now = deps.now ?? (() => Math.floor(Date.now() / 1000));
  const doFetch = deps.fetch ?? fetch;

  return (event: AgentEvent, record?: OrderRecord): Promise<void> => {
    log({ ...event });
    if (!deps.endpoint) return Promise.resolve();
    let notices: BotNotice[] | NoNotice;
    try {
      notices = toNotices(event, record, deps.store, now());
    } catch (e) {
      log({ bot: "skipped", orderId: event.orderId, reason: "DATA_ERROR", detail: (e as Error).message });
      return Promise.resolve();
    }
    if (typeof notices === "string") {
      if (notices !== "NOTHING_TO_NOTIFY") log({ bot: "skipped", orderId: event.orderId, reason: notices });
      return Promise.resolve();
    }
    return postNotices(doFetch, deps.endpoint, notices).then(
      (status) => {
        if (status !== 202) log({ bot: "rejected", orderId: event.orderId, status, ids: notices.map((n) => n.id) });
      },
      (e: Error) => {
        log({ bot: "unreachable", orderId: event.orderId, error: e.name });
      },
    );
  };
}

// POST /notices of the bot; returns the HTTP status. Also used by the monitor (T2.8).
export async function postNotices(doFetch: typeof fetch, endpoint: BotEndpoint, notices: readonly object[]): Promise<number> {
  const res = await doFetch(new URL("/notices", endpoint.url), {
    method: "POST",
    headers: { authorization: `Bearer ${endpoint.token}`, "content-type": "application/json" },
    body: JSON.stringify(notices),
    signal: AbortSignal.timeout(endpoint.timeoutMs ?? 3000),
  });
  return res.status;
}
