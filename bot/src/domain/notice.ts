// The bot's own notice type. Producers (engine, ingest, monitor, chain events) never reach the
// templates directly: an inbound adapter maps what they emit into a Notice, and anything that
// does not fit is rejected here.
// No free text (T4.3, critical 8): every field is an enum, an integer, a timestamp or a value
// held to a strict regex. Every object is strict, so an extra field such as `name` fails.
import { ALIAS_IDS } from "@keel/schemas";
import { z } from "zod";
import { AccountId } from "./recipients";

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

export const NoticeId = z.string().regex(/^[A-Za-z0-9_.:-]{1,100}$/);

// Unix timestamp, seconds. Upper bound keeps a garbage value from becoming a date in year 50000.
export const Timestamp = z.number().int().positive().max(4_102_444_800);

// Integer amount in the currency's minor unit (cents). The decimals per currency live in
// presentation/format.ts, because the payment token is open decision 1.
export const AmountMinor = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const AmountMinorOrZero = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

// Same enum as the commercial invoice.
export const CURRENCIES = ["USD", "EUR", "CNY", "HKD"] as const;
export const Currency = z.enum(CURRENCIES);
export type Currency = z.infer<typeof Currency>;

// orderRef is opaque and only used to build the app URL: on chain the order id is a bytes32,
// and the number people use lives in the order document. orderLabel is what is shown.
export const OrderRef = z.string().regex(/^(0x[0-9a-fA-F]{64}|[A-Za-z0-9_-]{1,80})$/);
// At most 6 digits, so a phone number cannot pass as a label.
export const OrderLabel = z.string().regex(/^[A-Z]{1,4}-[0-9]{1,6}$/);

export const TxHash = z.string().regex(/^0x[0-9a-fA-F]{64}$/);

// One reminder per id: a producer that reminds at 5, 3 and 1 days sends three ids.
export const DaysLeft = z.number().int().nonnegative().max(365);

// ---------------------------------------------------------------------------
// Diffs (two source mismatch, T3.5)
// ---------------------------------------------------------------------------

// The producer's values are kept raw here and revalidated field by field in domain/diffs.ts:
// a value that fails its field's check does not stop the notice (it is a security alert),
// it is just never shown.
export const DiffValue = z.union([z.string().max(200), z.number()]);

export const TRADE_DIFF_FIELDS = ["document_number", "on_board_date", "amount_minor", "currency"] as const;
export type TradeDiffField = (typeof TRADE_DIFF_FIELDS)[number];

// a and b are the two readings. The ingest mapper puts the parser in a and the LLM in b.
export const TradeDiff = z.strictObject({ field: z.enum(TRADE_DIFF_FIELDS), a: DiffValue, b: DiffValue });
export type TradeDiff = z.infer<typeof TradeDiff>;

// ---------------------------------------------------------------------------
// Keel Trade
// ---------------------------------------------------------------------------

export const Parties = z
  .strictObject({ importer: AccountId, exporter: AccountId, arbiter: AccountId.optional() })
  .refine((p) => new Set([p.importer, p.exporter, p.arbiter].filter(Boolean)).size === (p.arbiter ? 3 : 2), {
    message: "parties must be different accounts",
  });
export type Parties = z.infer<typeof Parties>;

const base = { id: NoticeId, occurredAt: Timestamp };

// About one order: the parties come with the notice, without names.
const order = { ...base, mode: z.literal("trade"), orderRef: OrderRef, orderLabel: OrderLabel, parties: Parties };

// About the importer's wallet itself (Delay queue, Roles Modifier, gate), not one order.
// accountId is the company that owns the wallet.
const wallet = { ...base, mode: z.literal("trade"), accountId: AccountId };

const amount = { amountMinor: AmountMinor, currency: Currency };

export const HELD_REASONS = [
  "new_supplier_wait",
  "over_limit_cosign",
  "documents_mismatch",
  "two_source_mismatch",
  "hidden_text",
  "account_change_mention",
] as const;
export type HeldReason = (typeof HELD_REASONS)[number];

// Reasons about the shipping documents. The exporter only ever gets a generic version of these:
// naming the control that fired teaches an attacker what is detected.
export const DOCUMENT_REASONS = [
  "documents_mismatch",
  "two_source_mismatch",
  "hidden_text",
  "account_change_mention",
] as const satisfies readonly HeldReason[];
export const isDocumentReason = (r: HeldReason): boolean => (DOCUMENT_REASONS as readonly HeldReason[]).includes(r);

