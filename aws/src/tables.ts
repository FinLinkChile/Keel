// The shape of every DynamoDB item, in one place. Keys match infra/terraform/locals.tf:
//
//   proposals    orderId              GSI byImporter (importer), byExporter (exporter); Stream
//   orders       orderId              GSI bySafe (safe)
//   parties      address              (lowercase)
//   agent_state  id                   TTL attribute `ttl`
//   ingest       pk, sk               TTL attribute `ttl`
//   bot          pk, sk               TTL attribute `ttl`
//
// Addresses used as keys are lowercase. bigints are decimal strings. Structs signed with EIP-712
// are stored exactly as signed (the JSON the demo files of engine/src/agent/store.ts use), so
// the engine revivers read them back.
import type { Hex } from "@keel/schemas";

// ---------------------------------------------------------------- proposals

export type ProposalStatus = "awaiting_exporter" | "awaiting_importer" | "fully_signed" | "rejected";

export interface ProposalItem {
  orderId: Hex;
  importer: string; // lowercase Safe of the importer (po.importer)
  exporter: string; // lowercase (po.exporter)
  status: ProposalStatus;
  // PurchaseOrder and OrderTerms as JSON (bigints as strings), frozen when the importer sent it
  po: Record<string, unknown>;
  terms: Record<string, unknown>;
  label?: string; // PO-0131
  goods?: string;
  // The exporter may counter with different po/terms; `proposed` keeps the original
  proposed?: { po: Record<string, unknown>; terms: Record<string, unknown> };
  sigExporter?: Hex;
  sigImporter?: Hex;
  // EOA of the representative who signed for the importer Safe (ERC-1271)
  importerSigner?: string;
  createdAt: number; // unix seconds
  updatedAt: number;
  exporterSignedAt?: number;
  importerSignedAt?: number;
  rejectedBy?: string;
}

// ---------------------------------------------------------------- orders

// What the agent needs, what the API reads and what the indexer mirrors from the chain.
export interface OrderItem {
  orderId: Hex;
  safe: string; // lowercase po.importer
  exporter: string; // lowercase
  // engine StoredOrder: { order, terms, label }
  order: Record<string, unknown>;
  terms: Record<string, unknown>;
  label?: string;
  sigImporter: Hex;
  sigExporter: Hex;
  // engine StoredShipment
  shipment?: { attestation: Record<string, unknown>; sigCarrier: Hex };
  // engine StoredDocuments
  documents?: { extractions: Record<string, unknown>; fileHashes: Hex[] };
  // Closing signatures the agent submits on its next pass
  closing?: {
    balanceApproval?: { sigImporter: Hex; attestationHash: Hex };
    cancel?: { cancelNonce: string; sigImporter?: Hex; sigExporter?: Hex };
    resolution?: { toImporter: string; toExporter: string; sigArbiter: Hex };
  };
  // Who may upload documents for this order (ingest TradeOrderEntry.uploaders)
  uploaders: { address: string; party: "importer" | "exporter" }[];
  // Mirror of the escrow, written by the indexer only
  chain?: { state: string; updatedBlock: string; lastTx?: Hex; lastEvent?: string };
  createdAt: number;
}

// Orders the agent still has to act on. The fan-out only lists Safes with at least one.
export const LIVE_STATES = ["NONE", "OPEN", "ADVANCE_PAID", "SHIPPED", "DISPUTED"] as const;

// ---------------------------------------------------------------- parties

export interface PartyItem {
  address: string; // lowercase EOA or Safe
  kind: "importer" | "exporter" | "carrier" | "arbiter" | "representative";
  // For a representative: the Safe it signs for. For an importer Safe: its representatives.
  safe?: string;
  representatives?: string[];
  taxId?: string;
  name?: string;
  account?: string; // bot account id (Area 4), notices name accounts, never addresses
  // Totals of earlier orders, for an exporter (decimal strings), engine Registry.history
  history?: string[];
  // Known supplier of an importer Safe: exporter -> payout addresses
  knownPayouts?: string[];
}

// ---------------------------------------------------------------- agent_state

// id values:
//   lock#<relayerAddress>            { owner, ttl }                 one agent pass per relayer
//   notice#<dedupKey>                { ttl }                        a notice already sent
//   cursor#monitor | cursor#indexer  { block }                      next block to read
//   pause#monitor                    { pausedHere: boolean }
export interface AgentStateItem {
  id: string;
  ttl?: number;
  owner?: string;
  block?: string;
  pausedHere?: boolean;
}

// ---------------------------------------------------------------- bot
//
// Written and read through the bot's KeyValueStore (bot/src/adapters/kv/store.ts, keys there),
// implemented on DynamoDB by ./bot/dynamo-kv.ts. `ttl` is Unix seconds; an item past it is
// treated as absent on every read, since DynamoDB deletes it late.
//
//   pk                    sk                         attributes                         writer
//   account#<accountId>   meta                       name, kind                         botAdmin
//   account#<accountId>   chat#<role>#<chatId>       chatId                             botAdmin
//   order#<orderId>       meta                       label, importer, exporter,         botAdmin
//                                                    arbiter?, shipmentDeadline
//   order#<orderRef>      hold#<side>                ttl (365 days)                     botNotify
//   index                 account#<id> | order#<id>  (none)                             botAdmin
//   audit#recipients      <ISO time>#<nonce>         type, at, actor, changes           botAdmin
//   notice#<noticeId>     seen                       ttl (30 days)                      botNotify
//   notice#<noticeId>     chat#<chatId>              ttl (30 days), delivery claim      botNotify
//   chat#<chatId>         hour#<hourStartMs>         count, overflowSent?, ttl          botNotify
//
// Account ids are the bot's registry ids (PartyItem.account), never addresses. orderId is the
// bytes32 id in lowercase. Withheld diff values are never stored.
export interface BotItem {
  pk: string;
  sk: string;
  ttl?: number;
  [attribute: string]: unknown;
}

export const stateId = {
  lock: (relayer: string) => `lock#${relayer.toLowerCase()}`,
  notice: (key: string) => `notice#${key}`,
  cursor: (name: "monitor" | "indexer") => `cursor#${name}`,
  pause: () => "pause#monitor",
} as const;
