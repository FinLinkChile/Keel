import type { Currency, Hex, Incoterm } from '@keel/schemas';

import { PROFORMA_FIELDS, type ProformaField, type ProformaReading, type ProformaResult } from '../ingest/proforma';
import { formatDay, formatMinor } from '../ui/format';

import {
  prefillFromProforma,
  type FormField,
  type NewOrderProblem,
  type OrderForm,
  type VerifiedSupplier,
} from './newOrder';
import type { PartyId } from './types';

// What the New order screen holds and says. Pure, so it can be tested without the screen: the
// fields as the importer types them, how they become the OrderForm of buildOrder, and the words
// for everything that can go wrong. Nothing from ingest is shown except what is mapped here.

export type AdvanceChoice = '0' | '30' | '50' | 'other';

export type ScreenForm = {
  // The importer picks the supplier; the proforma never names anyone
  supplierId: PartyId | null;
  // Descriptive only: it is not part of the signed terms
  goods: string;
  orderNumber: string;
  currency: Currency | null;
  amountText: string;
  dayText: string;
  hsText: string;
  advance: AdvanceChoice | null;
  advanceOther: string;
  incoterm: Incoterm | null;
};

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// "PO-0157" is the label of the order with nonce 0x157; the next number is PO0158 (orderNumber
// has no dash). The first order of a new importer is PO0001.
export function nextOrderNumber(labels: readonly string[]): string {
  let highest = 0;
  for (const label of labels) {
    const match = /^PO-([0-9a-f]{1,8})$/i.exec(label);
    if (match) highest = Math.max(highest, parseInt(match[1], 16));
  }
  return 'PO' + (highest + 1).toString(16).toUpperCase().padStart(4, '0');
}

// "48,000.00" -> 4800000 (cents). null when it is not an amount with at most 2 decimals.
export function parseAmount(text: string): number | null {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text.replace(/[,\s]/g, ''));
  if (!match) return null;
  const cents = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  return Number.isSafeInteger(cents) ? cents : null;
}

export const formatCents = (cents: number | null): string => (cents === null ? '' : formatMinor(BigInt(cents)));

// "Nov 20, 2026", "20 Nov 2026" or "2026-11-20" -> unix seconds at midnight UTC, or null
export function parseDay(text: string): number | null {
  const t = text.trim();
  let y: number, m: number, d: number;
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (match) {
    [y, m, d] = [Number(match[1]), Number(match[2]) - 1, Number(match[3])];
  } else if ((match = /^([A-Za-z]{3,9})\.? (\d{1,2}),? (\d{4})$/.exec(t))) {
    [y, m, d] = [Number(match[3]), MONTHS.indexOf(match[1].slice(0, 3).toLowerCase()), Number(match[2])];
  } else if ((match = /^(\d{1,2}) ([A-Za-z]{3,9})\.? (\d{4})$/.exec(t))) {
    [y, m, d] = [Number(match[3]), MONTHS.indexOf(match[2].slice(0, 3).toLowerCase()), Number(match[1])];
  } else {
    return null;
  }
  if (m < 0) return null;
  const ms = Date.UTC(y, m, d);
  const check = new Date(ms);
  // Rejects Feb 30 and the like
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m || check.getUTCDate() !== d) return null;
  return ms / 1000;
}

