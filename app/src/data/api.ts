import { API_HEADERS, type Hex, type OrderTerms, type PurchaseOrder, type RequiredDocType, type ShipmentAttestation } from '@keel/schemas';
import { apiRequestTypedData } from '@keel/schemas/hash';

import type { Signer } from '../wallet/signer';

// Client of the Keel API on AWS (aws/src/handlers). Every route except GET /trade-setup takes a
// signed ApiRequest (docs/interfaces/autenticacion-api.md): the wallet of the person signs the
// method, the path, the hash of the exact body and the time, in the off-chain domain "Keel
// Ingest". It says who asks; it moves nothing. The typed data comes from @keel/schemas/hash, the
// same builder as aws/src/auth.ts, so the app does not import the aws package.
//
// Wire format (aws/src/orders/codec.ts): every uint above 32 bits as a decimal string, advanceBps
// as a number, addresses and bytes32 as 0x hex. Bodies are strict on the server: an unknown field
// is a 400, so nothing but the documented fields is ever sent.

type Raw = Record<string, unknown>;

// What the server answers when it refuses: its error code (docs/interfaces/eventos-y-errores.md)
// and any extra fields (state, cancelNonce, problems). `network` when the server was not reached.
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly extra: Raw = {},
  ) {
    super(code);
    this.name = 'ApiError';
  }
}

export const isApiError = (e: unknown, code?: string): e is ApiError => e instanceof ApiError && (!code || e.code === code);

// ---------------------------------------------------------------- views (aws/src/orders/*.ts)

export type ServerProposalStatus = 'awaiting_exporter' | 'awaiting_importer' | 'fully_signed' | 'rejected';

// ProposalView: po and terms as wire JSON
export interface ProposalView {
  orderId: Hex;
  status: ServerProposalStatus;
  label?: string;
  goods?: string;
  importer: string;
  exporter: string;
  po: Raw;
  terms: Raw;
  proposed: { po: Raw; terms: Raw };
  differences: string[];
  sigExporter?: Hex;
  sigImporter?: Hex;
  importerSigner?: string;
  createdAt: number;
  updatedAt: number;
  exporterSignedAt?: number;
  importerSignedAt?: number;
  rejectedBy?: string;
  you: ('importer' | 'exporter')[];
}

export type OrderRole = 'importer' | 'exporter' | 'carrier' | 'arbiter';

// OrderView: the order as the agent and the indexer keep it. `state` is the escrow state as the
// indexer mirrors it ("NONE" until it sees OrderOpened).
export interface OrderView {
  orderId: Hex;
  label?: string;
  safe: string;
  exporter: string;
  order: Raw;
  terms: Raw;
  sigImporter: Hex;
  sigExporter: Hex;
  shipment?: { attestation: Raw; sigCarrier: Hex };
  documents?: { fileHashes: Hex[] };
  closing?: {
    balanceApproval?: { sigImporter: Hex; attestationHash: Hex };
    cancel?: { cancelNonce: string; sigImporter?: Hex; sigExporter?: Hex };
    resolution?: { toImporter: string; toExporter: string; sigArbiter: Hex };
  };
  state: string;
  chain?: { state: string; updatedBlock: string; lastTx?: Hex; lastEvent?: string };
  totalAmount: string;
  advance: string;
  locked: string;
  createdAt: number;
  you: OrderRole[];
}

export type NeedAction = 'sign_as_exporter' | 'sign_as_importer' | 'approve_balance' | 'sign_cancel' | 'upload_documents';

export interface Need {
  action: NeedAction;
  orderId: Hex;
  label?: string;
  as: 'importer' | 'exporter';
  cancelNonce?: string;
  attestationHash?: Hex;
}

export interface WalletView {
  safe: string;
  byState: Record<string, number>;
  locked: string;
  pendingFunding: string;
  orders: { orderId: Hex; label?: string; state: string; totalAmount: string; locked: string }[];
}

export interface TradeSetupView {
  chainId: number;
  escrow: Hex;
  safe: Hex;
  fundingGate: Hex | null;
  token: Hex | null;
  deployBlock: string;
}

