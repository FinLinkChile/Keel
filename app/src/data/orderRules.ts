import type { Hex, PurchaseOrder } from '@keel/schemas';
import { encodeAbiParameters, keccak256 } from 'viem';

// What TradeEscrow.open checks about an order that can be checked off chain, so the app never
// asks anyone to sign an order the contract would refuse (contracts/src/TradeEscrow.sol).

// open: po.orderId == keccak256(abi.encode(importer, exporter, nonce)), or BadOrderId
export function orderIdOf(importer: Hex, exporter: Hex, nonce: bigint): Hex {
  return keccak256(
    encodeAbiParameters([{ type: 'address' }, { type: 'address' }, { type: 'uint256' }], [importer, exporter, nonce]),
  );
}

const BPS = 10_000;
const MAX_UINT256 = 2n ** 256n - 1n;
const ZERO = '0x0000000000000000000000000000000000000000';

export type OrderProblem =
  | 'bad_order_id'
  | 'missing_address'
  | 'same_parties'
  | 'third_party_not_independent'
  | 'escrow_as_party'
  | 'bad_advance'
  | 'bad_amount'
  | 'deadline_passed';

// _checkOrderShape of TradeEscrow, plus the orderId rule. Empty when the order can be opened
// as far as the app can tell (token, existing order and signatures are checked elsewhere).
export function checkOrderShape(po: PurchaseOrder, opts: { now: number; escrow?: Hex }): OrderProblem[] {
  const problems: OrderProblem[] = [];
  const same = (a: Hex, b: Hex) => a.toLowerCase() === b.toLowerCase();
  const { importer: imp, exporter: exp, payoutAddress: payout, carrier, arbiter, documentVerifier: verifier } = po;

  if (!same(po.orderId, orderIdOf(imp, exp, po.nonce))) problems.push('bad_order_id');
  if ([imp, exp, payout, carrier, arbiter, verifier].some((a) => same(a, ZERO))) problems.push('missing_address');
  if (same(imp, exp)) problems.push('same_parties');
  const notIndependent =
    [imp, exp].some((p) => same(carrier, p) || same(arbiter, p) || same(verifier, p)) ||
    same(verifier, carrier) ||
    same(verifier, payout) ||
    same(verifier, arbiter) ||
    same(carrier, payout) ||
    same(arbiter, payout) ||
    same(carrier, arbiter);
  if (notIndependent) problems.push('third_party_not_independent');
  if (opts.escrow && [imp, exp, payout, carrier, arbiter, verifier].some((a) => same(a, opts.escrow!))) problems.push('escrow_as_party');
  if (po.advanceBps > BPS || po.advanceBps < 0) problems.push('bad_advance');
  if (po.totalAmount <= 0n || po.totalAmount > MAX_UINT256 / BigInt(BPS)) problems.push('bad_amount');
  if (po.shipmentDeadline <= BigInt(Math.floor(opts.now))) problems.push('deadline_passed');
  return problems;
}
