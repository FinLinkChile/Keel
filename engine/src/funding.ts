// Funding decision (step 2 of the flow): may the agent deposit this signed order in the escrow?
// T2.2, issue #10. Pure function: no network, no LLM, no implicit clock.
import type { EscrowState, FundIntent, Hex, PurchaseOrder, Tier } from "@keel/schemas";
import { structHash } from "@keel/schemas/hash";
import { canonicalHash } from "./canonical";
import type { RuleResult } from "./index";

export type FundingRule =
  | "order-signed"
  | "own-order"
  | "known-supplier"
  | "independent-roles"
  | "period-allowance"
  | "amount-in-range"
  | "shipment-deadline";

// Reason codes, never free text: the bot (Area 4) turns them into templated notices (D8).
export type FundingReason =
  | "ORDER_OPEN"
  | "ORDER_NOT_FOUND"
  | "ORDER_NOT_OPEN"
  | "ORDER_HASH_MISMATCH"
  | "OWN_ORDER"
  | "NOT_THIS_SAFE"
  | "SUPPLIER_KNOWN"
  | "SUPPLIER_NEW"
  | "PARTY_NOT_REGISTERED"
  | "ROLES_INDEPENDENT"
  | "ROLE_NOT_INDEPENDENT"
  | "WITHIN_ALLOWANCE"
  | "OVER_ALLOWANCE"
  | "TOKEN_NOT_ALLOWED"
  | "AMOUNT_IN_RANGE"
  | "AMOUNT_OUT_OF_RANGE"
  | "NO_HISTORY"
  | "DEADLINE_OK"
  | "DEADLINE_SOON"
  | "DEADLINE_PASSED";

// Tunable parameters. They are part of the rules version that goes in `policyHash` (T2.4).
export interface FundingPolicy {
  // Allowed deviation from the average amount with the same supplier, in basis points
  amountToleranceBps: number;
  // A shipment deadline closer than this is accepted with a DEADLINE_SOON notice
  deadlineWarningSeconds: number;
  // How long the funding intent stays valid
  intentTtlSeconds: number;
}

export const DEFAULT_FUNDING_POLICY: FundingPolicy = {
  amountToleranceBps: 2500,
  deadlineWarningSeconds: 3 * 24 * 60 * 60,
  intentTtlSeconds: 15 * 60,
};

// A supplier is known when its payout address went through out of band verification
// and the Delay (T4.1, D5). The pair matters: a known exporter with a new payout
// address is a new supplier.
export interface KnownSupplier {
  exporter: Hex;
  payoutAddress: Hex;
}

// Everything the engine needs besides the order. The caller reads the on-chain state
// before calling (eth_call); the engine only compares.
export interface FundingContext {
  // Unix timestamp, seconds
  now: number;
  // The Safe this engine works for: it only funds orders where that Safe is the importer
  safe: Hex;
  // The TradeEscrow contract
  escrow: Hex;
  // The order as the escrow holds it, or null when it was never opened. The escrow
  // verified both signatures (EIP-712 or ERC-1271) when it opened the order.
  escrowOrder: { state: EscrowState; orderHash: Hex } | null;
  // Addresses in the party registry (T1.11)
  registeredParties: readonly Hex[];
  knownSuppliers: readonly KnownSupplier[];
  // Remaining allowance of the agent role in the current period (Roles Modifier)
  allowance: { token: Hex; remaining: bigint };
  // Total amounts of earlier orders with the same exporter, same token
  history: readonly bigint[];
  // Nonce of the next funding intent
  nonce: bigint;
}

export interface FundingEvaluation {
  tier: Tier;
  rules: RuleResult<FundingRule, FundingReason>[];
  inputsHash: Hex;
  // Absent when the deposit is blocked (tier 4)
  intent?: FundIntent;
}

const same = (a: Hex, b: Hex) => a.toLowerCase() === b.toLowerCase();

function orderSigned(order: PurchaseOrder, ctx: FundingContext): RuleResult<FundingRule, FundingReason> {
  const rule = "order-signed";
  if (ctx.escrowOrder === null || ctx.escrowOrder.state === "NONE") return { rule, tier: 4, reason: "ORDER_NOT_FOUND" };
  if (ctx.escrowOrder.state !== "OPEN") return { rule, tier: 4, reason: "ORDER_NOT_OPEN" };
  // The order we are about to fund must be exactly the one both parties signed
  if (!same(ctx.escrowOrder.orderHash, structHash("PurchaseOrder", order))) {
    return { rule, tier: 4, reason: "ORDER_HASH_MISMATCH" };
  }
  return { rule, tier: 1, reason: "ORDER_OPEN" };
}

function ownOrder(order: PurchaseOrder, ctx: FundingContext): RuleResult<FundingRule, FundingReason> {
  const rule = "own-order";
  return same(order.importer, ctx.safe) ? { rule, tier: 1, reason: "OWN_ORDER" } : { rule, tier: 4, reason: "NOT_THIS_SAFE" };
}

