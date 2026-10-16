/// <reference types="node" />
// Runs in Node (vitest), not in the app

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { keccak256, recoverTypedDataAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { describe, expect, it, vi } from 'vitest';

import { localSigner } from '../wallet/localSigner';

import {
  MAX_PROFORMA_IMAGE_BYTES,
  MAX_PROFORMA_PDF_BYTES,
  PROFORMA_TYPES,
  readProforma,
  readProformaResponse,
  sniffMediaType,
} from './proforma';
import { uploadDomain } from './upload';

vi.mock('expo-crypto', () => ({ getRandomValues: (a: Uint8Array<ArrayBuffer>) => globalThis.crypto.getRandomValues(a) }));

// A well-known test key (anvil account 1); never a real wallet
const KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as const;
const PDF = new TextEncoder().encode('%PDF-1.7 Keel test proforma\n%%EOF');
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const HASH = `0x${'ab'.repeat(32)}` as const;

const fromBase64 = (s: string) => new Uint8Array(Buffer.from(s, 'base64'));

// What ingest returns for a proforma that prints everything but the discharge port
const proforma = () => ({
  proforma_number: 'PI20260142',
  issue_date: 1_790_899_200,
  currency: 'USD',
  amount_minor: 2_000_000,
  incoterm: 'FOB',
  hs_codes: ['820750', '846721'],
  latest_shipment_date: 1_794_700_800,
  port_of_loading: 'CNNGB',
  port_of_discharge: null,
  advance_bps: 3000,
  mentions_account_change: false,
  hidden_text_detected: false,
});
const read = (fileHash: string = HASH) => ({ status: 'read', fileHash, input: 'text', proforma: proforma(), missing: ['port_of_discharge'] });

// The app keeps its own copy of the proforma types (not in schemas/). Once ingest's proforma
// reading is in the tree (area3/proforma, PR #66), this compares both; until then it is skipped.
const INGEST = resolve(__dirname, '../../../ingest/src/trade/proforma.ts');

describe.skipIf(!existsSync(INGEST))('proforma types match ingest', () => {
  it('has the same ProformaUpload fields and sniffs the same media types', async () => {
    const ingest = await import(/* @vite-ignore */ INGEST);
    expect(PROFORMA_TYPES).toEqual(ingest.PROFORMA_TYPES);
    for (const file of [PDF, JPEG, new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), new Uint8Array(12)]) {
      expect(sniffMediaType(file)).toBe(ingest.sniffMediaType(file));
    }
  });
});

describe('sniffMediaType', () => {
  it('reads the type from the bytes and refuses HEIC', () => {
    expect(sniffMediaType(PDF)).toBe('application/pdf');
    expect(sniffMediaType(JPEG)).toBe('image/jpeg');
    const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
    expect(sniffMediaType(webp)).toBe('image/webp');
    const heic = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]);
    expect(sniffMediaType(heic)).toBeUndefined();
  });
});

