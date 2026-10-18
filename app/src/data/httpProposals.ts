import type { Hex } from '@keel/schemas';

import type { Signer, Signers } from '../wallet/signer';

import { ApiError, isApiError, type ApiClient, type ProposalView, type ServerProposalStatus } from './api';
import { decodeOrder, proposalLabel, type Proposal, type ProposalStatus, type ProposalStore } from './proposals';
import { orderDifferences } from './signOrder';
import type { Quote, Role } from './types';

// The proposals of the Keel API (POST/GET /proposals) behind the same ProposalStore the screens
// use for the proposals kept on this phone. The flows (proposalFlow.ts) still sign and check
// everything on the phone and then `save` the next state; here a save becomes the API move that
// leads to it, signed by the wallet of the side that moves:
//
//   new proposal                          POST /proposals                      importer wallet
//   awaiting_exporter -> awaiting_importer POST …/exporter-signature           exporter wallet
//   awaiting_importer -> signed           POST …/importer-signature           importer wallet
//   awaiting_*        -> rejected         POST …/reject                       the side whose turn it was
//
// The server checks every signature again the way the escrow will. The proforma's quote is not
// part of the order and is not sent: it is kept in memory on this phone for the session only.

const STATUS: Record<ServerProposalStatus, ProposalStatus> = {
  awaiting_exporter: 'awaiting_exporter',
  awaiting_importer: 'awaiting_importer',
  fully_signed: 'signed',
  rejected: 'rejected',
};

export function proposalFromView(v: ProposalView, quote?: Quote): Proposal {
  const order = decodeOrder({ po: v.po, terms: v.terms });
  return {
    orderId: order.po.orderId,
    label: v.label ?? proposalLabel(order.terms.orderNumber),
    goods: v.goods ?? '',
    ...order,
    proposed: decodeOrder(v.proposed),
    status: STATUS[v.status],
    ...(v.sigExporter && { exporterSignature: v.sigExporter }),
    ...(v.sigImporter && { importerSignature: v.sigImporter }),
    sentAt: v.createdAt,
    ...(v.exporterSignedAt !== undefined && { exporterSignedAt: v.exporterSignedAt }),
    ...(v.importerSignedAt !== undefined && { signedAt: v.importerSignedAt }),
    ...(quote && { quote }),
  };
}

// The side that moves a proposal from `from` to `to`, and the call that does it
export type Move =
  | { kind: 'create'; side: 'importer' }
  | { kind: 'exporter_signs'; side: 'exporter'; counter: boolean }
  | { kind: 'importer_signs'; side: 'importer' }
  | { kind: 'reject'; side: Role }
  | { kind: 'none' };

export function moveOf(current: Proposal | undefined, next: Proposal): Move {
  if (!current) {
    if (next.status !== 'awaiting_exporter') throw new ApiError(409, 'wrong_status', { status: 'none' });
    return { kind: 'create', side: 'importer' };
  }
  if (current.status === next.status) return { kind: 'none' };
  if (current.status === 'awaiting_exporter' && next.status === 'awaiting_importer') {
    return { kind: 'exporter_signs', side: 'exporter', counter: orderDifferences(next, current).length > 0 };
  }
  if (current.status === 'awaiting_importer' && next.status === 'signed') return { kind: 'importer_signs', side: 'importer' };
  if ((current.status === 'awaiting_exporter' || current.status === 'awaiting_importer') && next.status === 'rejected') {
    return { kind: 'reject', side: current.status === 'awaiting_exporter' ? 'exporter' : 'importer' };
  }
  throw new ApiError(409, 'wrong_status', { status: current.status });
}

const ROLES: readonly Role[] = ['importer', 'exporter'];

// aws/src/orders/rules.ts LABEL
const SERVER_LABEL = /^[A-Z]{1,4}-[0-9]{1,6}$/;

export function httpProposalStore(api: ApiClient, signers: () => Signers): ProposalStore {
  const quotes = new Map<string, Quote>();
  const key = (orderId: Hex) => orderId.toLowerCase();
  const available = (): Signer[] => ROLES.map((r) => signers()[r]).filter((s): s is Signer => !!s);

  // A proposal as one of this phone's wallets sees it; undefined when none of them is a party
  async function fetchOne(orderId: Hex): Promise<Proposal | undefined> {
    for (const s of available()) {
      try {
        return proposalFromView(await api.getProposal(s, orderId), quotes.get(key(orderId)));
      } catch (e) {
        if (!isApiError(e, 'not_found')) throw e;
      }
    }
    return undefined;
  }

  const signerFor = (side: Role): Signer => {
    const s = signers()[side];
    if (!s) throw new ApiError(0, 'no_wallet', { side });
    return s;
  };

  return {
    // Both wallets of this phone, merged: the same phone may hold the importer and the exporter
    list: async () => {
      const byId = new Map<string, Proposal>();
      for (const s of available()) {
        for (const v of await api.listProposals(s)) byId.set(key(v.orderId), proposalFromView(v, quotes.get(key(v.orderId))));
      }
      return [...byId.values()].sort((a, b) => b.sentAt - a.sentAt);
    },
    get: fetchOne,
    save: async (next) => {
      if (next.quote) quotes.set(key(next.orderId), next.quote);
      const move = moveOf(await fetchOne(next.orderId), next);
      switch (move.kind) {
        case 'none':
          return;
        case 'create':
          await api.createProposal(signerFor('importer'), {
            po: next.po,
            terms: next.terms,
            // The server refuses a label outside its pattern; without one it derives it
            ...(SERVER_LABEL.test(next.label) && { label: next.label }),
            ...(next.goods && { goods: next.goods.slice(0, 500) }),
          });
          return;
        case 'exporter_signs':
          if (!next.exporterSignature) throw new ApiError(400, 'bad_request');
          await api.exporterSignature(signerFor('exporter'), next.orderId, {
            signature: next.exporterSignature,
            ...(move.counter && { po: next.po, terms: next.terms }),
          });
          return;
        case 'importer_signs':
          if (!next.importerSignature) throw new ApiError(400, 'bad_request');
          await api.importerSignature(signerFor('importer'), next.orderId, { signature: next.importerSignature });
          return;
        case 'reject':
          await api.rejectProposal(signerFor(move.side), next.orderId);
          return;
      }
    },
  };
}
