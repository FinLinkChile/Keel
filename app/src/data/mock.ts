import type { Hex, OrderTerms, RequiredDocType } from '@keel/schemas';
import { bytes32Text, requiredDocsHash, termsHash } from '@keel/schemas/hash';
import { getAddress, keccak256, stringToBytes } from 'viem';

import { centsToToken } from './amounts';
import { orderIdOf } from './orderRules';
import type { Account, KeelData, NeedsYou, Order, OrderStage, Party, PartyId, Quote, Role, SupplierRecord, Wallet } from './types';

// Test data for the screens and the single source of the demo data files (scripts/demo-data.ts).
// Order ids, labels and party slugs match bot/examples so the app, the bot, ingest and the agent
// tell the same story. termsHash and requiredDocsHash are computed with the schemas helpers;
// documentHash stands for the order document with its proforma, which does not exist yet.

const day = (month: number, date: number) => Date.UTC(2026, month - 1, date) / 1000;
// Checksummed, as viem requires to sign or hash an address
const addr = (a: string): Hex => getAddress(a.toLowerCase());

// The gate only accepts the carrier, arbiter and verifier that Area 1 registered. The arbiter is an
// Area 4 test key (kept outside the repo, see app/README.md); the verifier is Area 2's policy key.
const PARTIES: Party[] = [
  { id: 'acme-imports', short: 'Pacífico', name: 'Pacífico Foods SpA', place: 'Chile', address: addr('0x7A3f91C2b04E6d1A8c3F5e2D9b7A0c4E1f6B55D8'), tint: 3, taxId: '765432103' },
  { id: 'lingnan', short: 'Lingnan', name: 'Lingnan Hydrocolloids', place: 'Hong Kong', address: addr('0x5C1e0a9B7d3F2c6E8a4B1d9F0e7C3a5B2d6E04a1'), tint: 0, bankAccount: '0128 4407 5512 0142' },
  { id: 'kowloon', short: 'Kowloon', name: 'Kowloon Fine Chemicals', place: 'Hong Kong', address: addr('0x9B2d4F6a8C0e1B3d5F7a9C2e4B6d8F0a1C3e7A62'), tint: 1, bankAccount: '0043 6620 1975 0151' },
  { id: 'pearl-delta', short: 'Pearl Delta', name: 'Pearl Delta Ingredients', place: 'Guangzhou', address: addr('0x2E4a6C8e0B1d3F5a7C9e2B4d6F8a0C1e3B5d9F17'), tint: 2, bankAccount: '3602 8815 4420 0139' },
  // The demo carrier key, testAccount("demo:carrier:harbor-line") of ingest's corpus: the
  // attestation of PO-0142 (redteam/corpus/demo) only verifies with this address
  { id: 'harbor-line', short: 'Harbor Line', name: 'Harbor Line', place: 'Hong Kong', address: addr('0xB4B5591aFF224D76dE4D59F9fD832f5aC26B7708') },
  { id: 'hk-arbitration', short: 'HK Arbitration', name: 'HK Trade Arbitration', place: 'Hong Kong', address: addr('0x21fbA41765a1e643F5b185309d3ea8179341Ac9b') },
  { id: 'keel-verifier', short: 'Keel verifier', name: 'Keel document verifier', place: 'Keel', address: addr('0xc7F2300AD6203D629d71aCe901e1B4e1b923A01C') },
];

// Payout accounts signed in each order; never taken from a document
const PAYOUTS: Record<PartyId, Hex> = {
  lingnan: addr('0x3E9dA4c7F1b2E8d06C5a9B3f7E1d4C8a2B6f8812'),
  kowloon: addr('0x1C7bE3a9D5f2B8c04E6a1D9f3B7c5E2a8D4f6630'),
  'pearl-delta': addr('0x7F2aC8e4B1d6F9a03C5e7B2d8F4a1C6e9B3d2A55'),
};

const USDC: Hex = addr('0x036CbD53842c5426634e7929541eC2318f3dCF7e');

