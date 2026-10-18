import type { Hex, OrderTerms, PurchaseOrder } from '@keel/schemas';

import type { Quote } from './types';

// An order the importer sent to the exporter, kept on this device while it waits for both
// signatures. Nothing here is secret (the signatures are public once given), so it is a plain
// file and not SecureStore. No backend: the order travels importer, exporter, importer on the
// same phone.

export type ProposalStatus = 'awaiting_exporter' | 'awaiting_importer' | 'signed' | 'rejected';

export type Proposal = {
  orderId: Hex;
  // "PO-0158", from the order number
  label: string;
  // Descriptive text typed by the importer; not part of the signed terms
  goods: string;
  po: PurchaseOrder;
  terms: OrderTerms;
  // The order exactly as the importer sent it. po and terms above are what the exporter signed;
  // the importer compares both before the last signature, so a change in between is caught.
  proposed: { po: PurchaseOrder; terms: OrderTerms };
  status: ProposalStatus;
  exporterSignature?: Hex;
  importerSignature?: Hex;
  // Unix seconds
  sentAt: number;
  exporterSignedAt?: number;
  signedAt?: number;
  // What the proforma asked for, to compare with what was agreed
  quote?: Quote;
};

// "PO0158" -> "PO-0158"
export const proposalLabel = (orderNumber: string): string => orderNumber.replace(/^PO(?=[0-9A-F])/, 'PO-');

const copyOrder = ({ po, terms }: { po: PurchaseOrder; terms: OrderTerms }) => ({ po: { ...po }, terms: { ...terms, hsCodes: [...terms.hsCodes] } });

// The proposal the importer sends: awaiting the exporter, with the order frozen as `proposed`
export function newProposal(order: { po: PurchaseOrder; terms: OrderTerms }, goods: string, now: number, quote?: Quote): Proposal {
  return {
    orderId: order.po.orderId,
    label: proposalLabel(order.terms.orderNumber),
    goods: goods.trim(),
    ...copyOrder(order),
    proposed: copyOrder(order),
    status: 'awaiting_exporter',
    sentAt: Math.floor(now),
    ...(quote ? { quote } : {}),
  };
}

export interface ProposalStore {
  // Newest first
  list(): Promise<Proposal[]>;
  get(orderId: Hex): Promise<Proposal | undefined>;
  // Adds the proposal, or replaces the one with the same orderId
  save(proposal: Proposal): Promise<void>;
}

// A text file: the phone's document directory, a browser's storage, or memory in tests
export interface TextFile {
  read(): Promise<string | null>;
  write(text: string): Promise<void>;
}

// bigints go as decimal text, like the canonical JSON of the engine
const BIG_ORDER = ['totalAmount', 'shipmentDeadline', 'disputeWindow', 'nonce'] as const;

type Raw = Record<string, unknown>;

function encodeOrder({ po, terms }: { po: PurchaseOrder; terms: OrderTerms }): Raw {
  const rawPo: Raw = { ...po };
  for (const k of BIG_ORDER) rawPo[k] = po[k].toString();
  return { po: rawPo, terms: { ...terms, invoiceAmountMinor: terms.invoiceAmountMinor.toString() } };
}

function decodeOrder(raw: Raw): { po: PurchaseOrder; terms: OrderTerms } {
  const rawPo = { ...(raw.po as Raw) };
  for (const k of BIG_ORDER) rawPo[k] = BigInt(rawPo[k] as string);
  const terms = { ...(raw.terms as Raw) };
  terms.invoiceAmountMinor = BigInt(terms.invoiceAmountMinor as string);
  return { po: rawPo as unknown as PurchaseOrder, terms: terms as unknown as OrderTerms };
}

export function encodeProposal(p: Proposal): Raw {
  return { ...p, ...encodeOrder(p), proposed: encodeOrder(p.proposed) };
}

export function decodeProposal(raw: Raw): Proposal {
  return { ...(raw as unknown as Proposal), ...decodeOrder(raw), proposed: decodeOrder(raw.proposed as Raw) };
}

// The store over a text file: { version: 1, proposals: [...] }
export function jsonProposalStore(file: TextFile): ProposalStore {
  const load = async (): Promise<Proposal[]> => {
    const text = await file.read();
    if (!text) return [];
    return ((JSON.parse(text) as { proposals: Raw[] }).proposals ?? []).map(decodeProposal);
  };
  // Saves run one after the other, so two quick saves cannot overwrite each other
  let queue: Promise<unknown> = Promise.resolve();
  return {
    list: async () => (await load()).sort((a, b) => b.sentAt - a.sentAt),
    get: async (orderId) => (await load()).find((p) => p.orderId === orderId),
    save: (proposal) => {
      const run = queue.then(async () => {
        const others = (await load()).filter((p) => p.orderId !== proposal.orderId);
        await file.write(JSON.stringify({ version: 1, proposals: [...others, proposal].map(encodeProposal) }, null, 2));
      });
      queue = run.catch(() => undefined);
      return run;
    },
  };
}

// For tests: an empty file in memory
export function memoryProposalStore(initial?: string): { store: ProposalStore; file: TextFile & { text: () => string | null } } {
  let text: string | null = initial ?? null;
  const file = { read: async () => text, write: async (t: string) => void (text = t), text: () => text };
  return { store: jsonProposalStore(file), file };
}

// Lets screens reload when a proposal changes
export function observedStore(store: ProposalStore, onChange: () => void): ProposalStore {
  return {
    ...store,
    save: async (proposal) => {
      await store.save(proposal);
      onChange();
    },
  };
}
