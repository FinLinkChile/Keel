/// <reference types="node" />
// Runs in Node (vitest), not in the app

import { apiRequestTypedData as schemasTypedData } from '@keel/schemas/hash';
import { privateKeyToAccount } from 'viem/accounts';
import { describe, expect, it, vi } from 'vitest';

import { apiRequestTypedData as awsTypedData, authenticate } from '../../../aws/src/auth';
import type { Signer } from '../wallet/signer';

import { ApiError, apiClient, toWire } from './api';

// Well-known test keys (anvil accounts 1 and 2); never real wallets
const KEY_A = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as const;
const KEY_B = '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a' as const;

function testSigner(key: `0x${string}`): Signer {
  const account = privateKeyToAccount(key);
  return {
    address: async () => account.address,
    signTypedData: (domain, types, primaryType, message) => account.signTypedData({ domain, types, primaryType, message } as never),
  };
}

const CHAIN = 84532;
const NOW = 1_790_000_000_000;
const ORDER = `0x${'ab'.repeat(32)}` as const;

type Sent = { url: string; method: string; headers: Record<string, string>; body?: string };

function fakeFetch(reply: (s: Sent) => Response) {
  const sent: Sent[] = [];
  const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const s: Sent = { url: String(url), method: init?.method ?? 'GET', headers: (init?.headers ?? {}) as Record<string, string>, body: init?.body as string | undefined };
    sent.push(s);
    return reply(s);
  });
  return { fetchFn: fetchFn as unknown as typeof fetch, sent };
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('apiRequestTypedData', () => {
  it('is the same in schemas and in aws/src/auth.ts', () => {
    expect(schemasTypedData(CHAIN, 'post', '/proposals', '{"a":1}', 1700000000)).toEqual(awsTypedData(CHAIN, 'post', '/proposals', '{"a":1}', 1700000000));
  });
});

describe('apiClient', () => {
  it('signs each request so that the server authenticates the wallet', async () => {
    const { fetchFn, sent } = fakeFetch(() => json(201, { orderId: ORDER }));
    const api = apiClient({ baseUrl: 'https://api.example/', chainId: CHAIN, fetchFn, now: () => NOW });
    const signer = testSigner(KEY_A);
    await api.cancelSignature(signer, ORDER, { nonce: '258', signature: '0x1234' });

    const s = sent[0]!;
    expect(s.url).toBe(`https://api.example/orders/${ORDER}/cancel-signature`);
    expect(s.method).toBe('POST');
    expect(JSON.parse(s.body!)).toEqual({ nonce: '258', signature: '0x1234' });
    const auth = await authenticate({ method: s.method, path: new URL(s.url).pathname, body: s.body!, headers: s.headers }, CHAIN, new Date(NOW));
    expect(auth).toEqual({ ok: true, signer: privateKeyToAccount(KEY_A).address });
    // A changed body recovers another address
    const tampered = await authenticate({ method: s.method, path: new URL(s.url).pathname, body: s.body!.replace('258', '259'), headers: s.headers }, CHAIN, new Date(NOW));
    expect(tampered).toEqual({ ok: false, reason: 'signer_mismatch' });
  });

  it('signs a GET over the path without the query string and an empty body', async () => {
    const { fetchFn, sent } = fakeFetch(() => json(200, { proposals: [] }));
    const api = apiClient({ baseUrl: 'https://api.example', chainId: CHAIN, fetchFn, now: () => NOW });
    expect(await api.listProposals(testSigner(KEY_B), 'awaiting_importer')).toEqual([]);
    const s = sent[0]!;
    const url = new URL(s.url);
    expect(url.pathname).toBe('/proposals');
    expect(url.search).toBe('?status=awaiting_importer');
    expect(s.body).toBeUndefined();
    const auth = await authenticate({ method: 'GET', path: url.pathname, body: '', headers: s.headers }, CHAIN, new Date(NOW));
    expect(auth).toEqual({ ok: true, signer: privateKeyToAccount(KEY_B).address });
  });

  it('reads the chain id from GET /trade-setup once when it is not configured', async () => {
    const { fetchFn, sent } = fakeFetch((s) => (s.url.endsWith('/trade-setup') ? json(200, { chainId: CHAIN, escrow: ORDER.slice(0, 42) }) : json(200, { needs: [] })));
    const api = apiClient({ baseUrl: 'https://api.example', fetchFn, now: () => NOW });
    await api.needsYou(testSigner(KEY_A));
    await api.needsYou(testSigner(KEY_A));
    expect(sent.filter((s) => s.url.endsWith('/trade-setup'))).toHaveLength(1);
    expect(sent[0]!.headers).toEqual({});
    const auth = await authenticate({ method: 'GET', path: '/needs-you', body: '', headers: sent[1]!.headers }, CHAIN, new Date(NOW));
    expect(auth.ok).toBe(true);
  });

  it('sends bigints as decimal strings and advanceBps as a number', () => {
    expect(toWire({ totalAmount: 10n ** 30n, advanceBps: 3000 })).toBe('{"totalAmount":"1000000000000000000000000000000","advanceBps":3000}');
  });

  it('maps {error} and {status, reason} replies to typed errors', async () => {
    const replies = [json(409, { error: 'stale_cancel_nonce', cancelNonce: '515' }), json(403, { status: 'rejected', reason: 'not_a_party' })];
    const { fetchFn } = fakeFetch(() => replies.shift()!);
    const api = apiClient({ baseUrl: 'https://api.example', chainId: CHAIN, fetchFn, now: () => NOW });
    const e1 = await api.getOrder(testSigner(KEY_A), ORDER).catch((e) => e);
    expect(e1).toBeInstanceOf(ApiError);
    expect(e1).toMatchObject({ status: 409, code: 'stale_cancel_nonce', extra: { cancelNonce: '515' } });
    const e2 = await api.requestUpload({ orderId: ORDER, docType: 'BILL_OF_LADING', fileHash: ORDER, size: 3, issuedAt: 1, signature: '0x12' }).catch((e) => e);
    expect(e2).toMatchObject({ status: 403, code: 'not_a_party' });
  });

  it('reports an unreachable server as a network error', async () => {
    const fetchFn = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    const api = apiClient({ baseUrl: 'https://api.example', chainId: CHAIN, fetchFn });
    await expect(api.needsYou(testSigner(KEY_A))).rejects.toMatchObject({ status: 0, code: 'network' });
  });

  it('asks for an upload without an ApiRequest and PUTs the bytes to the presigned URL', async () => {
    const { fetchFn, sent } = fakeFetch((s) => (s.method === 'PUT' ? new Response(null, { status: 200 }) : json(200, { uploadUrl: 'https://s3.example/put?sig', key: 'k', expiresIn: 300 })));
    const api = apiClient({ baseUrl: 'https://api.example', chainId: CHAIN, fetchFn });
    const ticket = await api.requestUpload({ orderId: ORDER, docType: 'COMMERCIAL_INVOICE', fileHash: ORDER, size: 3, issuedAt: 1700000000, signature: '0x12' });
    expect(sent[0]!.headers).toEqual({ 'content-type': 'application/json' });
    expect(JSON.parse(sent[0]!.body!)).toEqual({ orderId: ORDER, docType: 'COMMERCIAL_INVOICE', fileHash: ORDER, size: 3, issuedAt: 1700000000, signature: '0x12' });
    await api.putFile(ticket, new Uint8Array([1, 2, 3]));
    expect(sent[1]).toMatchObject({ url: 'https://s3.example/put?sig', method: 'PUT' });
  });
});
