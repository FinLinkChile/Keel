import type { PurchaseOrder } from '@keel/schemas';
import { concat, keccak256, pad, toHex } from 'viem';
import { describe, expect, it } from 'vitest';

import { checkOrderShape, orderIdOf } from './orderRules';

const IMP = '0x7A3f91c2B04E6D1a8C3f5E2D9b7A0C4E1f6B55d8';
const EXP = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const a = (n: number) => pad(toHex(n), { size: 20 });

describe('orderIdOf', () => {
  it('is keccak256(abi.encode(importer, exporter, nonce)), as TradeEscrow.open checks', () => {
    // abi.encode of three static values is three 32-byte words, left padded
    const expected = keccak256(concat([pad(IMP), pad(EXP), toHex(0x142n, { size: 32 })]));
    expect(orderIdOf(IMP, EXP, 0x142n)).toBe(expected);
  });

  it('changes with the wallets and with the nonce', () => {
    expect(orderIdOf(IMP, EXP, 1n)).not.toBe(orderIdOf(EXP, IMP, 1n));
    expect(orderIdOf(IMP, EXP, 1n)).not.toBe(orderIdOf(IMP, EXP, 2n));
  });
});

describe('checkOrderShape', () => {
  const NOW = 1_792_000_000;
  const good: PurchaseOrder = {
    orderId: orderIdOf(IMP, EXP, 7n),
    importer: IMP,
    exporter: EXP,
    payoutAddress: a(3),
    token: a(4),
    totalAmount: 4_800_000n,
    advanceBps: 5000,
    shipmentDeadline: BigInt(NOW + 86_400),
    disputeWindow: 120n,
    carrier: a(5),
    arbiter: a(6),
    documentVerifier: a(7),
    incoterm: pad('0x00'),
    termsHash: pad('0x01'),
    requiredDocsHash: pad('0x02'),
    nonce: 7n,
  };
  const check = (po: Partial<PurchaseOrder>, escrow?: `0x${string}`) => checkOrderShape({ ...good, ...po }, { now: NOW, escrow });

  it('accepts an order open() would accept', () => {
    expect(check({})).toEqual([]);
  });

  it('refuses what open() refuses', () => {
    expect(check({ nonce: 8n })).toContain('bad_order_id');
    expect(check({ carrier: a(0) })).toContain('missing_address');
    expect(check({ documentVerifier: IMP })).toContain('third_party_not_independent');
    expect(check({ documentVerifier: a(5) })).toContain('third_party_not_independent'); // verifier is the carrier
    expect(check({ arbiter: a(5) })).toContain('third_party_not_independent'); // carrier judges a dispute about itself
    expect(check({ carrier: a(3) })).toContain('third_party_not_independent'); // carrier is the payout
    expect(check({}, a(6))).toContain('escrow_as_party');
    expect(check({ advanceBps: 10_001 })).toContain('bad_advance');
    expect(check({ totalAmount: 0n })).toContain('bad_amount');
    expect(check({ shipmentDeadline: BigInt(NOW) })).toContain('deadline_passed');
  });
});