// Unix seconds -> "Nov 20, 2026" (UTC day, like the contract)
export function formatFullDay(unixSeconds: number | null): string {
  if (unixSeconds === null) return '';
  const d = new Date(unixSeconds * 1000);
  return `${MONTH_LABELS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

// "1302.31, 350300" -> ["130231", "350300"]. Whether each is a valid code is up to buildOrder.
export function parseHsCodes(text: string): string[] {
  return text
    .split(/[\s,;]+/)
    .map((c) => c.replace(/\./g, ''))
    .filter((c) => c !== '');
}

export const formatHsCodes = (codes: readonly string[]): string => codes.join(', ');

// "40" or "12.5%" -> 4000 or 1250 basis points
export function parsePercent(text: string): number | null {
  const match = /^(\d{1,3}(?:\.\d{1,2})?)\s*%?$/.exec(text.trim());
  if (!match) return null;
  const bps = Math.round(Number(match[1]) * 100);
  return bps <= 10_000 ? bps : null;
}

const formatPercent = (bps: number): string =>
  (bps / 100).toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');

export function advanceFrom(bps: number | null): Pick<ScreenForm, 'advance' | 'advanceOther'> {
  if (bps === null) return { advance: null, advanceOther: '' };
  if (bps === 0) return { advance: '0', advanceOther: '' };
  if (bps === 3000) return { advance: '30', advanceOther: '' };
  if (bps === 5000) return { advance: '50', advanceOther: '' };
  return { advance: 'other', advanceOther: formatPercent(bps) };
}

export function advanceBpsOf(form: Pick<ScreenForm, 'advance' | 'advanceOther'>): number | null {
  switch (form.advance) {
    case null:
      return null;
    case '0':
      return 0;
    case '30':
      return 3000;
    case '50':
      return 5000;
    case 'other':
      return parsePercent(form.advanceOther);
  }
}

// What is paid when both sign and when the shipment is proven, in cents
export function advanceSplit(totalCents: number, bps: number): { onSigning: bigint; onShipment: bigint } {
  const onSigning = (BigInt(totalCents) * BigInt(bps)) / 10_000n;
  return { onSigning, onShipment: BigInt(totalCents) - onSigning };
}

// The form as the reading fills it. Only what the proforma printed; the rest stays empty.
export function screenFormFrom(reading: ProformaReading | undefined, orderNumber: string): ScreenForm {
  const empty: ScreenForm = {
    supplierId: null,
    goods: '',
    orderNumber,
    currency: null,
    amountText: '',
    dayText: '',
    hsText: '',
    advance: null,
    advanceOther: '',
    incoterm: null,
  };
  if (!reading) return empty;
  const p = prefillFromProforma(reading);
  return {
    ...empty,
    currency: p.currency ?? null,
    amountText: formatCents(p.amountMinor ?? null),
    dayText: formatFullDay(p.shipmentDeadline ?? null),
    hsText: formatHsCodes(p.hsCodes ?? []),
    ...advanceFrom(p.advanceBps ?? null),
    incoterm: p.incoterm ?? null,
  };
}

// The OrderForm buildOrder takes. The payee comes only from the chosen verified supplier.
export function toOrderForm(
  form: ScreenForm,
  context: { importer: Hex; supplier: VerifiedSupplier | undefined; documentHash: Hex | null },
): OrderForm {
  return {
    importer: context.importer,
    supplier: context.supplier,
    orderNumber: form.orderNumber.trim().toUpperCase(),
    currency: form.currency,
    amountMinor: parseAmount(form.amountText),
    incoterm: form.incoterm,
    hsCodes: parseHsCodes(form.hsText),
    shipmentDeadline: parseDay(form.dayText),
    advanceBps: advanceBpsOf(form),
    documentHash: context.documentHash,
  };
}

// The fields of the proforma the form has an input for. Ports, the proforma number and the issue
// date have none.
const FORM_FIELD_OF: Partial<Record<ProformaField, FormField>> = {
  currency: 'currency',
  amount_minor: 'amount',
  incoterm: 'incoterm',
  hs_codes: 'hsCodes',
  latest_shipment_date: 'shipmentDeadline',
  advance_bps: 'advance',
};

export function missingOnProforma(missing: readonly ProformaField[]): FormField[] {
  return missing.flatMap((f) => FORM_FIELD_OF[f] ?? []);
}

// "Known, 4 orders": how many orders the importer already has with the supplier
export function knownLine(orders: number): string {
  if (orders <= 0) return 'Known supplier';
  return orders === 1 ? 'Known, 1 order' : `Known, ${orders} orders`;
}

// "Uploaded. The agent read 9 terms.": the fields of the reading that the proforma printed
export function termsReadLine(reading: ProformaReading): string {
  // The lines are not a term of the order
  const read = PROFORMA_FIELDS.filter((f) => f !== 'lines').length - reading.missing.filter((f) => f !== 'lines').length;
  return `Uploaded. The agent read ${read} ${read === 1 ? 'term' : 'terms'}.`;
}

// "Nov 20, CIF"; either part may be missing
export function shipByLine(form: Pick<ScreenForm, 'dayText' | 'incoterm'>): string {
  const day = parseDay(form.dayText);
  return [day === null ? '' : formatDay(day), form.incoterm ?? ''].filter(Boolean).join(', ');
}

export const NOT_ON_PROFORMA = 'Not on the proforma, fill it in';

// Under a field the form blocked on
export const FIELD_WORDS: Record<FormField, string> = {
  supplier: 'Choose a supplier from your book',
  orderNumber: 'Use up to 20 letters and digits',
  currency: 'Choose the currency',
  amount: 'Enter the total, for example 48,000.00',
  incoterm: 'Choose an incoterm',
  hsCodes: 'Enter at least one HS code of 6 to 10 digits',
  shipmentDeadline: 'Enter the date, for example Nov 20, 2026',
  advance: 'Enter a percentage from 0 to 100',
  documentHash: 'Add the proforma first',
};

// What the escrow, or the USD-only rule, would refuse
export const PROBLEM_WORDS: Record<NewOrderProblem, string> = {
  bad_order_id: 'The order number does not match the parties. Try again',
  missing_address: 'An address of this order is missing',
  same_parties: 'The supplier is your own company',
  third_party_not_independent: 'This supplier shares a wallet with the carrier, the arbiter or the verifier',
  escrow_as_party: 'The escrow cannot be a party of its own order',
  bad_advance: 'The advance must be between 0% and 100%',
  bad_amount: 'The total is not valid',
  deadline_passed: 'The shipment date has already passed',
  currency_is_not_the_token: 'Only USD orders can be signed for now',
};

// What the screen says when the proforma did not come back as a reading. `byHand` lets the
// importer go on and fill the form; the others go back to choosing a file.
export type ProformaNotice = { text: string; byHand: boolean };

export function proformaNotice(outcome: Exclude<ProformaResult, { kind: 'read' }> | 'denied'): ProformaNotice {
  if (outcome === 'denied') {
    return { text: "The camera is off for Keel. Turn it on in the phone's settings, or choose a file.", byHand: false };
  }
  switch (outcome.kind) {
    case 'unreadable':
      return { text: 'The agent could not read this file. Fill in the terms by hand.', byHand: true };
    case 'rejected':
      switch (outcome.reason) {
        case 'too_large':
          return { text: 'The file is too large. Photos up to 5 MB, PDFs up to 10 MB.', byHand: false };
        case 'unsupported_media':
          return { text: 'Use a PDF, or a JPEG, PNG or WebP photo.', byHand: false };
        case 'bad_signature':
        case 'stale_signature':
          return { text: "Check the phone's date and time, then try again.", byHand: false };
        case 'not_an_importer':
          return { text: "This wallet can't upload a proforma.", byHand: false };
        case 'rate_limited':
          return { text: 'Too many proformas today. Try again tomorrow.', byHand: false };
        case 'invalid_request':
          return { text: 'The file could not be sent, try again.', byHand: false };
      }
      break;
    case 'failed':
      switch (outcome.reason) {
        case 'not_configured':
          return { text: 'Proforma reading is not set up in this app.', byHand: false };
        case 'network':
          return { text: "Couldn't reach Keel, check the connection.", byHand: false };
        case 'server':
          return { text: 'Something went wrong on our side, try again.', byHand: false };
      }
  }
}

// Warnings next to the proforma row. They never fill anything.
export const WARNING_ACCOUNT_CHANGE =
  'This proforma announces a new bank account. It is ignored: the payout account comes from your supplier book.';
export const WARNING_HIDDEN_TEXT = 'This file has text that seems meant for an AI, not for you. Check every term.';
