import { EIP712_TYPES, keelDomain, type BalanceApproval, type CancelOrder, type Hex, type ShipmentAttestation } from '@keel/schemas';
import { structHash } from '@keel/schemas/hash';
import { encodeAbiParameters, hashTypedData, hexToString } from 'viem';

import { formatMinor } from '../ui/format';
import type { Signer } from '../wallet/signer';

import { tokenToCents } from './amounts';
import { isApiError, type ApiClient, type OrderView } from './api';
import type { SigningSetup } from './signOrder';
import type { Role } from './types';

// Signatures that close an open order (docs/flujo/paso-5-saldo.md, docs/flujo/disputa-y-cancelacion.md):
//
//   BalanceApproval{orderId, attestationHash}   importer   releases the balance at once
//   CancelOrder{orderId, nonce}                 both       returns what is left to the importer
//
// The app signs them with the wallet on this phone and hands them to the API, which checks them
// the way TradeEscrow will and stores them; the agent submits them on its next pass. Storing a
// signature moves nothing, and the escrow checks it all again.
//
// The importer is a Safe: its signature is an owner's signature of the Safe's SafeMessage over the
// escrow digest, the same ERC-1271 path as the order itself (signOrder.ts). The exporter signs the
// struct directly with its own wallet.

type ClosingType = 'BalanceApproval' | 'CancelOrder';
type ClosingMessage<T extends ClosingType> = T extends 'BalanceApproval' ? BalanceApproval : CancelOrder;

// The digest the escrow hashes (`_hashTypedDataV4`) for one of its structs
export function escrowDigest<T extends ClosingType>(setup: SigningSetup, primaryType: T, message: ClosingMessage<T>): Hex {
  return hashTypedData({
    domain: keelDomain(setup.chainId, setup.escrow),
    types: { [primaryType]: EIP712_TYPES[primaryType] },
    primaryType,
    message,
  } as never);
}

const SAFE_MESSAGE_TYPES = { SafeMessage: [{ name: 'message', type: 'bytes' }] } as const;

// What an owner of `safe` signs so that the Safe's CompatibilityFallbackHandler accepts `digest`
// through ERC-1271
export const safeMessageFor = (setup: SigningSetup, safe: Hex, digest: Hex) => ({
  domain: { chainId: setup.chainId, verifyingContract: safe },
  types: SAFE_MESSAGE_TYPES,
  primaryType: 'SafeMessage' as const,
  message: { message: encodeAbiParameters([{ type: 'bytes32' }], [digest]) },
});

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

// The importer's signature of a closing struct. `importer` is po.importer: when it is the Safe of
// this deployment an owner signs for it, otherwise the importer is the wallet itself.
export async function signAsImporter<T extends ClosingType>(signer: Signer, setup: SigningSetup, importer: Hex, primaryType: T, message: ClosingMessage<T>): Promise<Hex> {
  if (setup.safe && same(importer, setup.safe)) {
    const m = safeMessageFor(setup, setup.safe, escrowDigest(setup, primaryType, message));
    return signer.signTypedData(m.domain, m.types, m.primaryType, m.message);
  }
  if (!same(await signer.address(), importer)) throw new Error('not_importer');
  return signDirect(signer, setup, primaryType, message);
}

// The exporter's signature: an EOA, the struct itself in the escrow's domain
export function signAsExporter<T extends ClosingType>(signer: Signer, setup: SigningSetup, primaryType: T, message: ClosingMessage<T>): Promise<Hex> {
  return signDirect(signer, setup, primaryType, message);
}

function signDirect<T extends ClosingType>(signer: Signer, setup: SigningSetup, primaryType: T, message: ClosingMessage<T>): Promise<Hex> {
  return signer.signTypedData(keelDomain(setup.chainId, setup.escrow), { [primaryType]: EIP712_TYPES[primaryType] }, primaryType, { ...message });
}

// The ShipmentAttestation an order view holds, typed again (onBoardDate travels as a string)
export function attestationOf(raw: Record<string, unknown>): ShipmentAttestation {
  return {
    orderId: raw.orderId as Hex,
    blNumberHash: raw.blNumberHash as Hex,
    onBoardDate: BigInt(raw.onBoardDate as string),
    portOfLoading: raw.portOfLoading as Hex,
    docsHash: raw.docsHash as Hex,
  };
}

// The attestationHash a BalanceApproval names, computed here from the attestation fields of the
// order view instead of read from a hash field the server sends. The fields themselves still come
// from the API: the confirmation sheet shows them (balanceApprovalDetails) so the importer
// approves what it was shown, but this app does not check them against the chain or the carrier's
// signature; the escrow checks that signature when the shipment is submitted (submitShipment).
export function attestationHashOf(view: Pick<OrderView, 'shipment'>): Hex | undefined {
  return view.shipment ? structHash('ShipmentAttestation', attestationOf(view.shipment.attestation)) : undefined;
}

