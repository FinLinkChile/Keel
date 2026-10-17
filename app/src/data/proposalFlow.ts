import type { Hex } from '@keel/schemas';

import type { Signer } from '../wallet/signer';

import type { Proposal, ProposalStore } from './proposals';
import { checkForExporter, recoverPurchaseOrderSigner, signPurchaseOrder, type OrderCheck, type SigningSetup } from './signOrder';

// The moves of a proposal on this phone: the exporter signs first or refuses. The checks run
// again here, so a screen that skipped them still cannot get a bad order signed.

export type Move = { ok: true; proposal: Proposal } | { ok: false; checks: OrderCheck[] };

type ExporterContext = {
  signer: Signer;
  setup: SigningSetup;
  // The payout account registered for this exporter
  registeredPayout: Hex | undefined;
  now: number;
};

export async function exporterSigns(store: ProposalStore, proposal: Proposal, ctx: ExporterContext): Promise<Move> {
  if (proposal.status !== 'awaiting_exporter') return { ok: false, checks: ['changed_since_sent'] };
  const exporter = await ctx.signer.address();
  const checks = checkForExporter(proposal, proposal.proposed, {
    exporter,
    registeredPayout: ctx.registeredPayout,
    now: ctx.now,
    escrow: ctx.setup.escrow,
  });
  if (checks.length > 0) return { ok: false, checks };

  const signature = await signPurchaseOrder(ctx.signer, ctx.setup, proposal.po);
  // What the escrow will recover must be this exporter, or the signature is worthless
  const signedBy = await recoverPurchaseOrderSigner(ctx.setup, proposal.po, signature);
  if (!signedBy || signedBy.toLowerCase() !== proposal.po.exporter.toLowerCase()) {
    return { ok: false, checks: ['bad_exporter_signature'] };
  }
  const signed: Proposal = { ...proposal, status: 'awaiting_importer', exporterSignature: signature };
  await store.save(signed);
  return { ok: true, proposal: signed };
}

export async function exporterRejects(store: ProposalStore, proposal: Proposal): Promise<Proposal> {
  const rejected: Proposal = { ...proposal, status: 'rejected' };
  await store.save(rejected);
  return rejected;
}