// Test wallets stand in for the companies of the demo (importer: Pacífico, exporter: Lingnan),
// so what they sign matches the orders on screen and in the data files.
let bound: Partial<Record<PartyId, Hex>> = {};
// The demo exporter is registered as a supplier with its own address as payout account
let boundPayout: Partial<Record<PartyId, Hex>> = {};

// The app and the demo data script: the test wallets of the device, one per role. The importer is
// a Safe: when `importerSafe` is given it is the importer's address (po.importer), and the
// importer wallet is only a key that owns it.
export function bindWallets(wallets: Partial<Record<Role, Hex>>, importerSafe?: Hex) {
  bound = {};
  boundPayout = {};
  for (const role of ['importer', 'exporter'] as const) {
    const w = wallets[role];
    if (w) bound[ACCOUNTS[role].party] = addr(w);
  }
  if (wallets.importer && importerSafe) bound[ACCOUNTS.importer.party] = addr(importerSafe);
  if (wallets.exporter) boundPayout[ACCOUNTS.exporter.party] = addr(wallets.exporter);
}

const payoutOf = (party: PartyId): Hex => boundPayout[party] ?? PAYOUTS[party];

const parties = (): Party[] => PARTIES.map((p) => (bound[p.id] ? { ...p, address: bound[p.id]! } : p));
const address = (party: PartyId) => parties().find((p) => p.id === party)!.address;

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
  documents?: Order['documents'];
  // What the example proforma asked for
  quote?: Quote;
};

const REQUIRED_DOCS: RequiredDocType[] = ['BILL_OF_LADING', 'COMMERCIAL_INVOICE'];

function order(s: Seed): Order {
  const label = `PO-${s.n.toString(16).padStart(4, '0')}`;
  const terms: OrderTerms = {
    orderNumber: label.replace('-', ''),
    currency: 'USD',
    invoiceAmountMinor: BigInt(s.totalMinor),
    hsCodes: [s.hsCode],
    documentHash: keccak256(stringToBytes(`Keel demo order ${label}`)),
  };
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
    transportDoc: 'BILL_OF_LADING',
    documents: s.documents ?? [],
    quote: s.quote,
    po: {
      // As TradeEscrow.open requires; the fixed nonce is the order number, so the label
      // stays the same and the id follows the wallets bound to the parties
      orderId: orderIdOf(address('acme-imports'), address(s.exporter), BigInt(s.n)),
      importer: address('acme-imports'),
      exporter: address(s.exporter),
      payoutAddress: payoutOf(s.exporter),
      token: USDC,
      totalAmount: centsToToken(BigInt(s.totalMinor)),
      advanceBps: 5000,
      shipmentDeadline: BigInt(s.deadline),
      disputeWindow: 3n * 24n * 3600n,
      carrier: address('harbor-line'),
      arbiter: address('hk-arbitration'),
      documentVerifier: address('keel-verifier'),
      incoterm: bytes32Text('FOB'),
      termsHash: termsHash(terms),
      requiredDocsHash: requiredDocsHash(REQUIRED_DOCS),
      nonce: BigInt(s.n),
    },
    terms,
  };
}

