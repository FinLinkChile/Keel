import { formatDay, formatLocalDay, formatMinor } from '../ui/format';
import { t } from '../i18n/translate';

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
  return n === 0 ? t('today') : n === 1 ? t('in 1 day') : t('in {n} days', { n });
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
  const day = (at?: number) => (at === undefined ? undefined : formatDay(at));
  const funded = FUNDED.includes(order.stage) || order.advancePaidAt !== undefined;
  const items: TimelineItem[] = [];

  // 1. The signatures
  if (order.stage === 'awaiting_signature') {
    items.push({
      key: 'signed',
      title: order.waitingOn === 'importer' ? t('Waiting for your signature') : t('Waiting for {name} to sign', { name: who }),
      detail: order.waitingOn === 'importer' ? t('{name} signed. Yours is the last one.', { name: who }) : t('You sign last, after them.'),
      state: 'current',
    });
  } else {
    items.push({ key: 'signed', title: t('Signed by both'), detail: day(order.signedAt), state: 'done' });
  }

  // 2. The deposit
  items.push({
    key: 'locked',
    title: t('Locked in escrow'),
    detail: funded
      ? join(day(order.advancePaidAt), t('by the agent'))
      : order.stage === 'signed'
        ? order.blockedBy === 'supplier_check'
          ? t('Waiting for the supplier check')
          : t('Waiting to be opened in the escrow')
        : t('After both of you sign'),
    state: funded ? 'done' : order.stage === 'signed' ? 'current' : 'todo',
    trailing: { text: formatMinor(total), tone: 'muted' },
  });

  if (order.stage === 'cancelled') {
    items.push({ key: 'cancelled', title: t('Cancelled together'), detail: day(order.closedAt), state: 'done' });
    return items;
  }

  // 3. The advance, paid by the contract when the order opens
  if (order.po.advanceBps > 0) {
    items.push({
      key: 'advance',
      title: t('Advance paid to {name}', { name: who }),
      detail: funded ? join(day(order.advancePaidAt), t('by the contract')) : t('When the order is opened'),
      state: funded ? 'done' : 'todo',
      trailing: { text: formatMinor(advance), tone: funded ? 'money' : 'muted' },
    });
  }

  // 4. The shipment
  if (order.stage === 'advance_paid') {
    const left = Math.max(0, Math.ceil((Number(order.po.shipmentDeadline) - now) / DAY));
    items.push({
      key: 'shipment',
      title: t('Waiting for the shipment'),
      detail: t('{carrier} has to confirm the goods are on board by {date}. {name} uploads the bill of lading and invoice. Nothing for you to do.', { carrier: carrier.short, date: deadline, name: who }),
      state: 'current',
      trailing: { text: left === 1 ? t('1 day left') : t('{n} days left', { n: left }), tone: 'plain' },
    });
  } else if (order.stage === 'shipped' || order.stage === 'settled') {
    items.push({ key: 'shipment', title: t('Shipment proven by {name}', { name: carrier.short }), detail: day(order.shippedAt), state: 'done' });
  } else if (order.stage === 'refunded') {
    items.push({ key: 'shipment', title: t('No proof of shipment'), detail: join(t('by {date}', { date: deadline }), day(order.closedAt)), state: 'done' });
  } else {
    items.push({ key: 'shipment', title: t('Shipment'), detail: t('On board by {date}', { date: deadline }), state: 'todo' });
  }

  // 5. The balance
  if (order.stage === 'settled') {
    items.push({ key: 'balance', title: t('Balance paid to {name}', { name: who }), detail: day(order.closedAt), state: 'done', trailing: { text: formatMinor(balance), tone: 'money' } });
  } else if (order.stage === 'shipped') {
    const releaseAt = Number((order.shippedAt ?? 0) + Number(order.po.disputeWindow));
    items.push({
      key: 'balance',
      title: t('Balance to {name}', { name: who }),
      detail: t('Paid {when}, after the dispute window', { when: days(releaseAt - now) }),
      state: 'current',
      trailing: { text: formatMinor(balance), tone: 'plain' },
    });
  } else if (order.stage === 'refunded') {
    items.push({ key: 'balance', title: t('Balance returned to you'), detail: day(order.closedAt), state: 'done', trailing: { text: formatMinor(balance), tone: 'money' } });
  } else {
    items.push({ key: 'balance', title: t('Balance paid to {name}', { name: who }), detail: t('After the shipment is proven'), state: 'todo', trailing: { text: formatMinor(balance), tone: 'muted' } });
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
  const items: TimelineItem[] = [{ key: 'sent', title: t('Order sent'), detail: formatLocalDay(proposal.sentAt), state: 'done' }];

  const exporterSigned = status === 'awaiting_importer' || status === 'signed' || (status === 'rejected' && !!proposal.exporterSignature);
  items.push({
    key: 'exporter',
    title: t('{name} signs', { name: who }),
    detail: exporterSigned ? (proposal.exporterSignedAt ? formatLocalDay(proposal.exporterSignedAt) : t('Signed')) : t('They check the terms and sign first.'),
    state: exporterSigned ? 'done' : status === 'rejected' ? 'todo' : 'current',
  });

  if (status === 'rejected') {
    items.push({ key: 'rejected', title: t('Rejected'), detail: t('The order was not signed by both. Nothing was paid.'), state: 'stopped' });
    return items;
  }

  items.push({
    key: 'importer',
    title: t('You sign'),
    detail:
      status === 'signed'
        ? proposal.signedAt
          ? formatLocalDay(proposal.signedAt)
          : t('Signed')
        : status === 'awaiting_importer'
          ? t('{name} signed. Yours is the last signature.', { name: who })
          : t('After them, and that is when the agent deposits.'),
    state: status === 'signed' ? 'done' : status === 'awaiting_importer' ? 'current' : 'todo',
    action: status === 'awaiting_importer' ? 'review' : undefined,
  });
  items.push({ key: 'open', title: t('Opened in the escrow, advance paid'), detail: t('Waits for the escrow to be opened'), state: 'todo' });
  items.push({ key: 'shipment', title: t('Shipment and documents by {date}', { date: deadline }), state: 'todo' });
  items.push({
    key: 'balance',
    title: t('Balance paid to {name}', { name: who }),
    detail: t('After the shipment is proven'),
    state: 'todo',
    trailing: { text: formatMinor(balance), tone: 'muted' },
  });
  return items;
}