export interface SupplierView {
  exporter: string;
  name?: string;
  taxId?: string;
  account?: string;
  payoutAddresses: string[];
}

export interface UploadTicket {
  uploadUrl: string;
  key: string;
  expiresIn: number;
}

// ---------------------------------------------------------------- wire

// bigints as decimal strings, everything else as is
export const toWire = (value: unknown): string => JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));

// The DocumentUpload fields plus its signature, issuedAt as a number, and the exact size in bytes
// the presigned PUT will carry (POST /trade/uploads)
export type UploadRequest = { orderId: Hex; docType: RequiredDocType; fileHash: Hex; size: number; issuedAt: number; signature: Hex };

// ---------------------------------------------------------------- client

export type ApiOptions = {
  baseUrl: string;
  fetchFn?: typeof fetch;
  // Milliseconds, like Date.now
  now?: () => number;
  // Known chain id; otherwise read once from GET /trade-setup
  chainId?: number;
};

export function apiClient({ baseUrl, fetchFn = (...a) => fetch(...a), now = Date.now, chainId: knownChain }: ApiOptions) {
  const base = baseUrl.replace(/\/+$/, '');
  // The signed path is the route path (/proposals/0x…): the API uses the $default stage
  // (infra/terraform/api.tf), so baseUrl has no stage prefix
  let setup: Promise<TradeSetupView> | undefined;

  async function send(method: string, path: string, init: { body?: string; headers?: Record<string, string> }): Promise<unknown> {
    let res: Response;
    try {
      res = await fetchFn(`${base}${path}`, { method, headers: { ...(init.body !== undefined && { 'content-type': 'application/json' }), ...init.headers }, body: init.body });
    } catch {
      throw new ApiError(0, 'network');
    }
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = undefined;
    }
    if (res.ok) return body;
    const b = (typeof body === 'object' && body !== null ? body : {}) as Raw;
    // The orders API answers {error}; the upload routes answer {status, reason}
    const { error, ...extra } = b;
    const code = typeof error === 'string' ? error : typeof b.reason === 'string' ? b.reason : 'server';
    throw new ApiError(res.status, code, extra);
  }

  const tradeSetup = (): Promise<TradeSetupView> => {
    setup ??= send('GET', '/trade-setup', {}) as Promise<TradeSetupView>;
    setup.catch(() => (setup = undefined));
    return setup;
  };
  const chainId = async () => knownChain ?? (await tradeSetup()).chainId;

  // The headers of a signed request. `path` without the query string, as API Gateway passes it.
  async function signedHeaders(signer: Signer, method: string, path: string, body: string): Promise<Record<string, string>> {
    const issuedAt = Math.floor(now() / 1000);
    const t = apiRequestTypedData(await chainId(), method, path, body, issuedAt);
    const signature = await signer.signTypedData(t.domain, t.types, t.primaryType, t.message);
    return { [API_HEADERS.signer]: await signer.address(), [API_HEADERS.signature]: signature, [API_HEADERS.issuedAt]: String(issuedAt) };
  }

  async function call<T>(signer: Signer, method: 'GET' | 'POST', path: string, payload?: unknown, query?: Record<string, string | undefined>): Promise<T> {
    const body = payload === undefined ? '' : toWire(payload);
    const headers = await signedHeaders(signer, method, path, body);
    const q = Object.entries(query ?? {}).filter((e): e is [string, string] => e[1] !== undefined);
    const qs = q.length ? `?${q.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')}` : '';
    return (await send(method, `${path}${qs}`, { headers, ...(payload !== undefined && { body }) })) as T;
  }

  const id = (orderId: Hex) => encodeURIComponent(orderId);

  return {
    signedHeaders,
    tradeSetup,
    chainId,

    // Proposals (aws/src/handlers/proposals.ts)
    createProposal: (s: Signer, body: { po: PurchaseOrder; terms: OrderTerms; label?: string; goods?: string }) =>
      call<ProposalView>(s, 'POST', '/proposals', body),
    listProposals: async (s: Signer, status?: ServerProposalStatus) =>
      (await call<{ proposals: ProposalView[] }>(s, 'GET', '/proposals', undefined, { status })).proposals,
    getProposal: (s: Signer, orderId: Hex) => call<ProposalView>(s, 'GET', `/proposals/${id(orderId)}`),
    exporterSignature: (s: Signer, orderId: Hex, body: { signature: Hex; po?: PurchaseOrder; terms?: OrderTerms }) =>
      call<ProposalView>(s, 'POST', `/proposals/${id(orderId)}/exporter-signature`, body),
    importerSignature: (s: Signer, orderId: Hex, body: { signature: Hex }) =>
      call<ProposalView>(s, 'POST', `/proposals/${id(orderId)}/importer-signature`, body),
    rejectProposal: (s: Signer, orderId: Hex) => call<ProposalView>(s, 'POST', `/proposals/${id(orderId)}/reject`),

    // Orders, read only (aws/src/handlers/orders.ts)
    listOrders: async (s: Signer, state?: string) => (await call<{ orders: OrderView[] }>(s, 'GET', '/orders', undefined, { state })).orders,
    getOrder: (s: Signer, orderId: Hex) => call<OrderView>(s, 'GET', `/orders/${id(orderId)}`),
    needsYou: async (s: Signer) => (await call<{ needs: Need[] }>(s, 'GET', '/needs-you')).needs,
    wallet: async (s: Signer, safe?: string) => (await call<{ wallets: WalletView[] }>(s, 'GET', '/wallet', undefined, { safe })).wallets,

    // Directory (aws/src/handlers/directory.ts)
    suppliers: async (s: Signer, safe?: string) =>
      (await call<{ safes: { safe: string; suppliers: SupplierView[] }[] }>(s, 'GET', '/suppliers', undefined, { safe })).safes,

    // Closing signatures (aws/src/handlers/signatures.ts, attest.ts)
    approveBalance: (s: Signer, orderId: Hex, body: { attestationHash: Hex; signature: Hex }) =>
      call<{ orderId: Hex; closing: OrderView['closing'] }>(s, 'POST', `/orders/${id(orderId)}/approve-balance`, body),
    cancelSignature: (s: Signer, orderId: Hex, body: { nonce: string; signature: Hex; side?: 'importer' | 'exporter' }) =>
      call<{ orderId: Hex; closing: OrderView['closing']; complete: boolean }>(s, 'POST', `/orders/${id(orderId)}/cancel-signature`, body),
    resolution: (s: Signer, orderId: Hex, body: { toImporter: bigint; toExporter: bigint; signature: Hex }) =>
      call<{ orderId: Hex; closing: OrderView['closing'] }>(s, 'POST', `/disputes/${id(orderId)}/resolution`, body),
    shipment: (s: Signer, body: { attestation: ShipmentAttestation; sigCarrier: Hex }) =>
      call<{ orderId: Hex; attestationHash: Hex }>(s, 'POST', '/shipments', body),

    // Document upload: a presigned URL for the exact file, then the bytes go straight to it.
    // Ingest reads the file afterwards; the outcome arrives as a notice and in GET /orders/{id}.
    // Not an ApiRequest: the DocumentUpload signature in the body is the authentication.
    requestUpload: async (body: UploadRequest) => (await send('POST', '/trade/uploads', { body: toWire(body) })) as UploadTicket,
    // The presigned URL signs the content length: exactly the bytes whose size was declared
    putFile: async (ticket: UploadTicket, bytes: Uint8Array): Promise<void> => {
      let res: Response;
      try {
        res = await fetchFn(ticket.uploadUrl, { method: 'PUT', body: bytes as unknown as BodyInit });
      } catch {
        throw new ApiError(0, 'network');
      }
      if (!res.ok) throw new ApiError(res.status, 'upload_failed');
    },
  };
}

export type ApiClient = ReturnType<typeof apiClient>;
