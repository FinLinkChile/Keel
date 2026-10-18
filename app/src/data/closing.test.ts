/// <reference types="node" />
// Runs in Node (vitest), not in the app

import { EIP712_TYPES, keelDomain, type Hex, type ShipmentAttestation } from '@keel/schemas';
import { blNumberHash, bytes32Text, structHash, typedDataDigest } from '@keel/schemas/hash';
import { recoverTypedDataAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { describe, expect, it, vi } from 'vitest';

import type { Signer } from '../wallet/signer';

import { ApiError, type ApiClient, type OrderView } from './api';
import {
  approveBalance,
  attestationHashOf,
  canApproveBalance,
  canCancel,
  currentCancelNonce,
  escrowDigest,
  safeMessageFor,
  signAsExporter,
  signAsImporter,
  signCancellation,
} from './closing';

// Well-known test keys (anvil accounts 1 and 2); never real wallets
const OWNER = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');
const EXPORTER = privateKeyToAccount('0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a');
const signerOf = (account: typeof OWNER): Signer => ({
  address: async () => account.address,
  signTypedData: (domain, types, primaryType, message) => account.signTypedData({ domain, types, primaryType, message } as never),
});

const SAFE = '0x5afe00000000000000000000000000000000cafe' as Hex;
const ESCROW = '0x00000000000000000000000000000000000e5c40' as Hex;
const setup = { chainId: 84532, escrow: ESCROW, safe: SAFE };
const ORDER = `0x${'ab'.repeat(32)}` as Hex;

const attestation: ShipmentAttestation = {
  orderId: ORDER,
  blNumberHash: blNumberHash('0x00000000000000000000000000000000000ca440', 'HLCU1234567'),
  onBoardDate: 1_790_000_000n,
  portOfLoading: bytes32Text('HKHKG'),
  docsHash: `0x${'cd'.repeat(32)}`,
};

const view = (over: Partial<OrderView> = {}): OrderView => ({
  orderId: ORDER,
  safe: SAFE.toLowerCase(),
  exporter: EXPORTER.address.toLowerCase(),
  order: { orderId: ORDER, importer: SAFE, exporter: EXPORTER.address },
  terms: {},
  sigImporter: '0x',
  sigExporter: '0x',
  shipment: { attestation: { ...attestation, onBoardDate: attestation.onBoardDate.toString() }, sigCarrier: '0x12' },
  state: 'SHIPPED',
  totalAmount: '10',
  advance: '3',
  locked: '7',
  createdAt: 1,
  you: ['importer'],
  ...over,
});

describe('closing signatures', () => {
  it('hash to the digest the escrow verifies', () => {
    const m = { orderId: ORDER, attestationHash: structHash('ShipmentAttestation', attestation) };
    expect(escrowDigest(setup, 'BalanceApproval', m)).toBe(typedDataDigest(keelDomain(setup.chainId, ESCROW), 'BalanceApproval', m));
    const c = { orderId: ORDER, nonce: 515n };
    expect(escrowDigest(setup, 'CancelOrder', c)).toBe(typedDataDigest(keelDomain(setup.chainId, ESCROW), 'CancelOrder', c));
  });

  it('the importer signs as an owner of the Safe over that digest (ERC-1271)', async () => {
    const m = { orderId: ORDER, attestationHash: structHash('ShipmentAttestation', attestation) };
    const sig = await signAsImporter(signerOf(OWNER), setup, SAFE, 'BalanceApproval', m);
    const digest = typedDataDigest(keelDomain(setup.chainId, ESCROW), 'BalanceApproval', m);
    expect(await recoverTypedDataAddress({ ...safeMessageFor(setup, SAFE, digest), signature: sig })).toBe(OWNER.address);
  });

  it('an importer that is the wallet itself and the exporter sign the struct directly', async () => {
    const c = { orderId: ORDER, nonce: 515n };
    const types = { CancelOrder: EIP712_TYPES.CancelOrder };
    const domain = keelDomain(setup.chainId, ESCROW);
    const byExporter = await signAsExporter(signerOf(EXPORTER), setup, 'CancelOrder', c);
    expect(await recoverTypedDataAddress({ domain, types, primaryType: 'CancelOrder', message: c, signature: byExporter })).toBe(EXPORTER.address);
    const byImporter = await signAsImporter(signerOf(OWNER), setup, OWNER.address, 'CancelOrder', c);
    expect(await recoverTypedDataAddress({ domain, types, primaryType: 'CancelOrder', message: c, signature: byImporter })).toBe(OWNER.address);
    await expect(signAsImporter(signerOf(EXPORTER), setup, OWNER.address, 'CancelOrder', c)).rejects.toThrow('not_importer');
  });

  it('names the attestation it can see', () => {
    expect(attestationHashOf(view())).toBe(structHash('ShipmentAttestation', attestation));
    expect(attestationHashOf(view({ shipment: undefined }))).toBeUndefined();
  });

  it('knows when each action applies', () => {
    expect(canApproveBalance(view())).toBe(true);
    expect(canApproveBalance(view({ closing: { balanceApproval: { sigImporter: '0x', attestationHash: ORDER } } }))).toBe(false);
    expect(canApproveBalance(view({ state: 'ADVANCE_PAID' }))).toBe(false);
    expect(['OPEN', 'ADVANCE_PAID', 'DISPUTED', 'SHIPPED', 'SETTLED'].map(canCancel)).toEqual([true, true, true, false, false]);
  });
});

describe('with the API', () => {
  it('approves the balance with the attestation hash it computed', async () => {
    const approve = vi.fn(async () => ({ orderId: ORDER, closing: {} }));
    await approveBalance({ approveBalance: approve } as unknown as ApiClient, signerOf(OWNER), setup, view());
    const [, orderId, body] = approve.mock.calls[0] as unknown as [Signer, Hex, { attestationHash: Hex; signature: Hex }];
    expect(orderId).toBe(ORDER);
    expect(body.attestationHash).toBe(structHash('ShipmentAttestation', attestation));
    const digest = typedDataDigest(keelDomain(setup.chainId, ESCROW), 'BalanceApproval', { orderId: ORDER, attestationHash: body.attestationHash });
    expect(await recoverTypedDataAddress({ ...safeMessageFor(setup, SAFE, digest), signature: body.signature })).toBe(OWNER.address);
  });

  it('asks the API for the current cancel nonce without signing anything', async () => {
    const probe = vi.fn(async () => {
      throw new ApiError(409, 'stale_cancel_nonce', { cancelNonce: '770' });
    });
    expect(await currentCancelNonce({ cancelSignature: probe } as unknown as ApiClient, signerOf(EXPORTER), ORDER, 'exporter')).toBe(770n);
    expect(probe.mock.calls[0]).toEqual([expect.anything(), ORDER, { nonce: '0', signature: '0x00', side: 'exporter' }]);
    const zero = vi.fn(async () => {
      throw new ApiError(422, 'bad_exporter_signature');
    });
    expect(await currentCancelNonce({ cancelSignature: zero } as unknown as ApiClient, signerOf(EXPORTER), ORDER, 'exporter')).toBe(0n);
    expect(await currentCancelNonce({} as ApiClient, signerOf(EXPORTER), ORDER, 'exporter', '515')).toBe(515n);
  });

  it('signs the cancellation again once when the order moved on', async () => {
    const calls: { nonce: string; signature: Hex }[] = [];
    const cancel = vi.fn(async (_s: Signer, _id: Hex, body: { nonce: string; signature: Hex }) => {
      calls.push(body);
      if (calls.length === 1) throw new ApiError(409, 'stale_cancel_nonce', { cancelNonce: '771' });
      return { orderId: ORDER, closing: {}, complete: true };
    });
    const result = await signCancellation({ cancelSignature: cancel } as unknown as ApiClient, signerOf(EXPORTER), setup, view({ you: ['exporter'] }), 'exporter', '515');
    expect(result.complete).toBe(true);
    expect(calls.map((c) => c.nonce)).toEqual(['515', '771']);
    const signed = await recoverTypedDataAddress({
      domain: keelDomain(setup.chainId, ESCROW),
      types: { CancelOrder: EIP712_TYPES.CancelOrder },
      primaryType: 'CancelOrder',
      message: { orderId: ORDER, nonce: 771n },
      signature: calls[1]!.signature,
    });
    expect(signed).toBe(EXPORTER.address);
  });
});
