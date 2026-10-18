import type { Hex, OrderTerms, PurchaseOrder } from '@keel/schemas';

import type { Proposal } from '../data/proposals';

// The signed order for the servers: POST {ingestUrl}/trade/orders. [PROPUESTA] of Area 3 (open
// decision 15): ingest verifies both signatures, registers the uploaders and writes the agent's
// order.json. The route may not exist yet; sending is a courtesy and never part of signing.

// The agent's orders/<orderId>/order.json (engine/src/agent/store.ts)
export type AgentOrderFile = { order: PurchaseOrder; terms: OrderTerms; label: string; sigImporter: Hex; sigExporter: Hex };

// Undefined until both signatures exist: the agent opens the order with them (decision 17)
export function agentOrderFile(proposal: Proposal): AgentOrderFile | undefined {
  if (proposal.status !== 'signed' || !proposal.importerSignature || !proposal.exporterSignature) return undefined;
  return {
    order: proposal.po,
    terms: proposal.terms,
    label: proposal.label,
    sigImporter: proposal.importerSignature,
    sigExporter: proposal.exporterSignature,
  };
}

// Same as engine/src/canonical.ts: keys sorted, bigints as decimal text
export function canonical(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as object)
        .sort()
        .map((k) => [k, canonical((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

// not_available: ingest answered 404 (no such route yet) or is not configured
export type SendResult =
  | { kind: 'sent' }
  | { kind: 'rejected'; status: number }
  | { kind: 'not_available' }
  | { kind: 'failed' };

type Send = { ingestUrl: string | undefined; proposal: Proposal; fetchFn?: typeof fetch };

// No auth header: the two signatures of the order are the authentication
export async function sendSignedOrder({ ingestUrl, proposal, fetchFn = fetch }: Send): Promise<SendResult> {
  const file = agentOrderFile(proposal);
  if (!ingestUrl || !file) return { kind: 'not_available' };
  let res: Response;
  try {
    res = await fetchFn(`${ingestUrl.replace(/\/+$/, '')}/trade/orders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(canonical(file)),
    });
  } catch {
    return { kind: 'failed' };
  }
  if (res.status === 404) return { kind: 'not_available' };
  return res.ok ? { kind: 'sent' } : { kind: 'rejected', status: res.status };
}
