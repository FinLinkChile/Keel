import { EIP712_TYPES, keelDomain, type Hex, type OrderTerms, type PurchaseOrder } from '@keel/schemas';
import { termsHash } from '@keel/schemas/hash';
import { hexToString, isAddress, recoverTypedDataAddress } from 'viem';

import type { Signer } from '../wallet/signer';

import { checkOrderShape, orderIdOf, type OrderProblem } from './orderRules';

// Signing a PurchaseOrder: what the app checks first, the EIP-712 signature itself and its
// recovery. The contract, the gate and the engine enforce everything at open and funding; what
// the app checks here is defence in depth, so it never asks anyone to sign an order that would
// be refused or that is not the one agreed.

const ZERO = '0x0000000000000000000000000000000000000000';

// The escrow from EXPO_PUBLIC_ESCROW_ADDRESS. Undefined when it is empty, malformed or the zero
// address: the app never signs with a placeholder.
export function escrowFrom(raw: string | undefined): Hex | undefined {
  const value = raw?.trim();
  if (!value || !isAddress(value, { strict: false }) || value.toLowerCase() === ZERO) return undefined;
  return value as Hex;
}

export type SigningSetup = { chainId: number; escrow: Hex };

// Without both the chain and the escrow, nothing can be signed
export function signingSetup(config: { chainId?: number; escrowAddress?: Hex }): SigningSetup | undefined {
  return config.chainId && config.escrowAddress ? { chainId: config.chainId, escrow: config.escrowAddress } : undefined;
}

export const SIGNING_NOT_SET_UP = 'Signing orders is not set up yet.';

type Order = { po: PurchaseOrder; terms: OrderTerms };

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

// Names of the fields that differ between two orders, e.g. "payoutAddress" or "terms.documentHash"
export function orderDifferences(a: Order, b: Order): string[] {
  const out: string[] = [];
  for (const key of Object.keys(a.po) as (keyof PurchaseOrder)[]) {
    const [x, y] = [a.po[key], b.po[key]];
    const equal = typeof x === 'string' ? typeof y === 'string' && same(x, y) : x === y;
    if (!equal) out.push(key);
  }
  for (const key of Object.keys(b.po) as (keyof PurchaseOrder)[]) if (!(key in a.po)) out.push(key);
  for (const key of ['orderNumber', 'currency', 'invoiceAmountMinor', 'documentHash'] as const) {
    if (String(a.terms[key]).toLowerCase() !== String(b.terms[key]).toLowerCase()) out.push(`terms.${key}`);
  }
  if (JSON.stringify([...a.terms.hsCodes].sort()) !== JSON.stringify([...b.terms.hsCodes].sort())) out.push('terms.hsCodes');
  return out;
}

export type OrderCheck =
  | OrderProblem
  | 'terms_hash'
  | 'order_id'
  | 'changed_since_sent'
  | 'not_waiting_for_you'
  | 'wrong_exporter'
  | 'wrong_importer'
  | 'payout_not_registered'
  | 'bad_exporter_signature';

// Checks that do not depend on who is looking: the terms and the order id match what is signed,
// the order passes the escrow's shape checks, and it is the one that was sent.
export function checkOrder(order: Order, sent: Order, opts: { now: number; escrow?: Hex }): OrderCheck[] {
  const checks: OrderCheck[] = [];
  let hash: Hex | undefined;
  try {
    hash = termsHash(order.terms);
  } catch {
    // Terms the schema refuses cannot match any hash
  }
  if (!hash || !same(hash, order.po.termsHash)) checks.push('terms_hash');
  if (!same(orderIdOf(order.po.importer, order.po.exporter, order.po.nonce), order.po.orderId)) checks.push('order_id');
  checks.push(...checkOrderShape(order.po, opts).filter((p) => p !== 'bad_order_id'));
  if (orderDifferences(order, sent).length > 0) checks.push('changed_since_sent');
  return checks;
}

