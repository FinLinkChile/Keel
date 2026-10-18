import { keccak256, recoverTypedDataAddress, stringToBytes } from 'viem';
import { describe, expect, it, vi } from 'vitest';

import { UPLOAD_TYPES, uploadDomain, type DocumentUpload } from '../ingest/upload';

import { localSigner, newPrivateKey } from './localSigner';

// expo-crypto is native; in Node the same call comes from the global WebCrypto
vi.mock('expo-crypto', () => ({ getRandomValues: (a: Uint8Array<ArrayBuffer>) => globalThis.crypto.getRandomValues(a) }));

describe('device test wallet', () => {
  it('generates a different valid key each time', () => {
    const a = newPrivateKey();
    const b = newPrivateKey();
    expect(a).toMatch(/^0x[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
  });

  it('signs a DocumentUpload that recovers to its own address, as ingest checks it', async () => {
    const signer = localSigner(newPrivateKey());
    const message: DocumentUpload = {
      orderId: `0x${'142'.padStart(64, '0')}`,
      docType: 'COMMERCIAL_INVOICE',
      fileHash: keccak256(stringToBytes('Keel test document')),
      issuedAt: 1_792_000_000n,
    };
    const signature = await signer.signTypedData(uploadDomain(31337), UPLOAD_TYPES, 'DocumentUpload', message);
    const recover = (chainId: number, m: DocumentUpload) =>
      recoverTypedDataAddress({ domain: uploadDomain(chainId), types: UPLOAD_TYPES, primaryType: 'DocumentUpload', message: m, signature });

    expect(await recover(31337, message)).toBe(await signer.address());
    // Another chain id or another file recovers someone else: ingest answers not_a_party
    expect(await recover(1, message)).not.toBe(await signer.address());
    expect(await recover(31337, { ...message, fileHash: keccak256(stringToBytes('other file')) })).not.toBe(await signer.address());
  });
});