// Assumption: aligned with what Area 1's Delay queues once it exists (see bot/README.md).
export const CHANGE_KINDS = ["limit", "supplier_added", "role_change", "policy_signer"] as const;
export type ChangeKind = (typeof CHANGE_KINDS)[number];

const OrderOpened = z.strictObject({ ...order, kind: z.literal("order_opened"), ...amount, shipmentDeadline: Timestamp });
// From OrderFunded, not FundingExecuted: both come from the same deposit and would notify twice.
const OrderFunded = z.strictObject({ ...order, kind: z.literal("order_funded"), ...amount });
const AdvanceReleased = z.strictObject({ ...order, kind: z.literal("advance_released"), ...amount });
const ShipmentAccepted = z.strictObject({ ...order, kind: z.literal("shipment_accepted"), onBoardDate: Timestamp });
const BalanceReleased = z.strictObject({ ...order, kind: z.literal("balance_released"), ...amount });
const Refunded = z.strictObject({ ...order, kind: z.literal("refunded"), ...amount });
const OrderCancelled = z.strictObject({ ...order, kind: z.literal("order_cancelled"), ...amount });
const DisputeRaised = z.strictObject({ ...order, kind: z.literal("dispute_raised"), raisedBy: z.enum(["importer", "exporter"]) });
const DisputeResolved = z.strictObject({
  ...order,
  kind: z.literal("dispute_resolved"),
  toImporterMinor: AmountMinorOrZero,
  toExporterMinor: AmountMinorOrZero,
  currency: Currency,
});
// amountMinor and currency are optional: the amount of the held operation when the producer has
// it, also used to show an amount_minor diff.
const OperationHeld = z
  .strictObject({
    ...order,
    kind: z.literal("operation_held"),
    reason: z.enum(HELD_REASONS),
    deadline: Timestamp.optional(),
    amountMinor: AmountMinor.optional(),
    currency: Currency.optional(),
    diffs: z.array(TradeDiff).min(1).max(8).optional(),
  })
  .refine((n) => (n.amountMinor === undefined) === (n.currency === undefined), {
    message: "amountMinor and currency go together",
  })
  .refine((n) => n.diffs === undefined || n.reason === "two_source_mismatch", {
    message: "diffs only come with two_source_mismatch",
  });
const DeadlineApproaching = z.strictObject({
  ...order,
  kind: z.literal("deadline_approaching"),
  deadline: Timestamp,
  daysLeft: DaysLeft,
});
// Never the account, the sender or the text: only that an attempt happened.
const AccountChangeAttempt = z.strictObject({ ...order, kind: z.literal("account_change_attempt") });

const ChangeQueued = z.strictObject({
  ...wallet,
  kind: z.literal("change_queued"),
  changeKind: z.enum(CHANGE_KINDS),
  effectiveAt: Timestamp,
});
const TransferBlocked = z.strictObject({ ...wallet, kind: z.literal("transfer_blocked"), txHash: TxHash });
const AgentRevoked = z.strictObject({ ...wallet, kind: z.literal("agent_revoked") });
const GatePaused = z.strictObject({ ...wallet, kind: z.literal("gate_paused") });

// ---------------------------------------------------------------------------
// Keel Personal (depth depends on open decision 14)
// ---------------------------------------------------------------------------

export const AliasIdSchema = z.enum(ALIAS_IDS);
export const AmountClp = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

// The fields ingest compares (COMPARED_FIELDS in ingest/src/agreement.ts), redeclared here: the
// bot imports only types from ingest.
export const PERSONAL_DIFF_FIELDS = ["issuer_tax_id", "invoice_number", "period", "amount_clp", "alias_id"] as const;
export type PersonalDiffField = (typeof PERSONAL_DIFF_FIELDS)[number];
export const PersonalDiff = z.strictObject({ field: z.enum(PERSONAL_DIFF_FIELDS), a: DiffValue, b: DiffValue });
export type PersonalDiff = z.infer<typeof PersonalDiff>;

// Engine reasons for a held payment (T2.6). The bot's own enum: the engine adapter maps to it.
export const PAYMENT_HELD_REASONS = [
  // issuer_tax_id differs from the RUT registered for the alias: the typical fake bill
  "issuer_mismatch",
  "amount_out_of_range",
  "over_period_limit",
  "fx_divergence",
  "account_change_request",
  "hidden_text",
  "simulation_failed",
] as const;
export type PaymentHeldReason = (typeof PAYMENT_HELD_REASONS)[number];

// Same values as CHANGE_TRIGGERS in ingest/src/beneficiaryChange.ts.
export const CHANGE_TRIGGERS = ["announced_in_document", "unknown_destination"] as const;

