import type { Currency, Hex, Incoterm, OrderTerms, PurchaseOrder, RequiredDocType } from '@keel/schemas';
import { OrderTerms as OrderTermsSchema } from '@keel/schemas';
import { bytes32Text, requiredDocsHash, termsHash } from '@keel/schemas/hash';
import { getRandomValues } from 'expo-crypto';

import type { ProformaReading } from '../ingest/proforma';

import { checkOrderShape, orderIdOf, type OrderProblem } from './orderRules';

// New order from the proforma, up to the point where it can be signed (step 0 of the flow, the
// order that both parties then sign in step 1). Pure logic, no screen. The proforma only
// prefills the form: who is paid comes from the verified supplier, never from the reading.

// A supplier that went through the supplier check. Its wallet and payout address were registered
// then, so neither is ever read from a document (principle 1).
export type VerifiedSupplier = {
  exporter: Hex;
  payoutAddress: Hex;
};

// The fixed third parties and the token of the corridor
export type TradeRegistry = {
  token: Hex;
  carrier: Hex;
  arbiter: Hex;
  documentVerifier: Hex;
};

// What the screen holds. Everything may be empty until the importer fills it in.
export type OrderForm = {
  importer: Hex;
  supplier?: VerifiedSupplier;
  // The importer's own number for this order. NOT the proforma number.
  orderNumber: string;
  currency: Currency | null;
  // In cents of `currency` (2 decimals), as the proforma prints it
  amountMinor: number | null;
  incoterm: Incoterm | null;
  hsCodes: string[];
  // Unix seconds
  shipmentDeadline: number | null;
  // 5000 = 50%
  advanceBps: number | null;
  documentHash: Hex | null;
  disputeDays?: number;
};

export type FormField =
  | 'supplier'
  | 'orderNumber'
  | 'currency'
  | 'amount'
  | 'incoterm'
  | 'hsCodes'
  | 'shipmentDeadline'
  | 'advance'
  | 'documentHash';

export type NewOrderProblem = OrderProblem | 'currency_is_not_the_token';

export type BuiltOrder =
  | { kind: 'ready'; po: PurchaseOrder; terms: OrderTerms }
  // `fields` are missing or invalid; `problems` are what the escrow would refuse
  | { kind: 'blocked'; fields: FormField[]; problems: NewOrderProblem[] };

export const DEFAULT_DISPUTE_DAYS = 3;
// Documents every trade order requires (as in the demo orders)
export const REQUIRED_DOCS: readonly RequiredDocType[] = ['BILL_OF_LADING', 'COMMERCIAL_INVOICE'];

// The token is USDC. The amount of a USD invoice is the token amount; another currency would
// need an exchange rate nobody has agreed on, so it is blocked instead of converted.
const TOKEN_CURRENCY: Currency = 'USD';
const CURRENCY_DECIMALS = 2;
const TOKEN_DECIMALS = 6;
const CENTS_TO_TOKEN_UNITS = 10n ** BigInt(TOKEN_DECIMALS - CURRENCY_DECIMALS);

// ASSUMPTION (open point 3 of PR #66, undecided): documentHash is the hash of the proforma file,
// as ingest returns it, until the team decides what "the full order document" is.
export const documentHashOf = (proformaFileHash: Hex): Hex => proformaFileHash.toLowerCase() as Hex;

// ASSUMPTION (pending with Area 2): the shipment deadline is the latest shipment date of the
// proforma as ingest returns it, midnight UTC at the start of that day. Whether it should be the
// end of the day is not decided.
export const shipmentDeadlineOf = (latestShipmentDate: number): number => latestShipmentDate;

// The form fields a reading can prefill. Never the supplier, the payout address or the order
// number; the proforma number and the ports are not used (ports are display only).
export function prefillFromProforma(reading: ProformaReading): Partial<OrderForm> {
  const p = reading.proforma;
  return {
    currency: p.currency,
    amountMinor: p.amount_minor,
    incoterm: p.incoterm,
    hsCodes: p.hs_codes,
    shipmentDeadline: p.latest_shipment_date === null ? null : shipmentDeadlineOf(p.latest_shipment_date),
    advanceBps: p.advance_bps,
    documentHash: documentHashOf(reading.fileHash),
  };
}

// A fresh random nonce, so a new version of an order never reuses an orderId
export function freshNonce(): bigint {
  const bytes = getRandomValues(new Uint8Array(8));
  return bytes.reduce((n, b) => (n << 8n) | BigInt(b), 0n);
}

type Build = { now: number; nonce?: bigint; escrow?: Hex };

// Builds the order the parties would sign, or says what blocks it. The exporter and the payout
// address come only from the verified supplier.
export function buildOrder(form: OrderForm, registry: TradeRegistry, { now, nonce = freshNonce(), escrow }: Build): BuiltOrder {
  const fields: FormField[] = [];
  const problems: NewOrderProblem[] = [];

  const { supplier, currency, incoterm } = form;
  if (!supplier) fields.push('supplier');
  if (!/^[A-Z0-9]{1,20}$/.test(form.orderNumber)) fields.push('orderNumber');
  if (!currency) fields.push('currency');
  const amount = form.amountMinor;
  if (amount === null || !Number.isSafeInteger(amount) || amount <= 0) fields.push('amount');
  if (!incoterm) fields.push('incoterm');
  if (form.hsCodes.length === 0 || !form.hsCodes.every((c) => /^[0-9]{6,10}$/.test(c))) fields.push('hsCodes');
  const deadline = form.shipmentDeadline;
  if (deadline === null || !Number.isSafeInteger(deadline) || deadline <= 0) fields.push('shipmentDeadline');
  const advance = form.advanceBps;
  if (advance === null || !Number.isInteger(advance) || advance < 0 || advance > 10_000) fields.push('advance');
  if (!form.documentHash || !/^0x[0-9a-fA-F]{64}$/.test(form.documentHash)) fields.push('documentHash');
  if (currency && currency !== TOKEN_CURRENCY) problems.push('currency_is_not_the_token');
  if (fields.length > 0 || problems.length > 0) return { kind: 'blocked', fields, problems };

  // Narrowed by the checks above
  const exporter = supplier!.exporter;
  const terms: OrderTerms = {
    orderNumber: form.orderNumber,
    currency: currency!,
    // Stays in cents of the invoice currency
    invoiceAmountMinor: BigInt(amount!),
    hsCodes: form.hsCodes,
    documentHash: form.documentHash!.toLowerCase(),
  };
  if (!OrderTermsSchema.safeParse(terms).success) return { kind: 'blocked', fields: ['orderNumber'], problems: [] };

  const po: PurchaseOrder = {
    orderId: orderIdOf(form.importer, exporter, nonce),
    importer: form.importer,
    exporter,
    payoutAddress: supplier!.payoutAddress,
    token: registry.token,
    // Cents to token units
    totalAmount: BigInt(amount!) * CENTS_TO_TOKEN_UNITS,
    advanceBps: advance!,
    shipmentDeadline: BigInt(deadline!),
    disputeWindow: BigInt(Math.round((form.disputeDays ?? DEFAULT_DISPUTE_DAYS) * 24 * 3600)),
    carrier: registry.carrier,
    arbiter: registry.arbiter,
    documentVerifier: registry.documentVerifier,
    incoterm: bytes32Text(incoterm!),
    termsHash: termsHash(terms),
    requiredDocsHash: requiredDocsHash(REQUIRED_DOCS),
    nonce,
  };
  const shape = checkOrderShape(po, { now, escrow });
  if (shape.length > 0) return { kind: 'blocked', fields: [], problems: shape };
  return { kind: 'ready', po, terms };
}