// The exporter, before signing first: the order is addressed to this wallet and pays the
// account registered for this exporter, not another one.
export function checkForExporter(
  order: Order,
  sent: Order,
  ctx: { exporter: Hex; registeredPayout: Hex | undefined; now: number; escrow?: Hex },
): OrderCheck[] {
  const checks = checkOrder(order, sent, ctx);
  if (!same(order.po.exporter, ctx.exporter)) checks.push('wrong_exporter');
  if (!ctx.registeredPayout || !same(order.po.payoutAddress, ctx.registeredPayout)) checks.push('payout_not_registered');
  return checks;
}

// What the screens say for each check, in plain words
export const CHECK_WORDS: Record<OrderCheck, string> = {
  terms_hash: 'The terms do not match what the order commits to',
  order_id: 'The order id does not match the two companies',
  changed_since_sent: 'This order is not the one that was sent',
  not_waiting_for_you: 'This order is not waiting for your signature',
  wrong_exporter: 'This order is not addressed to your wallet',
  wrong_importer: 'This order is not from the company you agreed it with',
  payout_not_registered: 'The payout account is not the one registered for your company',
  bad_exporter_signature: "The supplier's signature does not match this order",
  bad_amount: 'The total is not valid',
  bad_advance: 'The advance must be between 0% and 100%',
  deadline_passed: 'The shipment date has already passed',
  missing_address: 'An address of this order is missing',
  same_parties: 'Both sides of this order are the same company',
  third_party_not_independent: 'A wallet appears twice in this order, as a party and as the carrier, arbiter, verifier or payout',
  escrow_as_party: 'The escrow cannot be a party of its own order',
  bad_order_id: 'The order id does not match the two companies',
};

// The EIP-712 PurchaseOrder both parties sign, verified by the escrow
const types = { PurchaseOrder: EIP712_TYPES.PurchaseOrder };

export function signPurchaseOrder(signer: Signer, setup: SigningSetup, po: PurchaseOrder): Promise<Hex> {
  return signer.signTypedData(keelDomain(setup.chainId, setup.escrow), types, 'PurchaseOrder', { ...po });
}

// Who signed this order, as the escrow would recover it. undefined for an unreadable signature.
export async function recoverPurchaseOrderSigner(setup: SigningSetup, po: PurchaseOrder, signature: Hex): Promise<Hex | undefined> {
  try {
    return await recoverTypedDataAddress({
      domain: keelDomain(setup.chainId, setup.escrow),
      types,
      primaryType: 'PurchaseOrder',
      message: po,
      signature,
    });
  } catch {
    return undefined;
  }
}

// The fields that can differ between the order that was sent and the one in front of the
// importer, in words
const DIFFERENCE_WORDS: Record<string, string> = {
  orderId: 'order id',
  importer: 'buyer',
  exporter: 'supplier',
  payoutAddress: 'payout account',
  token: 'currency of payment',
  totalAmount: 'total',
  advanceBps: 'advance',
  shipmentDeadline: 'ship by date',
  disputeWindow: 'dispute window',
  carrier: 'carrier',
  arbiter: 'arbiter',
  documentVerifier: 'document verifier',
  incoterm: 'incoterm',
  termsHash: 'terms',
  requiredDocsHash: 'required documents',
  nonce: 'order version',
  'terms.orderNumber': 'order number',
  'terms.currency': 'invoice currency',
  'terms.invoiceAmountMinor': 'invoice amount',
  'terms.hsCodes': 'HS codes',
  'terms.documentHash': 'proforma',
};

export const differenceWords = (fields: string[]): string[] => fields.map((f) => DIFFERENCE_WORDS[f] ?? f);

// How the payout account compares with the orders the importer already has with this supplier:
// the same account as before, or another one (which deserves a second look)
export function payoutHistory(
  orders: { po: Pick<PurchaseOrder, 'orderId' | 'exporter' | 'payoutAddress'> }[],
  order: Pick<PurchaseOrder, 'orderId' | 'exporter' | 'payoutAddress'>,
): { same: number; different: number } {
  const before = orders.filter((o) => same(o.po.exporter, order.exporter) && !same(o.po.orderId, order.orderId));
  const sameCount = before.filter((o) => same(o.po.payoutAddress, order.payoutAddress)).length;
  return { same: sameCount, different: before.length - sameCount };
}

// "0x43494600…" -> "CIF"
export function incotermText(incoterm: Hex): string {
  return hexToString(incoterm, { size: 32 }).replace(/\0+$/, '');
}
