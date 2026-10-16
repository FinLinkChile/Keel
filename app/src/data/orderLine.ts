import { formatDay, formatMinor } from '../ui/format';

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
  return days === 0 ? 'today' : days === 1 ? 'in 1 day' : `in ${days} days`;
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
      if (mine) return { status: 'Review', yourTurn: true, detail: [{ text: `${who}, ${total}` }] };
      return {
        status: role === 'exporter' ? 'Signed' : 'Sent',
        yourTurn: false,
        detail: [{ text: `${who} has to sign, ${total}` }],
      };
    case 'signed':
      if (order.blockedBy === 'supplier_check')
        return { status: 'Signed', yourTurn: false, detail: [{ text: `${who}, waits for the supplier check` }] };
      return { status: 'Signed', yourTurn: false, detail: [{ text: `${who}, waits for the deposit` }] };
    case 'advance_paid':
      if (role === 'exporter')
        return { status: 'Ship', yourTurn: mine, detail: [{ text: `${who}, ship by ${deadline}` }] };
      return { status: 'Advance paid', yourTurn: false, detail: [{ text: `${who}, ships by ${deadline}` }] };
    case 'shipped': {
      const releaseAt = Number((order.shippedAt ?? 0) + Number(order.po.disputeWindow));
      return { status: 'Shipped', yourTurn: false, detail: [{ text: `${who}, balance ${inDays(releaseAt - now)}` }] };
    }
    case 'settled':
      return { status: 'Settled', yourTurn: false, detail: [{ text: `${who}, ${formatDay(order.closedAt ?? 0)}` }] };
    case 'refunded':
      // The balance goes back to the importer; the advance stays with the exporter.
      return role === 'importer'
        ? {
            status: 'Refunded',
            yourTurn: false,
            detail: [{ text: 'No proof of shipment, ' }, { text: `${formatMinor(balance)} back to you`, money: true }],
          }
        : { status: 'Refunded', yourTurn: false, detail: [{ text: `No proof of shipment, balance back to ${who}` }] };
    case 'cancelled':
      return { status: 'Cancelled', yourTurn: false, detail: [{ text: `${who}, both agreed to cancel` }] };
  }
}
