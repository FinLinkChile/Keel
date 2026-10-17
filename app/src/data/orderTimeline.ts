import { formatDay, formatLocalDay, formatMinor } from '../ui/format';

import { tokenToCents } from './amounts';
import type { Proposal } from './proposals';
import type { Order, Party } from './types';

// 05 Order in progress, for the importer: where the money is and what happens next, from the
// stage and dates the data layer really has. Pure, so the words are tested. Nothing is invented:
// a date that is not known is left out, and a record or transaction link needs the chain.

export type TimelineItem = {
  key: string;
  title: string;
  detail?: string;
  // stopped: the order was rejected and goes no further
  state: 'done' | 'current' | 'todo' | 'stopped';
  // The step needs the importer: it leads to the review where the last signature is given
  action?: 'review';
  // Right side: a countdown, or an amount
  trailing?: { text: string; tone: 'money' | 'muted' | 'plain' };
};

const DAY = 24 * 3600;

const days = (seconds: number) => {
  const n = Math.max(0, Math.ceil(seconds / DAY));
  return n === 0 ? 'today' : n === 1 ? 'in 1 day' : `in ${n} days`;
};

const join = (...parts: (string | undefined)[]) => parts.filter(Boolean).join(', ');

// Amounts of an order in cents of its currency
function split(order: Order) {
  const total = tokenToCents(order.po.totalAmount);
  const advance = tokenToCents((order.po.totalAmount * BigInt(order.po.advanceBps)) / 10_000n);
  return { total, advance, balance: total - advance };
}

const FUNDED: Order['stage'][] = ['advance_paid', 'shipped', 'settled', 'refunded'];

export function importerTimeline(order: Order, supplier: Party, carrier: Party, now: number): TimelineItem[] {
  const who = supplier.short;
  const { total, advance, balance } = split(order);
  const deadline = formatDay(order.po.shipmentDeadline);
  const day = (t?: number) => (t === undefined ? undefined : formatDay(t));
  const funded = FUNDED.includes(order.stage) || order.advancePaidAt !== undefined;
  const items: TimelineItem[] = [];

  // 1. The signatures
  if (order.stage === 'awaiting_signature') {
    items.push({
      key: 'signed',
      title: order.waitingOn === 'importer' ? 'Waiting for your signature' : `Waiting for ${who} to sign`,
      detail: order.waitingOn === 'importer' ? `${who} signed. Yours is the last one.` : 'You sign last, after them.',
      state: 'current',
    });
  } else {
    items.push({ key: 'signed', title: 'Signed by both', detail: day(order.signedAt), state: 'done' });
  }

  // 2. The deposit
  items.push({
    key: 'locked',
    title: 'Locked in escrow',
    detail: funded
      ? join(day(order.advancePaidAt), 'by the agent')
      : order.stage === 'signed'
        ? order.blockedBy === 'supplier_check'
          ? 'Waiting for the supplier check'
          : 'Waiting to be opened in the escrow'
        : 'After both of you sign',
    state: funded ? 'done' : order.stage === 'signed' ? 'current' : 'todo',
    trailing: { text: formatMinor(total), tone: 'muted' },
  });

  if (order.stage === 'cancelled') {
    items.push({ key: 'cancelled', title: 'Cancelled together', detail: day(order.closedAt), state: 'done' });
    return items;
  }

  // 3. The advance, paid by the contract when the order opens
  if (order.po.advanceBps > 0) {
    items.push({
      key: 'advance',
      title: `Advance paid to ${who}`,
      detail: funded ? join(day(order.advancePaidAt), 'by the contract') : 'When the order is opened',
      state: funded ? 'done' : 'todo',
      trailing: { text: formatMinor(advance), tone: funded ? 'money' : 'muted' },
    });
  }

  // 4. The shipment
  if (order.stage === 'advance_paid') {
    const left = Math.max(0, Math.ceil((Number(order.po.shipmentDeadline) - now) / DAY));
    items.push({
      key: 'shipment',
      title: 'Waiting for the shipment',
      detail: `${carrier.short} has to confirm the goods are on board by ${deadline}. ${who} uploads the bill of lading and invoice. Nothing for you to do.`,
      state: 'current',
      trailing: { text: left === 1 ? '1 day left' : `${left} days left`, tone: 'plain' },
    });
  } else if (order.stage === 'shipped' || order.stage === 'settled') {
    items.push({ key: 'shipment', title: `Shipment proven by ${carrier.short}`, detail: day(order.shippedAt), state: 'done' });
  } else if (order.stage === 'refunded') {
    items.push({ key: 'shipment', title: 'No proof of shipment', detail: join(`by ${deadline}`, day(order.closedAt)), state: 'done' });
  } else {
    items.push({ key: 'shipment', title: 'Shipment', detail: `On board by ${deadline}`, state: 'todo' });
  }

  // 5. The balance
  if (order.stage === 'settled') {
    items.push({ key: 'balance', title: `Balance paid to ${who}`, detail: day(order.closedAt), state: 'done', trailing: { text: formatMinor(balance), tone: 'money' } });
  } else if (order.stage === 'shipped') {
    const releaseAt = Number((order.shippedAt ?? 0) + Number(order.po.disputeWindow));
    items.push({
      key: 'balance',
      title: `Balance to ${who}`,
      detail: `Paid ${days(releaseAt - now)}, after the dispute window`,
      state: 'current',
      trailing: { text: formatMinor(balance), tone: 'plain' },
    });
  } else if (order.stage === 'refunded') {
    items.push({ key: 'balance', title: 'Balance returned to you', detail: day(order.closedAt), state: 'done', trailing: { text: formatMinor(balance), tone: 'money' } });
  } else {
    items.push({ key: 'balance', title: `Balance paid to ${who}`, detail: 'After the shipment is proven', state: 'todo', trailing: { text: formatMinor(balance), tone: 'muted' } });
  }
  return items;
}