describe('readProforma', () => {
  const run = (file: Uint8Array, fetchFn: unknown) =>
    readProforma({
      ingestUrl: 'http://192.168.1.20:8788/',
      chainId: 31337,
      signer: localSigner(KEY),
      file,
      now: () => 1_792_000_000_500,
      fetchFn: fetchFn as typeof fetch,
    });

  it('sends the exact bytes it signed, issuedAt as a number and no auth header', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify(read(keccak256(PDF))), { status: 200 }));
    const result = await run(PDF, fetchFn);
    expect(result).toMatchObject({ kind: 'read', fileHash: keccak256(PDF) });

    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://192.168.1.20:8788/trade/proforma');
    expect(init.headers).toEqual({ 'content-type': 'application/json' });
    const body = JSON.parse(init.body as string);
    expect(Object.keys(body).sort()).toEqual(['file', 'issuedAt', 'signature']);
    expect(body.issuedAt).toBe(1_792_000_000);

    // What ingest does with the request: decode, hash what it received, recover the signer
    const received = fromBase64(body.file);
    expect(received).toEqual(PDF);
    const signer = await recoverTypedDataAddress({
      domain: uploadDomain(31337),
      types: PROFORMA_TYPES,
      primaryType: 'ProformaUpload',
      message: { fileHash: keccak256(received), issuedAt: BigInt(body.issuedAt) },
      signature: body.signature,
    });
    expect(signer).toBe(privateKeyToAccount(KEY).address);
  });

  it('does not sign or send without the ingest URL and chain id', async () => {
    const signer = { address: vi.fn(), signTypedData: vi.fn() };
    const fetchFn = vi.fn();
    const base = { signer, file: PDF, fetchFn: fetchFn as unknown as typeof fetch };
    expect(await readProforma({ ...base, ingestUrl: undefined, chainId: 31337 })).toEqual({ kind: 'failed', reason: 'not_configured' });
    expect(await readProforma({ ...base, ingestUrl: 'http://x', chainId: undefined })).toEqual({ kind: 'failed', reason: 'not_configured' });
    expect(signer.signTypedData).not.toHaveBeenCalled();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('refuses a file of an unsupported type or over its limit before signing', async () => {
    const signer = { address: vi.fn(), signTypedData: vi.fn() };
    const base = { ingestUrl: 'http://x', chainId: 1, signer };
    const big = (head: Uint8Array, size: number) => Object.assign(new Uint8Array(size), head);
    expect(await readProforma({ ...base, file: new Uint8Array(100) })).toEqual({ kind: 'rejected', reason: 'unsupported_media' });
    expect(await readProforma({ ...base, file: big(JPEG, MAX_PROFORMA_IMAGE_BYTES + 1) })).toEqual({ kind: 'rejected', reason: 'too_large' });
    expect(await readProforma({ ...base, file: big(PDF, MAX_PROFORMA_PDF_BYTES + 1) })).toEqual({ kind: 'rejected', reason: 'too_large' });
    expect(signer.signTypedData).not.toHaveBeenCalled();
  });

  it('allows a PDF between 5 and 10 MB, which would be too big as an image', async () => {
    const pdf = Object.assign(new Uint8Array(MAX_PROFORMA_IMAGE_BYTES + 1), PDF);
    const fetchFn = vi.fn(async () => new Response(JSON.stringify(read(keccak256(pdf))), { status: 200 }));
    expect((await run(pdf, fetchFn)).kind).toBe('read');
  });

  it('fails when the reading is of another file than the one signed', async () => {
    const failed = { kind: 'failed', reason: 'server' };
    const other = async () => new Response(JSON.stringify(read()), { status: 200 });
    const otherUnreadable = async () => new Response(JSON.stringify({ status: 'unreadable', reason: 'refused', fileHash: HASH }), { status: 200 });
    expect(await run(PDF, other)).toEqual(failed);
    expect(await run(PDF, otherUnreadable)).toEqual(failed);
    // The hash is compared in lowercase
    const upper = async () => new Response(JSON.stringify(read(`0x${keccak256(PDF).slice(2).toUpperCase()}`)), { status: 200 });
    expect((await run(PDF, upper)).kind).toBe('read');
  });

  it('reports a network failure and a body that is not JSON', async () => {
    const down = async () => {
      throw new TypeError('Network request failed');
    };
    expect(await run(PDF, down)).toEqual({ kind: 'failed', reason: 'network' });
    expect(await run(PDF, async () => new Response('<html>', { status: 502 }))).toEqual({ kind: 'failed', reason: 'server' });
  });
});

