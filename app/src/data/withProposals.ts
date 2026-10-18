import type { Order, KeelData, NeedsYou, Role } from './types';
import type { Proposal, ProposalStore } from './proposals';

// The data source plus the orders proposed on this device. An order that is only a proposal has
// no stage on chain yet: it waits for the signatures, and for the deposit once both are in.

const WAITING_ON: Partial<Record<Proposal['status'], Role>> = { awaiting_exporter: 'exporter', awaiting_importer: 'importer' };

export function proposalToOrder(p: Proposal, carrier: string): Order {
  return {
    label: p.label,
    goods: p.goods || `Order ${p.label}`,
    goodsShort: p.goods || p.label,
    // The goods line already says the quantity when the importer typed it
    quantity: '',
    carrier,
    stage: p.status === 'signed' ? 'signed' : p.status === 'rejected' ? 'rejected' : 'awaiting_signature',
    waitingOn: WAITING_ON[p.status],
    sentAt: p.sentAt,
    exporterSignedAt: p.exporterSignedAt,
    signedAt: p.status === 'signed' ? p.signedAt : undefined,
    transportDoc: 'BILL_OF_LADING',
    documents: [],
    po: p.po,
    terms: p.terms,
    quote: p.quote,
  };
}

export function withProposals(base: KeelData, store: ProposalStore): KeelData {
  const toOrder = async (p: Proposal) => proposalToOrder(p, (await base.partyByAddress(p.po.carrier))?.id ?? '');
  return {
    ...base,
    orders: async () => [...(await Promise.all((await store.list()).map(toOrder))), ...(await base.orders())],
    order: async (orderId) => {
      const proposal = await store.get(orderId);
      return proposal ? toOrder(proposal) : base.order(orderId);
    },
    // The exporter is asked to review what was sent; the importer to give the last signature
    needsYou: async (role) => {
      const mine = (await store.list()).filter((p) => WAITING_ON[p.status] === role);
      const items = mine.map((p): NeedsYou => ({ kind: 'sign_order', orderId: p.orderId }));
      return [...items, ...(await base.needsYou(role))];
    },
  };
}