export type OrderAmounts = {
  total: bigint;
  // Already with the supplier
  paid: bigint;
  // Still in the escrow
  locked: bigint;
  // Back with the importer
  returned: bigint;
};

// Where the money of an order is, in cents. undefined when the order has no money yet or the
// split is not known (a cancellation splits by agreement, which the app does not see).
export function orderAmounts(order: Order): OrderAmounts | undefined {
  const { total, advance, balance } = split(order);
  switch (order.stage) {
    case 'advance_paid':
    case 'shipped':
      return { total, paid: advance, locked: balance, returned: 0n };
    case 'settled':
      return { total, paid: total, locked: 0n, returned: 0n };
    case 'refunded':
      return { total, paid: advance, locked: 0n, returned: balance };
    default:
      return undefined;
  }
}

// A mock order that is waiting for a signature here: it was not created on this phone, so there
// is no signature to give and none is faked
export const NOT_ON_THIS_PHONE = 'This demo order was not created on this phone, so it cannot be signed here.';

// The same timeline for an order proposed on this phone: it follows the signatures, which the
// phone really holds, and the steps after them wait for the escrow, with no dates.
export function proposalTimeline(proposal: Proposal, supplier: Party): TimelineItem[] {
  const who = supplier.short;
  const { po } = proposal;
  const { balance } = split({ po } as Order);
  const deadline = formatDay(po.shipmentDeadline);
  const status = proposal.status;
  const items: TimelineItem[] = [{ key: 'sent', title: 'Order sent', detail: formatLocalDay(proposal.sentAt), state: 'done' }];

  const exporterSigned = status === 'awaiting_importer' || status === 'signed' || (status === 'rejected' && !!proposal.exporterSignature);
  items.push({
    key: 'exporter',
    title: `${who} signs`,
    detail: exporterSigned ? (proposal.exporterSignedAt ? formatLocalDay(proposal.exporterSignedAt) : 'Signed') : 'They check the terms and sign first.',
    state: exporterSigned ? 'done' : status === 'rejected' ? 'todo' : 'current',
  });

  if (status === 'rejected') {
    items.push({ key: 'rejected', title: 'Rejected', detail: 'The order was not signed by both. Nothing was paid.', state: 'stopped' });
    return items;
  }

  items.push({
    key: 'importer',
    title: 'You sign',
    detail:
      status === 'signed'
        ? proposal.signedAt
          ? formatLocalDay(proposal.signedAt)
          : 'Signed'
        : status === 'awaiting_importer'
          ? `${who} signed. Yours is the last signature.`
          : 'After them, and that is when the agent deposits.',
    state: status === 'signed' ? 'done' : status === 'awaiting_importer' ? 'current' : 'todo',
    action: status === 'awaiting_importer' ? 'review' : undefined,
  });
  items.push({ key: 'open', title: 'Opened in the escrow, advance paid', detail: 'Waits for the escrow to be opened', state: 'todo' });
  items.push({ key: 'shipment', title: `Shipment and documents by ${deadline}`, state: 'todo' });
  items.push({
    key: 'balance',
    title: `Balance paid to ${who}`,
    detail: 'After the shipment is proven',
    state: 'todo',
    trailing: { text: formatMinor(balance), tone: 'muted' },
  });
  return items;
}