// PO-0131, PO-0142 and PO-0150 are the orders of bot/examples. The label is the nonce in hex.
const ORDERS = (): Order[] => [
  order({ n: 0x157, goods: 'Agar powder', goodsShort: 'Agar', quantity: '6,000 kg', exporter: 'lingnan', totalMinor: 4_800_000, stage: 'awaiting_signature', waitingOn: 'importer', deadline: day(11, 20), hsCode: '130231' }),
  order({ n: 0x142, goods: 'Agar powder', goodsShort: 'Agar', quantity: '6,000 kg', exporter: 'lingnan', totalMinor: 4_800_000, stage: 'advance_paid', waitingOn: 'exporter', deadline: day(11, 20), hsCode: '130231', signedAt: day(10, 2), advancePaidAt: day(10, 2), quote: { amountCents: 4_800_000, advanceBps: 6000, issueDate: day(9, 28), latestShipmentDate: day(11, 20), lines: [{ hs_code: '130231', quantity: 6000, unit: 'KGM', amount_minor: 4_800_000 }] } }),
  order({ n: 0x150, goods: 'Agar powder', goodsShort: 'Agar', quantity: '2,500 kg', exporter: 'lingnan', totalMinor: 2_000_000, stage: 'advance_paid', waitingOn: 'exporter', deadline: day(11, 20), hsCode: '130231', signedAt: day(10, 5), advancePaidAt: day(10, 5) }),
  order({ n: 0x139, goods: 'Carrageenan', quantity: '3,000 kg', exporter: 'pearl-delta', totalMinor: 2_150_000, stage: 'shipped', deadline: day(10, 30), hsCode: '130239', signedAt: day(9, 20), advancePaidAt: day(9, 20), shippedAt: day(10, 14) }),
  order({ n: 0x151, goods: 'Gelatin', quantity: '1,200 kg', exporter: 'kowloon', totalMinor: 1_325_000, stage: 'signed', deadline: day(12, 5), hsCode: '350300', signedAt: day(10, 13), blockedBy: 'supplier_check' }),
  order({ n: 0x131, goods: 'Agar powder', goodsShort: 'Agar', quantity: '6,000 kg', exporter: 'lingnan', totalMinor: 4_800_000, stage: 'settled', deadline: day(11, 20), hsCode: '130231', signedAt: day(9, 1), advancePaidAt: day(9, 1), shippedAt: day(10, 8), closedAt: day(10, 13), quote: { amountCents: 5_000_000, advanceBps: 5000, issueDate: day(8, 27), latestShipmentDate: day(11, 20), lines: [{ hs_code: '130231', quantity: 6000, unit: 'KGM', amount_minor: 4_500_000 }] } }),
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

// By label: the ids depend on the bound wallets
type Pending = { kind: 'sign_order' | 'upload_documents'; label: string } | { kind: 'verify_supplier'; party: PartyId };
const NEEDS_YOU: Record<Role, Pending[]> = {
  importer: [
    { kind: 'sign_order', label: 'PO-0157' },
    { kind: 'verify_supplier', party: 'kowloon' },
  ],
  exporter: [{ kind: 'upload_documents', label: 'PO-0142' }],
};

// A supplier is verified once its payout account is registered and no supplier check is pending
// for it: Kowloon's check is open (PO-0151 waits on it), so it cannot receive a new order yet.
const verifiedSuppliers = (): SupplierRecord[] => {
  const pending = new Set(NEEDS_YOU.importer.flatMap((n) => (n.kind === 'verify_supplier' ? [n.party] : [])));
  return parties()
    .filter((p) => PAYOUTS[p.id] && !pending.has(p.id))
    .map((party) => ({ party, payoutAddress: payoutOf(party.id) }));
};

const idOf = (label: string) => ORDERS().find((o) => o.label === label)!.po.orderId;

export const mockData: KeelData = {
  account: async (role) => ACCOUNTS[role],
  party: async (party) => parties().find((p) => p.id === party),
  partyByAddress: async (a) => parties().find((p) => p.address.toLowerCase() === a.toLowerCase()),
  wallet: async (role) => WALLETS[role],
  orders: async () => ORDERS(),
  order: async (orderId) => ORDERS().find((o) => o.po.orderId === orderId),
  needsYou: async (role) =>
    NEEDS_YOU[role].map((n): NeedsYou => (n.kind === 'verify_supplier' ? n : { kind: n.kind, orderId: idOf(n.label) })),
  verifiedSuppliers: async () => verifiedSuppliers(),
  tradeRegistry: async () => ({
    token: USDC,
    carrier: parties().find((p) => p.id === 'harbor-line')!,
    arbiter: parties().find((p) => p.id === 'hk-arbitration')!,
    documentVerifier: parties().find((p) => p.id === 'keel-verifier')!,
  }),
};
