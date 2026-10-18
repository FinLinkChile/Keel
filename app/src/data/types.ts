import type { Hex, OrderTerms, PurchaseOrder, RequiredDocType } from '@keel/schemas';

// Same slugs as bot/examples/recipients.json
export type PartyId = string;

export type Party = {
  id: PartyId;
  name: string;
  // Short form for lists and sentences: "Lingnan", "Pearl Delta"
  short: string;
  // Shown under the name: "Hong Kong", "Chile"
  place: string;
  // Company wallet that signs orders (the importer and exporter of a PurchaseOrder)
  address: Hex;
  // Chilean RUT without dots or dash, for the importer: the invoice is checked against it
  taxId?: string;
  // Bank account registered for an exporter, as its invoice prints it. A document may print it
  // without raising an alert; the escrow still pays only the order's payoutAddress.
  bankAccount?: string;
  // Avatar colour when the party is shown as a counterparty. Your own company is drawn
  // without it.
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
  | 'cancelled' // mutual cancellation
  | 'rejected'; // the exporter refused to sign the proposed order

// A document already uploaded for an order, as the exporter sees it: only its outcome.
export type OrderDocument = {
  docType: RequiredDocType;
  fileName: string;
  uploadedAt: number;
  status: 'accepted' | 'under_review';
};

// What the proforma asked for, kept with the order to compare with what was signed. Not part of
// the signed terms.
export type Quote = {
  amountCents: number | null;
  advanceBps: number | null;
  // Unix seconds
  issueDate: number | null;
  latestShipmentDate: number | null;
};

export type Order = {
  label: string; // "PO-0142", as in bot/examples/orders.json
  goods: string; // "Agar powder"
  goodsShort: string; // "Agar", for lists
  quantity: string; // "6,000 kg"
  carrier: PartyId;
  stage: OrderStage;
  // Who has to act next, if anyone
  waitingOn?: Role;
  // Unix seconds of each step that happened. sentAt and exporterSignedAt exist for orders
  // proposed on this phone.
  sentAt?: number;
  exporterSignedAt?: number;
  signedAt?: number;
  advancePaidAt?: number;
  shippedAt?: number;
  closedAt?: number;
  // Why it waits, for orders that are blocked on something other than a party
  blockedBy?: 'supplier_check';
  // Bill of lading for sea freight, air waybill for air
  transportDoc: 'BILL_OF_LADING' | 'AIR_WAYBILL';
  documents: OrderDocument[];
  po: PurchaseOrder;
  terms: OrderTerms;
  quote?: Quote;
  // Escrow state as the Keel API's indexer mirrors it ("NONE", "OPEN", "SHIPPED", "DISPUTED"…),
  // only for orders read from the API. DISPUTED shows as stage 'shipped'; RESOLVED as 'settled'.
  escrowState?: string;
  // The carrier's attestation of the shipment as the API holds it (attestation fields as strings),
  // only for orders read from the API once the shipment is attested
  shipment?: { attestation: Record<string, unknown>; sigCarrier: string };
};

export type Wallet = {
  currency: string;
  availableMinor: bigint;
  lockedMinor: bigint;
  // The importer's agent, which funds the escrow. The exporter has no agent that spends.
  agent?: { on: boolean; usedMinor: bigint; monthlyLimitMinor: bigint };
};

export type NeedsYou =
  | { kind: 'sign_order'; orderId: Hex }
  | { kind: 'verify_supplier'; party: PartyId }
  | { kind: 'upload_documents'; orderId: Hex }
  // From the Keel API (GET /needs-you): the shipment is attested, the importer may release the
  // balance; and the other side signed a cancellation this side has not signed yet
  | { kind: 'approve_balance'; orderId: Hex }
  | { kind: 'sign_cancel'; orderId: Hex; cancelNonce?: string };

// A supplier that went through the supplier check, with the payout account registered then. The
// payout address is the only place an order takes its payee from.
export type SupplierRecord = {
  party: Party;
  payoutAddress: Hex;
};

// The fixed third parties and the token of the corridor (carrier, arbiter and document verifier
// are test keys in the prototype)
export type TradeSetup = {
  token: Hex;
  carrier: Party;
  arbiter: Party;
  documentVerifier: Party;
};

// Read side of the app. The mock implementation lives in ./mock.ts; a real one reads the
// contract events and the agent service.
export interface KeelData {
  // The company behind the connected wallet, for the role chosen at Connect
  account(role: Role): Promise<Account>;
  party(id: PartyId): Promise<Party | undefined>;
  partyByAddress(address: Hex): Promise<Party | undefined>;
  wallet(role: Role): Promise<Wallet>;
  orders(): Promise<Order[]>;
  order(orderId: Hex): Promise<Order | undefined>;
  needsYou(role: Role): Promise<NeedsYou[]>;
  // Suppliers the importer can open an order with: only those that passed the supplier check
  verifiedSuppliers(): Promise<SupplierRecord[]>;
  tradeRegistry(): Promise<TradeSetup>;
}
