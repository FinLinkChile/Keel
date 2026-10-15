import type { Hex, OrderTerms, PurchaseOrder } from '@keel/schemas';

// Same slugs as bot/examples/recipients.json
export type PartyId = string;

export type Party = {
  id: PartyId;
  name: string;
  // Shown under the name: "Hong Kong", "Chile"
  place: string;
  // Company wallet that signs orders (the importer and exporter of a PurchaseOrder)
  address: Hex;
  // Avatar colour, fixed per party; undefined for your own company
  tint?: number;
};

export type Role = 'importer' | 'exporter';

export type Account = {
  party: PartyId;
  role: Role;
  // Person behind the wallet: "owner", "operator", "cosigner"
  title: 'owner' | 'operator' | 'cosigner';
};

// Where an order is in the flow (docs/flujo/flujo-clave.md). Funding and the advance
// are one transaction (open decision 2), so there is no "funded" stage.
export type OrderStage =
  | 'awaiting_signature' // step 1, one party signed
  | 'signed' // step 1 done, waiting for the deposit
  | 'advance_paid' // steps 2 and 3 done, waiting for the shipment
  | 'shipped' // step 4 done, dispute window running
  | 'settled' // step 5
  | 'refunded' // step 6
  | 'cancelled'; // mutual cancellation

export type Order = {
  label: string; // "PO-0142", as in bot/examples/orders.json
  goods: string; // "Agar powder"
  quantity: string; // "6,000 kg"
  carrier: PartyId;
  stage: OrderStage;
  // Who has to act next, if anyone
  waitingOn?: Role;
  // Unix seconds of each step that happened
  signedAt?: number;
  advancePaidAt?: number;
  shippedAt?: number;
  closedAt?: number;
  // Why it waits, for orders that are blocked on something other than a party
  blockedBy?: 'supplier_check';
  po: PurchaseOrder;
  terms: OrderTerms;
};

export type Wallet = {
  currency: string;
  availableMinor: bigint;
  lockedMinor: bigint;
  agent: { on: boolean; usedMinor: bigint; monthlyLimitMinor: bigint };
};

export type NeedsYou =
  | { kind: 'sign_order'; orderId: Hex }
  | { kind: 'verify_supplier'; party: PartyId };

// Read side of the app. The mock implementation lives in ./mock.ts; a real one reads the
// contract events and the agent service.
export interface KeelData {
  account(): Promise<Account>;
  party(id: PartyId): Promise<Party | undefined>;
  partyByAddress(address: Hex): Promise<Party | undefined>;
  wallet(): Promise<Wallet>;
  orders(): Promise<Order[]>;
  order(orderId: Hex): Promise<Order | undefined>;
  needsYou(): Promise<NeedsYou[]>;
}
