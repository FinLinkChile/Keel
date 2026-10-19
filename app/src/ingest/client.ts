import type { Hex, RequiredDocType } from '@keel/schemas';
import { keccak256 } from 'viem';

import type { Signer } from '../wallet/signer';

import { toBase64 } from './base64';
import { UPLOAD_TYPES, uploadDomain, type DocumentUpload } from './upload';

// Signed upload of one document to ingest: POST {ingestUrl}/trade/documents.

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export type UploadRejection =
  | 'bad_signature'
  | 'stale_signature'
  | 'not_a_party'
  | 'too_large'
  | 'unknown_order'
  | 'unknown_doc_type'
  | 'invalid_request';

// Only the outcome of the upload. Whatever else ingest returns (extractions, diffs, hidden
// text, accounts found in the file) is dropped here and never reaches a screen.
export type UploadResult =
  | { kind: 'accepted' }
  | { kind: 'under_review' }
  | { kind: 'duplicate' }
  // Through the Keel API: the file is stored and will be read; the outcome arrives later
  | { kind: 'sent' }
  | { kind: 'rejected'; reason: UploadRejection }
  | { kind: 'failed'; reason: 'not_configured' | 'network' | 'server' };

export const REJECTIONS: readonly UploadRejection[] = [
  'bad_signature',
  'stale_signature',
  'not_a_party',
  'too_large',
  'unknown_order',
  'unknown_doc_type',
  'invalid_request',
];

// Reads the HTTP status and only the `status`, `reason` and `error` fields of the body.
export function readUploadResponse(httpStatus: number, body: unknown): UploadResult {
  const b = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  if (httpStatus === 200) {
    switch (b.status) {
      case 'ready':
        return { kind: 'accepted' };
      case 'held':
      case 'quarantined':
        return { kind: 'under_review' };
      case 'duplicate':
        return { kind: 'duplicate' };
      default:
        return { kind: 'failed', reason: 'server' };
    }
  }
  // Ingest on AWS reads asynchronously: the file is stored and the outcome comes later
  if (httpStatus === 202 && b.status === 'accepted_for_reading') return { kind: 'sent' };
  if (httpStatus === 409 && b.status === 'duplicate') return { kind: 'duplicate' };
  if (httpStatus === 413) return { kind: 'rejected', reason: 'too_large' };
  const reason = (b.reason ?? b.error) as UploadRejection;
  if (httpStatus >= 400 && httpStatus < 500 && REJECTIONS.includes(reason)) return { kind: 'rejected', reason };
  return { kind: 'failed', reason: 'server' };
}

type Upload = {
  ingestUrl: string | undefined;
  chainId: number | undefined;
  signer: Signer;
  orderId: Hex;
  docType: RequiredDocType;
  file: Uint8Array;
  now?: () => number;
  fetchFn?: typeof fetch;
};

// Signs the exact bytes and sends those same bytes. issuedAt goes as a number in the JSON and as
// a uint64 (bigint) in the signed message. No auth header: the signature is the authentication.
export async function uploadDocument({ ingestUrl, chainId, signer, orderId, docType, file, now = Date.now, fetchFn = fetch }: Upload): Promise<UploadResult> {
  if (!ingestUrl || !chainId) return { kind: 'failed', reason: 'not_configured' };
  if (file.byteLength > MAX_UPLOAD_BYTES) return { kind: 'rejected', reason: 'too_large' };

  const issuedAt = Math.floor(now() / 1000);
  const message: DocumentUpload = { orderId, docType, fileHash: keccak256(file), issuedAt: BigInt(issuedAt) };
  const signature = await signer.signTypedData(uploadDomain(chainId), UPLOAD_TYPES, 'DocumentUpload', message);

  let res: Response;
  try {
    res = await fetchFn(`${ingestUrl.replace(/\/+$/, '')}/trade/documents`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orderId, docType, issuedAt, signature, file: toBase64(file) }),
    });
  } catch {
    return { kind: 'failed', reason: 'network' };
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = undefined;
  }
  return readUploadResponse(res.status, body);
}