// What the importer sees before approving the balance: the amount and the fields of the
// attestation the signature names, read from the order view itself. The signature binds the hash
// of that same attestation (attestationHashOf). undefined when the view holds no shipment, so
// there is nothing to confirm (and approveBalance refuses as well).
export interface BalanceApprovalDetails {
  // USDC, 2 decimals
  balance: string;
  // UTC day, YYYY-MM-DD
  onBoardDate: string;
  portOfLoading: string;
  blNumberHash: string;
}

const shortHash = (h: string) => (h.length > 14 ? `${h.slice(0, 8)}…${h.slice(-6)}` : h);

export function balanceApprovalDetails(view: Pick<OrderView, 'shipment' | 'locked'>): BalanceApprovalDetails | undefined {
  if (!view.shipment) return undefined;
  const a = attestationOf(view.shipment.attestation);
  // The port travels as bytes32 text (CNSZX); anything else is shown as its hash
  let port: string = shortHash(a.portOfLoading);
  try {
    const text = hexToString(a.portOfLoading).replace(/\0+$/, '');
    if (/^[A-Z0-9]{1,31}$/.test(text)) port = text;
  } catch {
    // keep the hash
  }
  return {
    balance: formatMinor(tokenToCents(BigInt(view.locked))),
    onBoardDate: new Date(Number(a.onBoardDate) * 1000).toISOString().slice(0, 10),
    portOfLoading: port,
    blNumberHash: shortHash(a.blNumberHash),
  };
}

// ---------------------------------------------------------------- with the API

const importerOf = (view: OrderView) => view.order.importer as Hex;

// Approve the balance of a SHIPPED order as the importer
export async function approveBalance(api: ApiClient, signer: Signer, setup: SigningSetup, view: OrderView): Promise<void> {
  const attestationHash = attestationHashOf(view);
  if (!attestationHash) throw new Error('no_shipment');
  const message: BalanceApproval = { orderId: view.orderId, attestationHash };
  const signature = await signAsImporter(signer, setup, importerOf(view), 'BalanceApproval', message);
  await api.approveBalance(signer, view.orderId, { attestationHash, signature });
}

// The cancel nonce to sign: the one the other side signed (needs-you or the order view), else the
// escrow's current one as the API reads it. The API answers a request with a stale nonce with the
// current one (409 stale_cancel_nonce) before it looks at the signature, so a request without a
// signature asks for it and nothing is signed for a nonce that cannot be valid. Whatever the API
// says, the escrow only accepts its own cancelNonceOf: a wrong nonce gives a worthless signature.
export async function currentCancelNonce(api: ApiClient, signer: Signer, orderId: Hex, side: Role, known?: string): Promise<bigint> {
  if (known !== undefined) return BigInt(known);
  try {
    await api.cancelSignature(signer, orderId, { nonce: '0', signature: '0x00', side });
  } catch (e) {
    if (isApiError(e, 'stale_cancel_nonce') && typeof e.extra.cancelNonce === 'string') return BigInt(e.extra.cancelNonce);
    // Nonce 0 was current, only the empty signature was refused
    if (isApiError(e) && e.status === 422) return 0n;
    throw e;
  }
  throw new Error('unexpected_cancel_probe');
}

// Sign the mutual cancellation for `side`. Retries once when the escrow moved to another state
// between reading the nonce and sending the signature.
export async function signCancellation(api: ApiClient, signer: Signer, setup: SigningSetup, view: OrderView, side: Role, knownNonce?: string): Promise<{ complete: boolean }> {
  let nonce = await currentCancelNonce(api, signer, view.orderId, side, knownNonce ?? view.closing?.cancel?.cancelNonce);
  for (let attempt = 0; ; attempt++) {
    const message: CancelOrder = { orderId: view.orderId, nonce };
    const signature =
      side === 'importer'
        ? await signAsImporter(signer, setup, importerOf(view), 'CancelOrder', message)
        : await signAsExporter(signer, setup, 'CancelOrder', message);
    try {
      return await api.cancelSignature(signer, view.orderId, { nonce: nonce.toString(), signature, side });
    } catch (e) {
      if (attempt === 0 && isApiError(e, 'stale_cancel_nonce') && typeof e.extra.cancelNonce === 'string') {
        nonce = BigInt(e.extra.cancelNonce);
        continue;
      }
      throw e;
    }
  }
}

// Escrow states where each action applies (TradeEscrow; aws/src/orders/rules.ts). NONE is not
// one: the escrow's cancel reverts there, so a cancellation is never offered for an order it has not opened.
export const CANCELLABLE_STATES = ['OPEN', 'ADVANCE_PAID', 'DISPUTED'] as const;
export const canCancel = (state: string) => (CANCELLABLE_STATES as readonly string[]).includes(state);
export const canApproveBalance = (view: Pick<OrderView, 'state' | 'shipment' | 'closing'>) => view.state === 'SHIPPED' && !!view.shipment && !view.closing?.balanceApproval;
// raiseDispute is only valid from SHIPPED
export const canDispute = (state: string) => state === 'SHIPPED';
