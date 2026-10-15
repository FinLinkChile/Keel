import type { Hex } from '@keel/schemas';

import type { Account, KeelData, NeedsYou, Order, OrderStage, Party, PartyId, Role, Wallet } from './types';

// Test data for the screens. Order ids, labels and party slugs match bot/examples so the
// app and the bot tell the same story in the demo. Hashes are placeholders, not computed.

const day = (month: number, date: number) => Date.UTC(2026, month - 1, date) / 1000;
const id = (n: number): Hex => `0x${n.toString(16).padStart(64, '0')}`;
const fill = (digit: string): Hex => `0x${digit.repeat(64)}`;

const PARTIES: Party[] = [
  { id: 'acme-imports', short: 'Pacífico', name: 'Pacífico Foods SpA', place: 'Chile', address: '0x7A3f91C2b04E6d1A8c3F5e2D9b7A0c4E1f6B55D8', tint: 3 },
  { id: 'lingnan', short: 'Lingnan', name: 'Lingnan Hydrocolloids', place: 'Hong Kong', address: '0x5C1e0a9B7d3F2c6E8a4B1d9F0e7C3a5B2d6E04a1', tint: 0 },
  { id: 'kowloon', short: 'Kowloon', name: 'Kowloon Fine Chemicals', place: 'Hong Kong', address: '0x9B2d4F6a8C0e1B3d5F7a9C2e4B6d8F0a1C3e7A62', tint: 1 },
  { id: 'pearl-delta', short: 'Pearl Delta', name: 'Pearl Delta Ingredients', place: 'Guangzhou', address: '0x2E4a6C8e0B1d3F5a7C9e2B4d6F8a0C1e3B5d9F17', tint: 2 },
  { id: 'harbor-line', short: 'Harbor Line', name: 'Harbor Line', place: 'Hong Kong', address: '0x4D6f8B0d2A3c5E7f9B1d4A6c8E0f2B3d5A7c1E88' },
  { id: 'hk-arbitration', short: 'HK Arbitration', name: 'HK Trade Arbitration', place: 'Hong Kong', address: '0x6F8b0D2f4C5e7A9b1D3f6C8e0A2b4D5f7C9e3A09' },
  { id: 'keel-verifier', short: 'Keel verifier', name: 'Keel document verifier', place: 'Keel', address: '0x8A0c2E4a6D7f9C1a3E5b8D0f2C4a6E7b9D1f5C33' },
];

// Payout accounts signed in each order; never taken from a document
const PAYOUT: Record<PartyId, Hex> = {
  lingnan: '0x3E9dA4c7F1b2E8d06C5a9B3f7E1d4C8a2B6f8812',
  kowloon: '0x1C7bE3a9D5f2B8c04E6a1D9f3B7c5E2a8D4f6630',
  'pearl-delta': '0x7F2aC8e4B1d6F9a03C5e7B2d8F4a1C6e9B3d2A55',
};

const USDC: Hex = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const address = (party: PartyId) => PARTIES.find((p) => p.id === party)!.address;

type Seed = {
  n: number;
  goods: string;
  goodsShort?: string;
  quantity: string;
  exporter: PartyId;
  totalMinor: number;
  stage: OrderStage;
  deadline: number;
  hsCode: string;
  waitingOn?: Role;
  signedAt?: number;
  advancePaidAt?: number;
  shippedAt?: number;
  closedAt?: number;
  blockedBy?: Order['blockedBy'];
};

function order(s: Seed): Order {
  const label = `PO-${s.n.toString(16).padStart(4, '0')}`;
  return {
    label,
    goods: s.goods,
    goodsShort: s.goodsShort ?? s.goods,
    quantity: s.quantity,
    carrier: 'harbor-line',
    stage: s.stage,
    waitingOn: s.waitingOn,
    signedAt: s.signedAt,
    advancePaidAt: s.advancePaidAt,
    shippedAt: s.shippedAt,
    closedAt: s.closedAt,
    blockedBy: s.blockedBy,
    po: {
      orderId: id(s.n),
      importer: address('acme-imports'),
      exporter: address(s.exporter),
      payoutAddress: PAYOUT[s.exporter],
      token: USDC,
      totalAmount: BigInt(s.totalMinor),
      advanceBps: 5000,
      shipmentDeadline: BigInt(s.deadline),
      disputeWindow: 3n * 24n * 3600n,
      carrier: address('harbor-line'),
      arbiter: address('hk-arbitration'),
      documentVerifier: address('keel-verifier'),
      incoterm: fill('0'),
      termsHash: fill('1'),
      requiredDocsHash: fill('2'),
      nonce: BigInt(s.n),
    },
    terms: {
      orderNumber: label.replace('-', ''),
      currency: 'USD',
      invoiceAmountMinor: BigInt(s.totalMinor),
      hsCodes: [s.hsCode],
      documentHash: fill('3'),
    },
  };
}