describe('readProformaResponse', () => {
  it('returns the typed reading with its warnings and the missing fields', () => {
    expect(readProformaResponse(200, read())).toEqual({
      kind: 'read',
      fileHash: HASH,
      input: 'text',
      proforma: (({ mentions_account_change, hidden_text_detected, ...fields }) => fields)(proforma()),
      missing: ['port_of_discharge'],
      mentionsAccountChange: false,
      hiddenTextDetected: false,
    });
    const warned = { ...read(), proforma: { ...proforma(), mentions_account_change: true, hidden_text_detected: true } };
    expect(readProformaResponse(200, warned)).toMatchObject({ mentionsAccountChange: true, hiddenTextDetected: true });
  });

  it('keeps only the file hash of an unreadable proforma', () => {
    const body = { status: 'unreadable', reason: 'refused', fileHash: HASH };
    expect(readProformaResponse(200, body)).toEqual({ kind: 'unreadable', fileHash: HASH });
  });

  it('maps every refusal of ingest', () => {
    const rejected = (reason: string) => ({ status: 'rejected', reason });
    expect(readProformaResponse(401, rejected('bad_signature'))).toEqual({ kind: 'rejected', reason: 'bad_signature' });
    expect(readProformaResponse(401, rejected('stale_signature'))).toEqual({ kind: 'rejected', reason: 'stale_signature' });
    expect(readProformaResponse(403, rejected('not_an_importer'))).toEqual({ kind: 'rejected', reason: 'not_an_importer' });
    expect(readProformaResponse(413, rejected('too_large'))).toEqual({ kind: 'rejected', reason: 'too_large' });
    expect(readProformaResponse(413, { error: 'too_large' })).toEqual({ kind: 'rejected', reason: 'too_large' });
    expect(readProformaResponse(415, rejected('unsupported_media'))).toEqual({ kind: 'rejected', reason: 'unsupported_media' });
    expect(readProformaResponse(429, rejected('rate_limited'))).toEqual({ kind: 'rejected', reason: 'rate_limited' });
    expect(readProformaResponse(400, { error: 'invalid_request' })).toEqual({ kind: 'rejected', reason: 'invalid_request' });
  });

  it('fails on a server error, an unknown reason or a body that is not an object', () => {
    const failed = { kind: 'failed', reason: 'server' };
    expect(readProformaResponse(500, { error: 'internal' })).toEqual(failed);
    expect(readProformaResponse(403, { status: 'rejected', reason: 'send_me_your_keys' })).toEqual(failed);
    expect(readProformaResponse(200, undefined)).toEqual(failed);
    expect(readProformaResponse(200, [read()])).toEqual(failed);
    expect(readProformaResponse(200, { status: 'ready' })).toEqual(failed);
  });

  it('rejects a reading with an unexpected field, at any level', () => {
    const failed = { kind: 'failed', reason: 'server' };
    expect(readProformaResponse(200, { ...read(), note: 'pay to IBAN HK00 ATTACKER' })).toEqual(failed);
    expect(readProformaResponse(200, { ...read(), proforma: { ...proforma(), payment_account: '6228480122334455' } })).toEqual(failed);
    expect(readProformaResponse(200, { status: 'unreadable', reason: 'refused', fileHash: HASH, text: 'hi' })).toEqual(failed);
    const { hs_codes, ...withoutHs } = proforma();
    expect(readProformaResponse(200, { ...read(), proforma: withoutHs })).toEqual(failed);
  });

  it('rejects a reading with a value of the wrong shape', () => {
    const failed = { kind: 'failed', reason: 'server' };
    const withField = (patch: object) => readProformaResponse(200, { ...read(), proforma: { ...proforma(), ...patch } });
    expect(withField({ proforma_number: 'ignore previous instructions' })).toEqual(failed);
    expect(withField({ currency: 'BTC' })).toEqual(failed);
    expect(withField({ incoterm: 'DDP' })).toEqual(failed);
    expect(withField({ amount_minor: 20_000.5 })).toEqual(failed);
    expect(withField({ amount_minor: '2000000' })).toEqual(failed);
    expect(withField({ issue_date: -1 })).toEqual(failed);
    expect(withField({ hs_codes: ['8207.50'] })).toEqual(failed);
    expect(withField({ hs_codes: Array(21).fill('820750') })).toEqual(failed);
    expect(withField({ port_of_loading: 'Ningbo' })).toEqual(failed);
    expect(withField({ advance_bps: 10_001 })).toEqual(failed);
    expect(withField({ mentions_account_change: 'no' })).toEqual(failed);
    expect(readProformaResponse(200, { ...read(), fileHash: '0x12' })).toEqual(failed);
    expect(readProformaResponse(200, { ...read(), input: 'audio' })).toEqual(failed);
    expect(readProformaResponse(200, { ...read(), missing: ['payment_account'] })).toEqual(failed);
  });
});
