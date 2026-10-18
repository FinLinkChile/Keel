import { formatDay, formatMinor } from '../ui/format';
import { t } from '../i18n/translate';

import { tokenToCents } from './amounts';
import type { Order, OrderStage, Party, Role } from './types';

// What a row of 14 Orders says about one order, in words. Pure, so the copy is tested and
// no internal stage name can reach the screen.

export type Segment = { text: string; money?: boolean };

export type OrderLine = {
  status: string;
  // Yellow dot only when the next move is yours
  yourTurn: boolean;
  // Line under the title; a money segment is drawn in green (funds that came back to you)
  detail: Segment[];
};

const CLOSED: readonly OrderStage[] = ['settled', 'refunded', 'cancelled'];

export const isClosed = (order: Order) => CLOSED.includes(order.stage);

const DAY = 24 * 3600;

// Unix seconds -> "today", "in 1 day", "in 2 days"
function inDays(seconds: number): string {
  const days = Math.max(0, Math.ceil(seconds / DAY));
  return days === 0 ? t('today') : days === 1 ? t('in 1 day') : t('in {n} days', { n: days });
}

export function orderLine(order: Order, role: Role, counterparty: Party, now: number): OrderLine {
  const who = counterparty.short;
  const total = formatMinor(tokenToCents(order.po.totalAmount));
  const balance = tokenToCents(order.po.totalAmount - (order.po.totalAmount * BigInt(order.po.advanceBps)) / 10_000n);
  const deadline = formatDay(order.po.shipmentDeadline);
  const mine = order.waitingOn === role;

  switch (order.stage) {
    // The importer sends the order, the exporter signs first and the importer signs last (03c).
    case 'awaiting_signature':
      if (mine) return { status: t('Review'), yourTurn: true, detail: [{ text: `${who}, ${total}` }] };
      return {
        status: role === 'exporter' ? t('Signed') : t('Sent'),
        yourTurn: false,
        detail: [{ text: t('{name} has to sign, {total}', { name: who, total }) }],
      };
    case 'signed':
      if (order.blockedBy === 'supplier_check')
        return { status: t('Signed'), yourTurn: false, detail: [{ text: t('{name}, waits for the supplier check', { name: who }) }] };
      return { status: t('Signed'), yourTurn: false, detail: [{ text: t('{name}, signed by both, waiting to open', { name: who }) }] };
    case 'advance_paid':
      if (role === 'exporter')
        return { status: t('Ship'), yourTurn: mine, detail: [{ text: t('{name}, ship by {date}', { name: who, date: deadline }) }] };
      return { status: t('Advance paid'), yourTurn: false, detail: [{ text: t('{name}, ships by {date}', { name: who, date: deadline }) }] };
    case 'shipped': {
      const releaseAt = Number((order.shippedAt ?? 0) + Number(order.po.disputeWindow));
      return { status: t('Shipped'), yourTurn: false, detail: [{ text: t('{name}, balance {when}', { name: who, when: inDays(releaseAt - now) }) }] };
    }
    case 'settled':
      return { status: t('Settled'), yourTurn: false, detail: [{ text: `${who}, ${formatDay(order.closedAt ?? 0)}` }] };
    case 'refunded':
      // The balance goes back to the importer; the advance stays with the exporter.
      return role === 'importer'
        ? {
            status: t('Refunded'),
            yourTurn: false,
            detail: [{ text: t('No proof of shipment, ') }, { text: t('{amount} back to you', { amount: formatMinor(balance) }), money: true }],
          }
        : { status: t('Refunded'), yourTurn: false, detail: [{ text: t('No proof of shipment, balance back to {name}', { name: who }) }] };
    case 'rejected':
      return role === 'importer'
        ? { status: t('Rejected'), yourTurn: false, detail: [{ text: t('{name} did not sign, {total}', { name: who, total }) }] }
        : { status: t('Rejected'), yourTurn: false, detail: [{ text: t('You did not sign, {total}', { total }) }] };
    case 'cancelled':
      return { status: t('Cancelled'), yourTurn: false, detail: [{ text: t('{name}, both agreed to cancel', { name: who }) }] };
  }
}
