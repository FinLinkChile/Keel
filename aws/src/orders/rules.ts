// Pure rules of the orders API: what TradeEscrow.open checks that can be checked off chain, the
// labels people read and the amounts the escrow moves. Nothing here reads a table or the chain.
//
// These checks are defence in depth. The escrow re-checks the order id, the shape, the token and
// both signatures at `open`, the FundingGate checks the supplier and the roles at `fund`, and the
// engine evaluates the order before the agent moves anything. A bug here can make the API store a
// proposal the escrow would refuse; it cannot make the escrow accept it.
import type { Hex, OrderTerms, PurchaseOrder } from "@keel/schemas";
import { termsHash } from "@keel/schemas/hash";
import { encodeAbiParameters, keccak256 } from "viem";

const BPS = 10_000n;
const MAX_UINT256 = 2n ** 256n - 1n;
const ZERO = "0x0000000000000000000000000000000000000000";

export const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

// open: po.orderId == keccak256(abi.encode(importer, exporter, nonce)), or BadOrderId
export function orderIdOf(importer: Hex, exporter: Hex, nonce: bigint): Hex {
  return keccak256(encodeAbiParameters([{ type: "address" }, { type: "address" }, { type: "uint256" }], [importer, exporter, nonce]));
}

// Codes returned in `{ error: "invalid_order", problems: [...] }`. The same words as
// app/src/data/orderRules.ts, so the app can show its own texts for them.
export type OrderProblem =
  | "bad_order_id"
  | "terms_hash"
  | "missing_address"
  | "same_parties"
  | "third_party_not_independent"
  | "escrow_as_party"
  | "bad_advance"
  | "bad_amount"
  | "deadline_passed"
  | "token_not_allowed";

// TradeEscrow._checkOrderShape plus the order id, the terms hash and the token. `token` is the
// one token the escrow accepts (constructor `TradeEscrow(token, refundGrace)`); when the
// deployment does not publish it, the escrow's own TokenNotAllowed is the only check.
export function checkOrder(po: PurchaseOrder, terms: OrderTerms, opts: { now: number; escrow: Hex; token?: Hex }): OrderProblem[] {
  const problems: OrderProblem[] = [];
  const { importer: imp, exporter: exp, payoutAddress: payout, carrier, arbiter, documentVerifier: verifier } = po;
  if (!same(po.orderId, orderIdOf(imp, exp, po.nonce))) problems.push("bad_order_id");
  let hash: Hex | undefined;
  try {
    hash = termsHash(terms);
  } catch {
    // Terms the schema refuses cannot match any hash
  }
  if (!hash || !same(hash, po.termsHash)) problems.push("terms_hash");
  const all = [imp, exp, payout, carrier, arbiter, verifier];
  if (all.some((a) => same(a, ZERO))) problems.push("missing_address");
  if (same(imp, exp)) problems.push("same_parties");
  // Independence, as the escrow sees it: only the exact same address is detected. Whether the
  // verifier is Keel's key is enforced by the engine and the gate, not here.
  const notIndependent =
    [imp, exp].some((p) => same(carrier, p) || same(arbiter, p) || same(verifier, p)) ||
    same(verifier, carrier) ||
    same(verifier, payout) ||
    same(verifier, arbiter) ||
    same(carrier, payout) ||
    same(arbiter, payout) ||
    same(carrier, arbiter);
  if (notIndependent) problems.push("third_party_not_independent");
  if (all.some((a) => same(a, opts.escrow))) problems.push("escrow_as_party");
  if (po.advanceBps > Number(BPS) || po.advanceBps < 0) problems.push("bad_advance");
  if (po.totalAmount <= 0n || po.totalAmount > MAX_UINT256 / BPS) problems.push("bad_amount");
  if (po.shipmentDeadline <= BigInt(Math.floor(opts.now))) problems.push("deadline_passed");
  if (opts.token && !same(po.token, opts.token)) problems.push("token_not_allowed");
  return problems;
}

type Order = { po: PurchaseOrder; terms: OrderTerms };

// Names of the fields that differ between two orders, e.g. "payoutAddress" or "terms.documentHash".
// Same names as orderDifferences in app/src/data/signOrder.ts.
export function orderDifferences(a: Order, b: Order): string[] {
  const out: string[] = [];
  for (const key of Object.keys(a.po) as (keyof PurchaseOrder)[]) {
    const [x, y] = [a.po[key], b.po[key]];
    const equal = typeof x === "string" ? typeof y === "string" && same(x, y) : x === y;
    if (!equal) out.push(key);
  }
  for (const key of ["orderNumber", "currency", "invoiceAmountMinor", "documentHash"] as const) {
    if (String(a.terms[key]).toLowerCase() !== String(b.terms[key]).toLowerCase()) out.push(`terms.${key}`);
  }
  if (JSON.stringify([...a.terms.hsCodes].sort()) !== JSON.stringify([...b.terms.hsCodes].sort())) out.push("terms.hsCodes");
  return out;
}

// The bot's OrderLabel: at most 6 digits, so a phone number cannot pass as a label
export const LABEL = /^[A-Z]{1,4}-[0-9]{1,6}$/;

// "PO0158" -> "PO-0158" (app proposalLabel). Undefined when the result is not a valid label: the
// bot then skips the order's notices instead of showing something else.
export function labelOf(orderNumber: string): string | undefined {
  const label = orderNumber.replace(/^([A-Z]{1,4})(?=[0-9])/, "$1-");
  return LABEL.test(label) ? label : undefined;
}

// The escrow pays the advance inside `fund`: advance = totalAmount * advanceBps / 10000, rounded down
export const advanceOf = (po: Pick<PurchaseOrder, "totalAmount" | "advanceBps">): bigint => (po.totalAmount * BigInt(po.advanceBps)) / BPS;

// What the escrow still holds for an order in a given state (its `_remaining`): the whole total
// is never held before `fund`, the advance leaves inside `fund`, and nothing is left after a
// final state. Read from the indexer's mirror, so it lags the chain by the indexer's delay.
export function lockedIn(state: string | undefined, po: Pick<PurchaseOrder, "totalAmount" | "advanceBps">): bigint {
  if (state === "ADVANCE_PAID" || state === "SHIPPED" || state === "DISPUTED") return po.totalAmount - advanceOf(po);
  return 0n;
}

// States from which TradeEscrow.cancel is allowed
export const CANCELLABLE_STATES = ["OPEN", "ADVANCE_PAID", "DISPUTED"] as const;
export const FINAL_STATES = ["SETTLED", "REFUNDED", "RESOLVED", "CANCELLED"] as const;
export const isFinal = (state: string | undefined) => !!state && (FINAL_STATES as readonly string[]).includes(state);