const uniqueList = <T extends z.ZodType>(item: T, max: number) =>
  z
    .array(item)
    .min(1)
    .max(max)
    .refine((xs) => new Set(xs).size === xs.length, { message: "duplicate values" });

const personal = { ...base, mode: z.literal("personal"), accountId: AccountId };

const PaymentHeld = z.strictObject({
  ...personal,
  kind: z.literal("payment_held"),
  aliasId: AliasIdSchema,
  amountClp: AmountClp,
  dueDate: Timestamp,
  reason: z.enum(PAYMENT_HELD_REASONS),
});
// One id per reminder: 5, 3 and 1 days are three notices.
const PaymentDeadline = z.strictObject({
  ...personal,
  kind: z.literal("payment_deadline"),
  aliasId: AliasIdSchema,
  amountClp: AmountClp,
  dueDate: Timestamp,
  daysLeft: DaysLeft,
});
const InvoiceNeedsCosign = z.strictObject({
  ...personal,
  kind: z.literal("invoice_needs_cosign"),
  aliasId: AliasIdSchema,
  diffs: z.array(PersonalDiff).min(1).max(8),
});
const InvoiceHeld = z.strictObject({
  ...personal,
  kind: z.literal("invoice_held"),
  aliasId: AliasIdSchema.optional(),
  reason: z.enum(["parser_failed", "extractor_failed"]),
});
// Never the sender's domain nor the proposed destinations: a look-alike domain is the attack,
// and it is compared calmly in the app's readable diff (T4.2), not in a chat.
const ChangeRequested = z.strictObject({
  ...personal,
  kind: z.literal("change_requested"),
  aliasId: AliasIdSchema,
  triggers: uniqueList(z.enum(CHANGE_TRIGGERS), CHANGE_TRIGGERS.length),
  requestId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
});
const ChangeDigest = z.strictObject({
  ...personal,
  kind: z.literal("change_digest"),
  count: z.number().int().positive().max(10_000),
  aliasIds: uniqueList(AliasIdSchema, ALIAS_IDS.length),
});
const PaymentExecuted = z.strictObject({ ...personal, kind: z.literal("payment_executed"), aliasId: AliasIdSchema, amountClp: AmountClp });
const ChangeVetoed = z.strictObject({ ...personal, kind: z.literal("change_vetoed"), aliasId: AliasIdSchema });
const ChangeScheduled = z.strictObject({ ...personal, kind: z.literal("change_scheduled"), aliasId: AliasIdSchema, effectiveAt: Timestamp });

const PERSONAL_OPTIONS = [
  PaymentHeld,
  PaymentDeadline,
  InvoiceNeedsCosign,
  InvoiceHeld,
  ChangeRequested,
  ChangeDigest,
  PaymentExecuted,
  ChangeVetoed,
  ChangeScheduled,
] as const;

export const TradeNotice = z.discriminatedUnion("kind", [
  OrderOpened,
  OrderFunded,
  AdvanceReleased,
  ShipmentAccepted,
  BalanceReleased,
  Refunded,
  OrderCancelled,
  DisputeRaised,
  DisputeResolved,
  OperationHeld,
  DeadlineApproaching,
  AccountChangeAttempt,
  ChangeQueued,
  TransferBlocked,
  AgentRevoked,
  GatePaused,
]);
export type TradeNotice = z.infer<typeof TradeNotice>;

export const PersonalNotice = z.discriminatedUnion("kind", [...PERSONAL_OPTIONS]);
export type PersonalNotice = z.infer<typeof PersonalNotice>;

export const Notice = z.discriminatedUnion("kind", [...TradeNotice.options, ...PERSONAL_OPTIONS]);
export type Notice = z.infer<typeof Notice>;
export type NoticeKind = Notice["kind"];
export type NoticeOf<K extends NoticeKind> = Extract<Notice, { kind: K }>;

export type OrderNotice = Extract<Notice, { orderRef: string }>;
export type WalletNotice = Exclude<TradeNotice, OrderNotice>;
export const isPersonal = (n: Notice): n is PersonalNotice => n.mode === "personal";
export const isOrderNotice = (n: Notice): n is OrderNotice => "orderRef" in n;

// Accounts a notice names, checked against the directory before anything is sent.
export function accountsOf(n: Notice): string[] {
  if ("parties" in n) return [n.parties.importer, n.parties.exporter, ...(n.parties.arbiter ? [n.parties.arbiter] : [])];
  return [n.accountId];
}

