import type { Hex } from '@keel/schemas';

import type { Signer } from '../wallet/signer';

import type { Proposal, ProposalStore } from './proposals';
import {
  checkForExporter,
  checkOrder,
  orderDifferences,
  recoverPurchaseOrderSigner,
  recoverSafeOwner,
  signPurchaseOrder,
  signPurchaseOrderAsSafeOwner,
  type OrderCheck,
  type SigningSetup,
} from './signOrder';

// The moves of a proposal on this phone: the exporter signs first or refuses. The checks run
// again here, so a screen that skipped them still cannot get a bad order signed.

// `differences` names the fields that changed since the order was sent, when that is why it failed
export type Move = { ok: true; proposal: Proposal } | { ok: false; checks: OrderCheck[]; differences?: string[] };

type ExporterContext = {
  signer: Signer;
  setup: SigningSetup;
  // The payout account registered for this exporter
  registeredPayout: Hex | undefined;
  now: number;
};

export async function exporterSigns(store: ProposalStore, proposal: Proposal, ctx: ExporterContext): Promise<Move> {
  if (proposal.status !== 'awaiting_exporter') return { ok: false, checks: ['not_waiting_for_you'] };
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
  const signed: Proposal = { ...proposal, status: 'awaiting_importer', exporterSignature: signature, exporterSignedAt: Math.floor(ctx.now) };
  await store.save(signed);
  return { ok: true, proposal: signed };
}

export async function exporterRejects(store: ProposalStore, proposal: Proposal): Promise<Proposal> {
  const rejected: Proposal = { ...proposal, status: 'rejected' };
  await store.save(rejected);
  return rejected;
}

// The importer's last signature. Nothing is signed until the supplier's signature recovers to the
// supplier on this very order, and the order is the one that was sent, field by field.

export type Review = { checks: OrderCheck[]; differences: string[] };

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

// `owner` is the key of this phone that owns the importer's Safe. po.importer must be that Safe.
export async function reviewForImporter(
  proposal: Proposal,
  ctx: { owner: Hex | undefined; setup: SigningSetup | undefined; now: number },
): Promise<Review> {
  const checks = checkOrder(proposal, proposal.proposed, { now: ctx.now, escrow: ctx.setup?.escrow });
  const differences = orderDifferences(proposal, proposal.proposed);
  // Without the Safe configured the order cannot be checked against it, and signing is off anyway
  if (!ctx.owner || (ctx.setup?.safe && !same(proposal.po.importer, ctx.setup.safe))) checks.push('wrong_importer');
  if (proposal.status === 'awaiting_importer' || proposal.status === 'signed') {
    // Without the escrow the signature cannot be recovered, and signing is off anyway
    const recovered =
      proposal.exporterSignature && ctx.setup
        ? await recoverPurchaseOrderSigner(ctx.setup, proposal.po, proposal.exporterSignature)
        : undefined;
    if (!proposal.exporterSignature || (ctx.setup && (!recovered || !same(recovered, proposal.po.exporter)))) {
      checks.push('bad_exporter_signature');
    }
  }
  return { checks, differences };
}

export async function importerSigns(
  store: ProposalStore,
  proposal: Proposal,
  ctx: { signer: Signer; setup: SigningSetup; now: number },
): Promise<Move> {
  if (proposal.status !== 'awaiting_importer') return { ok: false, checks: ['not_waiting_for_you'], differences: [] };
  const owner = await ctx.signer.address();
  const safe = ctx.setup.safe;
  if (!safe) return { ok: false, checks: ['wrong_importer'], differences: [] };
  const review = await reviewForImporter(proposal, { owner, setup: ctx.setup, now: ctx.now });
  if (review.checks.length > 0) return { ok: false, ...review };

  const signature = await signPurchaseOrderAsSafeOwner(ctx.signer, ctx.setup, safe, proposal.po);
  // The key of this phone must be the one that signed; the Safe then accepts it if it is an owner
  const signedBy = await recoverSafeOwner(ctx.setup, safe, proposal.po, signature);
  if (!signedBy || !same(signedBy, owner)) return { ok: false, checks: ['wrong_importer'], differences: [] };
  const signed: Proposal = { ...proposal, status: 'signed', importerSignature: signature, signedAt: Math.floor(ctx.now) };
  await store.save(signed);
  return { ok: true, proposal: signed };
}

export async function importerRejects(store: ProposalStore, proposal: Proposal): Promise<Proposal> {
  const rejected: Proposal = { ...proposal, status: 'rejected' };
  await store.save(rejected);
  return rejected;
}