// Off-chain check only: in Trade the payout address is inside the order, where Roles
// cannot see it. Area 1 adds the on-chain check in the Trade gate (T1.11).
function knownSupplier(order: PurchaseOrder, ctx: FundingContext): RuleResult<FundingRule, FundingReason> {
  const rule = "known-supplier";
  const parties = [order.importer, order.exporter, order.carrier, order.arbiter, order.documentVerifier];
  if (!parties.every((p) => ctx.registeredParties.some((r) => same(r, p)))) {
    return { rule, tier: 4, reason: "PARTY_NOT_REGISTERED" };
  }
  const known = ctx.knownSuppliers.some((s) => same(s.exporter, order.exporter) && same(s.payoutAddress, order.payoutAddress));
  return known ? { rule, tier: 1, reason: "SUPPLIER_KNOWN" } : { rule, tier: 2, reason: "SUPPLIER_NEW" };
}

// Whoever proves the shipment, verifies the documents or settles a dispute is never one of
// the parties nor the payout address, and the three of them are different: releasing the
// balance must always take two independent signatures. Mirrors the role checks of
// TradeEscrow.open, which rejects the same orders.
function independentRoles(order: PurchaseOrder): RuleResult<FundingRule, FundingReason> {
  const rule = "independent-roles";
  const parties = [order.importer, order.exporter, order.payoutAddress];
  const thirds = [order.carrier, order.arbiter, order.documentVerifier];
  const clash =
    thirds.some((t) => parties.some((p) => same(t, p))) || thirds.some((t, i) => thirds.slice(i + 1).some((u) => same(t, u)));
  return clash ? { rule, tier: 4, reason: "ROLE_NOT_INDEPENDENT" } : { rule, tier: 1, reason: "ROLES_INDEPENDENT" };
}

function periodAllowance(order: PurchaseOrder, ctx: FundingContext): RuleResult<FundingRule, FundingReason> {
  const rule = "period-allowance";
  // The allowance is per token: a token without one is not a payment token of this company
  if (!same(ctx.allowance.token, order.token)) return { rule, tier: 4, reason: "TOKEN_NOT_ALLOWED" };
  if (order.totalAmount > ctx.allowance.remaining) return { rule, tier: 3, reason: "OVER_ALLOWANCE" };
  return { rule, tier: 1, reason: "WITHIN_ALLOWANCE" };
}

function amountInRange(order: PurchaseOrder, ctx: FundingContext, policy: FundingPolicy): RuleResult<FundingRule, FundingReason> {
  const rule = "amount-in-range";
  const n = BigInt(ctx.history.length);
  if (n === 0n) return { rule, tier: 1, reason: "NO_HISTORY" };
  const sum = ctx.history.reduce((a, b) => a + b, 0n);
  // |amount - sum/n| > sum/n * tolerance, multiplied by n to stay in integers
  const diff = order.totalAmount * n - sum;
  const deviation = diff < 0n ? -diff : diff;
  if (deviation * 10_000n > sum * BigInt(policy.amountToleranceBps)) {
    return { rule, tier: 3, reason: "AMOUNT_OUT_OF_RANGE" };
  }
  return { rule, tier: 1, reason: "AMOUNT_IN_RANGE" };
}

function shipmentDeadline(order: PurchaseOrder, ctx: FundingContext, policy: FundingPolicy): RuleResult<FundingRule, FundingReason> {
  const rule = "shipment-deadline";
  const now = BigInt(ctx.now);
  if (order.shipmentDeadline <= now) return { rule, tier: 4, reason: "DEADLINE_PASSED" };
  if (order.shipmentDeadline - now < BigInt(policy.deadlineWarningSeconds)) {
    return { rule, tier: 1, reason: "DEADLINE_SOON" };
  }
  return { rule, tier: 1, reason: "DEADLINE_OK" };
}

// What the decision was made on: the order and everything read around it (escrow state,
// registry, allowance, history).
export function fundingInputsHash(order: PurchaseOrder, context: FundingContext): Hex {
  return canonicalHash({ order, context });
}

// Each rule returns the minimum tier it forces; the final tier is the maximum.
export function evaluateFunding(
  order: PurchaseOrder,
  context: FundingContext,
  policy: FundingPolicy = DEFAULT_FUNDING_POLICY,
): FundingEvaluation {
  const rules = [
    orderSigned(order, context),
    ownOrder(order, context),
    knownSupplier(order, context),
    independentRoles(order),
    periodAllowance(order, context),
    amountInRange(order, context, policy),
    shipmentDeadline(order, context, policy),
  ];
  const tier = Math.max(...rules.map((r) => r.tier)) as Tier;
  const inputsHash = fundingInputsHash(order, context);
  if (tier === 4) return { tier, rules, inputsHash };

  const intent: FundIntent = {
    orderId: order.orderId,
    orderHash: structHash("PurchaseOrder", order),
    escrow: context.escrow,
    token: order.token,
    amount: order.totalAmount,
    deadline: BigInt(context.now + policy.intentTtlSeconds),
    nonce: context.nonce,
  };
  return { tier, rules, inputsHash, intent };
}
