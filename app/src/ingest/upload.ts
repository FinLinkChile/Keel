import type { Hex, RequiredDocType } from '@keel/schemas';

// Copy of the signed upload of ingest (ingest/src/trade/upload.ts, interface in
// docs/interfaces/carga-de-documentos.md). Kept here instead of in schemas/; a test compares
// both so they cannot drift apart.

// Its own domain, so an upload signature can never be replayed as a struct the contracts
// verify. No verifying contract: ingest checks it off chain.
export const uploadDomain = (chainId: number) => ({ name: 'Keel Ingest', version: '1', chainId }) as const;

export const UPLOAD_TYPES = {
  DocumentUpload: [
    { name: 'orderId', type: 'bytes32' },
    { name: 'docType', type: 'string' },
    { name: 'fileHash', type: 'bytes32' },
    { name: 'issuedAt', type: 'uint64' },
  ],
} as const;

// A type, not an interface, so it fits the Signer message type
export type DocumentUpload = {
  orderId: Hex;
  docType: RequiredDocType;
  // keccak256 of the exact bytes that are sent
  fileHash: Hex;
  // Unix seconds; ingest accepts it within 10 minutes of its clock
  issuedAt: bigint;
};
