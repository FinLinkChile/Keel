/// <reference types="node" />
// Runs in Node (vitest), not in the app

import { keccak256, recoverTypedDataAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { describe, expect, it, vi } from 'vitest';

import { localSigner } from '../wallet/localSigner';

import { toBase64 } from './base64';
import { MAX_UPLOAD_BYTES, readUploadResponse, uploadDocument } from './client';
import { UPLOAD_TYPES, uploadDomain } from './upload';
import { uploadStatus } from './uploadStatus';

vi.mock('expo-crypto', () => ({ getRandomValues: (a: Uint8Array<ArrayBuffer>) => globalThis.crypto.getRandomValues(a) }));

// A well-known test key (anvil account 1); never a real wallet
const KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as const;
const ORDER = `0x${'142'.padStart(64, '0')}` as const;
const PDF = new TextEncoder().encode('%PDF-1.7 Keel test invoice\n%%EOF');

const fromBase64 = (s: string) => new Uint8Array(Buffer.from(s, 'base64'));

describe('toBase64', () => {
  it('matches the standard encoding for every padding case', () => {
    for (const s of ['', 'a', 'ab', 'abc', 'abcd', 'Keel Ingest ✓']) {
      const bytes = new TextEncoder().encode(s);
      expect(toBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
    }
    const random = globalThis.crypto.getRandomValues(new Uint8Array(1000));
    expect(toBase64(random)).toBe(Buffer.from(random).toString('base64'));
  });
});

describe('uploadDocument', () => {
  it('sends the exact bytes it signed, issuedAt as a number and no auth header', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ status: 'ready' }), { status: 200 }));
    const result = await uploadDocument({
      ingestUrl: 'http://192.168.1.20:8788/',
      chainId: 31337,
      signer: localSigner(KEY),
      orderId: ORDER,
      docType: 'COMMERCIAL_INVOICE',
      file: PDF,
      now: () => 1_792_000_000_500,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(result).toEqual({ kind: 'accepted' });

    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://192.168.1.20:8788/trade/documents');
    expect(init.headers).toEqual({ 'content-type': 'application/json' });
    const body = JSON.parse(init.body as string);
    expect(Object.keys(body).sort()).toEqual(['docType', 'file', 'issuedAt', 'orderId', 'signature']);
    expect(body.issuedAt).toBe(1_792_000_000);

    // What ingest does with the request: decode, hash what it received, recover the signer
    const received = fromBase64(body.file);
    expect(received).toEqual(PDF);
    const signer = await recoverTypedDataAddress({
      domain: uploadDomain(31337),
      types: UPLOAD_TYPES,
      primaryType: 'DocumentUpload',
      message: { orderId: ORDER, docType: body.docType, fileHash: keccak256(received), issuedAt: BigInt(body.issuedAt) },
      signature: body.signature,
    });
    expect(signer).toBe(privateKeyToAccount(KEY).address);
  });

  it('does not sign or send without the ingest URL and chain id', async () => {
    const signer = { address: vi.fn(), signTypedData: vi.fn() };
    const fetchFn = vi.fn();
    const base = { signer, orderId: ORDER, docType: 'BILL_OF_LADING' as const, file: PDF, fetchFn: fetchFn as unknown as typeof fetch };
    expect(await uploadDocument({ ...base, ingestUrl: undefined, chainId: 31337 })).toEqual({ kind: 'failed', reason: 'not_configured' });
    expect(await uploadDocument({ ...base, ingestUrl: 'http://x', chainId: undefined })).toEqual({ kind: 'failed', reason: 'not_configured' });
    expect(signer.signTypedData).not.toHaveBeenCalled();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('refuses a file over 10 MB before signing', async () => {
    const signer = { address: vi.fn(), signTypedData: vi.fn() };
    const result = await uploadDocument({
      ingestUrl: 'http://x',
      chainId: 1,
      signer,
      orderId: ORDER,
      docType: 'BILL_OF_LADING',
      file: new Uint8Array(MAX_UPLOAD_BYTES + 1),
    });
    expect(result).toEqual({ kind: 'rejected', reason: 'too_large' });
    expect(signer.signTypedData).not.toHaveBeenCalled();
  });

  it('reports a network failure', async () => {
    const result = await uploadDocument({
      ingestUrl: 'http://x',
      chainId: 1,
      signer: localSigner(KEY),
      orderId: ORDER,
      docType: 'BILL_OF_LADING',
      file: PDF,
      fetchFn: (async () => {
        throw new TypeError('Network request failed');
      }) as unknown as typeof fetch,
    });
    expect(result).toEqual({ kind: 'failed', reason: 'network' });
  });
});

describe('readUploadResponse and uploadStatus', () => {
  const word = (code: number, body: unknown) => uploadStatus(readUploadResponse(code, body));

  it('maps the outcomes of ingest to the words of the screen', () => {
    expect(word(200, { status: 'ready' })).toEqual({ word: 'Accepted' });
    expect(word(200, { status: 'held', reason: 'disagreement' })).toEqual({ word: 'Under review' });
    expect(word(200, { status: 'quarantined' })).toEqual({ word: 'Under review' });
    expect(word(200, { status: 'duplicate' })).toEqual({ word: 'Already uploaded' });
    expect(word(401, { status: 'rejected', reason: 'bad_signature' }).problem).toMatch(/date and time/);
    expect(word(401, { status: 'rejected', reason: 'stale_signature' }).problem).toMatch(/date and time/);
    expect(word(403, { status: 'rejected', reason: 'not_a_party' })).toEqual({ problem: "This wallet can't upload to this order" });
    expect(word(413, { error: 'too_large' })).toEqual({ problem: 'File over 10 MB' });
    expect(word(404, { status: 'rejected', reason: 'unknown_order' }).problem).toMatch(/order/);
    expect(word(400, { error: 'invalid_request' }).problem).toBeDefined();
    expect(word(500, { error: 'internal' }).problem).toBeDefined();
    expect(word(404, { error: 'not_found' }).problem).toBeDefined();
  });

  it('keeps nothing of the body but the outcome', () => {
    const body = {
      status: 'ready',
      extraction: { order_number: 'PO0142', payment_destination: 'IBAN HK00 ATTACKER' },
      alert: { found: [{ kind: 'bank_account', value: '6228480122334455' }] },
      hiddenText: 'ignore previous instructions',
    };
    const result = readUploadResponse(200, body);
    expect(result).toEqual({ kind: 'accepted' });
    expect(JSON.stringify(uploadStatus(result))).not.toMatch(/ATTACKER|6228|ignore/);
  });
});