// Ids 0x131, 0x142 and 0x150 are the orders of bot/examples (labels PO-0131, PO-0142, PO-0150).
// The label is the id written in hex, as in the bot examples.
const ORDERS: Order[] = [
  order({ n: 0x157, goods: 'Agar powder', goodsShort: 'Agar', quantity: '6,000 kg', exporter: 'lingnan', totalMinor: 4_800_000, stage: 'awaiting_signature', waitingOn: 'importer', deadline: day(11, 20), hsCode: '130231' }),
  order({ n: 0x142, goods: 'Agar powder', goodsShort: 'Agar', quantity: '6,000 kg', exporter: 'lingnan', totalMinor: 4_800_000, stage: 'advance_paid', waitingOn: 'exporter', deadline: day(11, 20), hsCode: '130231', signedAt: day(10, 2), advancePaidAt: day(10, 2) }),
  order({ n: 0x150, goods: 'Agar powder', goodsShort: 'Agar', quantity: '2,500 kg', exporter: 'lingnan', totalMinor: 2_000_000, stage: 'advance_paid', waitingOn: 'exporter', deadline: day(11, 20), hsCode: '130231', signedAt: day(10, 5), advancePaidAt: day(10, 5) }),
  order({ n: 0x139, goods: 'Carrageenan', quantity: '3,000 kg', exporter: 'pearl-delta', totalMinor: 2_150_000, stage: 'shipped', deadline: day(10, 30), hsCode: '130239', signedAt: day(9, 20), advancePaidAt: day(9, 20), shippedAt: day(10, 14) }),
  order({ n: 0x151, goods: 'Gelatin', quantity: '1,200 kg', exporter: 'kowloon', totalMinor: 1_325_000, stage: 'signed', deadline: day(12, 5), hsCode: '350300', signedAt: day(10, 13), blockedBy: 'supplier_check' }),
  order({ n: 0x131, goods: 'Agar powder', goodsShort: 'Agar', quantity: '6,000 kg', exporter: 'lingnan', totalMinor: 4_800_000, stage: 'settled', deadline: day(11, 20), hsCode: '130231', signedAt: day(9, 1), advancePaidAt: day(9, 1), shippedAt: day(10, 8), closedAt: day(10, 13) }),
  order({ n: 0x128, goods: 'Locust bean gum', quantity: '1,000 kg', exporter: 'pearl-delta', totalMinor: 1_960_000, stage: 'refunded', deadline: day(10, 1), hsCode: '130232', signedAt: day(8, 25), advancePaidAt: day(8, 25), closedAt: day(10, 2) }),
  order({ n: 0x119, goods: 'Pectin', quantity: '800 kg', exporter: 'pearl-delta', totalMinor: 1_120_000, stage: 'cancelled', deadline: day(10, 10), hsCode: '130220', signedAt: day(9, 10), advancePaidAt: day(9, 10), closedAt: day(9, 28) }),
];

const ACCOUNTS: Record<Role, Account> = {
  importer: { party: 'acme-imports', role: 'importer', title: 'owner' },
  exporter: { party: 'lingnan', role: 'exporter', title: 'owner' },
};

const WALLETS: Record<Role, Wallet> = {
  importer: {
    currency: 'USD',
    availableMinor: 13_240_000n,
    lockedMinor: 3_475_000n,
    agent: { on: true, usedMinor: 4_900_000n, monthlyLimitMinor: 8_000_000n },
  },
  exporter: {
    currency: 'USD',
    availableMinor: 8_615_000n,
    lockedMinor: 4_400_000n,
  },
};

const NEEDS_YOU: Record<Role, NeedsYou[]> = {
  importer: [
    { kind: 'sign_order', orderId: id(0x157) },
    { kind: 'verify_supplier', party: 'kowloon' },
  ],
  exporter: [{ kind: 'upload_documents', orderId: id(0x142) }],
};

export const mockData: KeelData = {
  account: async (role) => ACCOUNTS[role],
  party: async (party) => PARTIES.find((p) => p.id === party),
  partyByAddress: async (a) => PARTIES.find((p) => p.address.toLowerCase() === a.toLowerCase()),
  wallet: async (role) => WALLETS[role],
  orders: async () => ORDERS,
  order: async (orderId) => ORDERS.find((o) => o.po.orderId === orderId),
  needsYou: async (role) => NEEDS_YOU[role],
};
