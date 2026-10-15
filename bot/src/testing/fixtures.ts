// Sample notices and an in-memory directory for tests. Accounts and chats are fictitious.
import type { ChatId, LogEntry, RecipientDirectory } from "../application/ports";
import type { Message } from "../domain/message";
import type { Notice, NoticeKind } from "../domain/notice";
import type { Role } from "../domain/recipients";

// 2026-10-14T12:00:00Z
export const NOW_MS = Date.UTC(2026, 9, 14, 12);
export const oct = (d: number) => Date.UTC(2026, 9, d) / 1000;
export const nov = (d: number) => Date.UTC(2026, 10, d) / 1000;
export const HASH = `0x${"ab".repeat(32)}`;

export const CHATS = {
  acme: { owner: 111, operator: 222, cosigner: 333 },
  lingnan: { owner: 444, operator: 555 },
  arbiter: { owner: 888 },
  ana: { owner: 666, cosigner: 777 },
} as const;

const ACCOUNTS: Record<string, { name: string; roles: Partial<Record<Role, ChatId[]>> }> = {
  "acme-imports": { name: "Acme Imports", roles: { owner: [111], operator: [222], cosigner: [333] } },
  lingnan: { name: "Lingnan Hydrocolloids", roles: { owner: [444], operator: [555] } },
  "hk-arbitration": { name: "HK Trade Arbitration", roles: { owner: [888] } },
  ana: { name: "Ana", roles: { owner: [666], cosigner: [777] } },
};

export const directory: RecipientDirectory = {
  name: (a) => ACCOUNTS[a]?.name,
  chats: (a, role) => ACCOUNTS[a]?.roles[role] ?? [],
};

const order = {
  mode: "trade" as const,
  occurredAt: oct(14),
  orderRef: "po-0142",
  orderLabel: "PO-0142",
  parties: { importer: "acme-imports", exporter: "lingnan", arbiter: "hk-arbitration" },
};
const wallet = { mode: "trade" as const, occurredAt: oct(14), accountId: "acme-imports" };
const personal = { mode: "personal" as const, occurredAt: oct(14), accountId: "ana" };

// One valid notice per kind.
export const SAMPLES: { [K in NoticeKind]: Extract<Notice, { kind: K }> } = {
  order_opened: { ...order, id: "n-1", kind: "order_opened", amountMinor: 4_800_000, currency: "USD", shipmentDeadline: nov(20) },
  order_funded: { ...order, id: "n-2", kind: "order_funded", amountMinor: 4_800_000, currency: "USD" },
  advance_released: { ...order, id: "n-3", kind: "advance_released", amountMinor: 1_440_000, currency: "USD" },
  shipment_accepted: { ...order, id: "n-4", kind: "shipment_accepted", onBoardDate: nov(12) },
  balance_released: { ...order, id: "n-5", kind: "balance_released", amountMinor: 3_360_000, currency: "USD" },
  refunded: { ...order, id: "n-6", kind: "refunded", amountMinor: 3_360_000, currency: "USD" },
  order_cancelled: { ...order, id: "n-7", kind: "order_cancelled", amountMinor: 4_800_000, currency: "USD" },
  dispute_raised: { ...order, id: "n-8", kind: "dispute_raised", raisedBy: "importer" },
  dispute_resolved: { ...order, id: "n-9", kind: "dispute_resolved", toImporterMinor: 1_000_000, toExporterMinor: 2_360_000, currency: "USD" },
  operation_held: { ...order, id: "n-10", kind: "operation_held", reason: "hidden_text", deadline: nov(20) },
  deadline_approaching: { ...order, id: "n-11", kind: "deadline_approaching", deadline: oct(17), daysLeft: 3 },
  account_change_attempt: { ...order, id: "n-12", kind: "account_change_attempt" },
  change_queued: { ...wallet, id: "n-13", kind: "change_queued", changeKind: "supplier_added", effectiveAt: oct(17) },
  transfer_blocked: { ...wallet, id: "n-14", kind: "transfer_blocked", txHash: HASH },
  agent_revoked: { ...wallet, id: "n-15", kind: "agent_revoked" },
  gate_paused: { ...wallet, id: "n-16", kind: "gate_paused" },
  payment_held: { ...personal, id: "p-1", kind: "payment_held", aliasId: "LUZ", amountClp: 45990, dueDate: oct(17), reason: "fx_divergence" },
  payment_deadline: { ...personal, id: "p-2", kind: "payment_deadline", aliasId: "LUZ", amountClp: 45990, dueDate: oct(17), daysLeft: 3 },
  invoice_needs_cosign: {
    ...personal,
    id: "p-3",
    kind: "invoice_needs_cosign",
    aliasId: "LUZ",
    diffs: [{ field: "amount_clp", a: 45990, b: 459900 }],
  },
  invoice_held: { ...personal, id: "p-4", kind: "invoice_held", reason: "parser_failed" },
  change_requested: {
    ...personal,
    id: "p-5",
    kind: "change_requested",
    aliasId: "LUZ",
    triggers: ["announced_in_document", "unknown_destination"],
    requestId: 12,
  },
  change_digest: { ...personal, id: "p-6", kind: "change_digest", count: 3, aliasIds: ["LUZ", "INTERNET"] },
  payment_executed: { ...personal, id: "p-7", kind: "payment_executed", aliasId: "LUZ", amountClp: 45990 },
  change_vetoed: { ...personal, id: "p-8", kind: "change_vetoed", aliasId: "LUZ" },
  change_scheduled: { ...personal, id: "p-9", kind: "change_scheduled", aliasId: "LUZ", effectiveAt: oct(21) },
};

export const TRADE_SAMPLES = Object.values(SAMPLES).filter((n) => n.mode === "trade");
export const PERSONAL_SAMPLES = Object.values(SAMPLES).filter((n) => n.mode === "personal");

export class MemorySender {
  readonly sent: { chatId: ChatId; message: Message }[] = [];
  async send(chatId: ChatId, message: Message) {
    this.sent.push({ chatId, message });
  }
  to(chatId: ChatId) {
    return this.sent.filter((s) => s.chatId === chatId).map((s) => s.message);
  }
}

export class MemoryLogger {
  readonly entries: LogEntry[] = [];
  log(e: LogEntry) {
    this.entries.push(e);
  }
}
