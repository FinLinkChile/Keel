import type { Hex, RequiredDocType } from '@keel/schemas';
import { keccak256 } from 'viem';

import { isApiError, type ApiClient } from '../data/api';
import type { Signer } from '../wallet/signer';

import { MAX_UPLOAD_BYTES, REJECTIONS, type UploadRejection, type UploadResult } from './client';
import { UPLOAD_TYPES, uploadDomain, type DocumentUpload } from './upload';

// Upload of one document through the Keel API: the same signed DocumentUpload as the direct
// upload to ingest (client.ts), sent with the file's size to POST /trade/uploads (no ApiRequest:
// that signature authenticates it), which answers with a presigned URL for those exact bytes; the
// bytes then go to that URL with a PUT. Ingest reads the file
// afterwards: the outcome arrives as a notice and later in GET /orders/{orderId}. Nothing of what
// it reads reaches this screen.

type Upload = {
  api: ApiClient;
  chainId: number | undefined;
  signer: Signer;
  orderId: Hex;
  docType: RequiredDocType;
  file: Uint8Array;
  now?: () => number;
};

function refused(e: unknown): UploadResult {
  if (!isApiError(e)) return { kind: 'failed', reason: 'server' };
  if (e.code === 'network') return { kind: 'failed', reason: 'network' };
  if (e.status === 413) return { kind: 'rejected', reason: 'too_large' };
  // 409 {status: duplicate, reason: same_file}: this file was already uploaded for the order
  if (e.status === 409 && e.extra.status === 'duplicate') return { kind: 'duplicate' };
  if (e.code === 'bad_request' || e.code === 'bad_json') return { kind: 'rejected', reason: 'invalid_request' };
  const reason = e.code as UploadRejection;
  if (e.status >= 400 && e.status < 500 && REJECTIONS.includes(reason)) return { kind: 'rejected', reason };
  // 429 rate_limited and anything else: not stored, try again later
  return { kind: 'failed', reason: 'server' };
}

export async function uploadViaApi({ api, chainId, signer, orderId, docType, file, now = Date.now }: Upload): Promise<UploadResult> {
  if (file.byteLength > MAX_UPLOAD_BYTES) return { kind: 'rejected', reason: 'too_large' };
  if (file.byteLength === 0) return { kind: 'rejected', reason: 'invalid_request' };
  try {
    const chain = chainId ?? (await api.chainId());
    const issuedAt = Math.floor(now() / 1000);
    const fileHash = keccak256(file);
    const message: DocumentUpload = { orderId, docType, fileHash, issuedAt: BigInt(issuedAt) };
    const signature = await signer.signTypedData(uploadDomain(chain), UPLOAD_TYPES, 'DocumentUpload', message);
    const ticket = await api.requestUpload({ orderId, docType, fileHash, size: file.byteLength, issuedAt, signature });
    await api.putFile(ticket, file);
    return { kind: 'sent' };
  } catch (e) {
    return refused(e);
  }
}
