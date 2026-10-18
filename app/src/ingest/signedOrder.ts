import type { Hex, OrderTerms, PurchaseOrder } from '@keel/schemas';

import type { Proposal, ProposalStore } from '../data/proposals';

// The signed order for the servers: POST {ingestUrl}/trade/orders (T3.11,
// docs/interfaces/orden-firmada.md). Ingest verifies both signatures, registers who may upload
// the order's documents and writes the agent's order.json. Sending never blocks signing: an order
// ingest has not taken is sent again (syncSignedOrders), and the route answers the same order
// again with 200, so a repeat is harmless.

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

// not_available: ingest answered 404 (no such route) or is not configured. failed: no answer, or
// one that may pass on a retry (a timeout, a 429, a 5xx). rejected: ingest refused this order;
// `reason` is its code (unknown_importer, bad_importer_signature, conflict...).
export type SendResult =
  | { kind: 'sent' }
  | { kind: 'rejected'; status: number; reason?: string }
  | { kind: 'not_available' }
  | { kind: 'failed' };

const RETRYABLE = new Set([408, 425, 429]);

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
  if (res.ok) return { kind: 'sent' };
  if (res.status >= 500 || RETRYABLE.has(res.status)) return { kind: 'failed' };
  let reason: string | undefined;
  try {
    const body = (await res.json()) as { reason?: unknown; error?: unknown };
    const code = body.reason ?? body.error;
    if (typeof code === 'string' && /^[a-z_]{1,40}$/.test(code)) reason = code;
  } catch {
    // A refusal without a JSON body keeps only its status
  }
  return { kind: 'rejected', status: res.status, reason };
}

// Sends every signed order ingest has not taken yet, oldest first, and records the answer on the
// proposal: when ingest registered it, or why it refused it. A refused order is sent again on
// the next sync too, since the cause may be fixed on the server (an importer registered late).
// Never throws: it runs after signing and when the app opens.
export async function syncSignedOrders({
  store,
  ingestUrl,
  now,
  fetchFn = fetch,
}: {
  store: ProposalStore;
  ingestUrl: string | undefined;
  now: number;
  fetchFn?: typeof fetch;
}): Promise<{ registered: number; refused: number; pending: number }> {
  const done = { registered: 0, refused: 0, pending: 0 };
  if (!ingestUrl) return done;
  let waiting: Proposal[];
  try {
    waiting = (await store.list()).filter((p) => agentOrderFile(p) && p.ingestRegisteredAt === undefined).reverse();
  } catch {
    return done;
  }
  for (const proposal of waiting) {
    const sent = await sendSignedOrder({ ingestUrl, proposal, fetchFn });
    try {
      if (sent.kind === 'sent') {
        await store.save({ ...proposal, ingestRegisteredAt: Math.floor(now), ingestRefusal: undefined });
        done.registered += 1;
      } else if (sent.kind === 'rejected') {
        await store.save({ ...proposal, ingestRefusal: { status: sent.status, ...(sent.reason ? { reason: sent.reason } : {}) } });
        done.refused += 1;
      } else {
        done.pending += 1;
      }
    } catch {
      done.pending += 1;
    }
  }
  return done;
}
