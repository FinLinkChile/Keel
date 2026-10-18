// Signed orders from the app (T3.11, decision 17, open decision 15). When both parties have
// signed, the app sends the agent's order.json: the PurchaseOrder, its terms, its label and both
// EIP-712 signatures. Ingest trusts nothing it is sent: the order is accepted only if its terms
// hash to termsHash, its orderId is the one of its parties and nonce, its importer is registered
// and both signatures are valid. Then the parties may upload its documents (T3.1) and the agent
// gets the file it opens the escrow with.
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createPublicClient,
  encodeAbiParameters,
  hashTypedData,
  http,
  keccak256,
  recoverTypedDataAddress,
  type Hex as ViemHex,
} from "viem";
import { z } from "zod";
import { EIP712_TYPES, keelDomain, OrderTerms, type Hex, type PurchaseOrder } from "@keel/schemas";
import { termsHash } from "@keel/schemas/hash";
import type { IngestStore } from "../store";
import type { ImporterRegistry } from "./proforma";
import type { OrderRegistry, TradeOrderEntry } from "./upload";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const BYTES32 = /^0x[0-9a-fA-F]{64}$/;
const UINT = /^[0-9]{1,78}$/;

const address = z.string().regex(ADDRESS);
const bytes32 = z.string().regex(BYTES32);
const uint = z.string().regex(UINT);

// The order as the app sends it: canonical JSON, bigints as decimal text (engine/src/canonical.ts)
const OrderBody = z
  .object({
    orderId: bytes32,
    importer: address,
    exporter: address,
    payoutAddress: address,
    token: address,
    totalAmount: uint,
    advanceBps: z.number().int().min(0).max(10_000),
    shipmentDeadline: uint,
    disputeWindow: uint,
    carrier: address,
    arbiter: address,
    documentVerifier: address,
    incoterm: bytes32,
    termsHash: bytes32,
    requiredDocsHash: bytes32,
    nonce: uint,
  })
  .strict();

export const SignedOrderBody = z
  .object({
    order: OrderBody,
    terms: z.object({ orderNumber: z.string(), currency: z.string(), invoiceAmountMinor: uint, hsCodes: z.array(z.string()), documentHash: z.string() }).strict(),
    // "PO-0158": what people call the order in the notices
    label: z.string().regex(/^[A-Za-z0-9-]{1,32}$/),
    sigImporter: z.string().regex(/^0x[0-9a-fA-F]{130,}$/),
    sigExporter: z.string().regex(/^0x[0-9a-fA-F]{130}$/),
  })
  .strict();
export type SignedOrderBody = z.infer<typeof SignedOrderBody>;

// Whether `signature` is `address` signing the typed data. An account is checked off chain; a
// contract wallet (the importer's Safe, ERC-1271) can only be checked by asking the chain.
export interface SignatureCheck {
  readonly onChain: boolean;
  isValid(address: Hex, typedData: TypedData, signature: Hex): Promise<boolean>;
}

type TypedData = Parameters<typeof hashTypedData>[0];

export const offlineSignatures: SignatureCheck = {
  onChain: false,
  isValid: async (addr, typedData, signature) => {
    try {
      const signer = await recoverTypedDataAddress({ ...typedData, signature: signature as ViemHex } as Parameters<typeof recoverTypedDataAddress>[0]);
      return signer.toLowerCase() === addr.toLowerCase();
    } catch {
      return false;
    }
  },
};

// viem asks the chain: ecrecover for an account, isValidSignature for a contract (ERC-1271)
export function chainSignatures(rpcUrl: string): SignatureCheck {
  const client = createPublicClient({ transport: http(rpcUrl) });
  return {
    onChain: true,
    isValid: async (addr, typedData, signature) => {
      try {
        return await client.verifyTypedData({ address: addr as ViemHex, signature: signature as ViemHex, ...typedData } as Parameters<typeof client.verifyTypedData>[0]);
      } catch {
        return false;
      }
    },
  };
}

export type SignedOrderRejection =
  | "invalid_request"
  | "terms_mismatch"
  | "bad_order_id"
  | "unknown_importer"
  | "bad_exporter_signature"
  | "bad_importer_signature"
  | "conflict";

export type SignedOrderOutcome =
  | { status: "rejected"; reason: SignedOrderRejection }
  | { status: "registered"; orderId: Hex; already: boolean };

export interface SignedOrderOptions {
  store: IngestStore;
  chainId: number;
  escrow: Hex;
  importers: ImporterRegistry;
  signatures: SignatureCheck;
  // Where the agent reads orders/<orderId>/order.json; nothing is written without it
  agentDir?: string;
}

const UINT_FIELDS = ["totalAmount", "shipmentDeadline", "disputeWindow", "nonce"] as const;

function reviveOrder(o: z.infer<typeof OrderBody>): PurchaseOrder {
  const order = { ...o } as Record<string, unknown>;
  for (const k of UINT_FIELDS) order[k] = BigInt(o[k]);
  return order as unknown as PurchaseOrder;
}

export const orderIdOf = (importer: Hex, exporter: Hex, nonce: bigint): Hex =>
  keccak256(encodeAbiParameters([{ type: "address" }, { type: "address" }, { type: "uint256" }], [importer as ViemHex, exporter as ViemHex, nonce])) as Hex;

const purchaseOrderTypedData = (chainId: number, escrow: Hex, order: PurchaseOrder): TypedData =>
  ({ domain: keelDomain(chainId, escrow), types: { PurchaseOrder: EIP712_TYPES.PurchaseOrder }, primaryType: "PurchaseOrder", message: order }) as unknown as TypedData;

// What an owner of the importer's Safe signs (the Safe's CompatibilityFallbackHandler, ERC-1271):
// the EIP-712 SafeMessage over abi.encode(purchaseOrderDigest), with the Safe as verifying contract
const safeMessageTypedData = (chainId: number, safe: Hex, digest: Hex): TypedData =>
  ({
    domain: { chainId, verifyingContract: safe },
    types: { SafeMessage: [{ name: "message", type: "bytes" }] },
    primaryType: "SafeMessage",
    message: { message: encodeAbiParameters([{ type: "bytes32" }], [digest as ViemHex]) },
  }) as TypedData;

// Keys sorted, bigints as decimal text: the same file whoever writes it
export function canonicalJson(value: unknown): string {
  const sort = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(sort) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, sort((v as Record<string, unknown>)[k])])) : v;
  return JSON.stringify(sort(value), null, 2) + "\n";
}

export async function receiveSignedOrder(raw: unknown, opts: SignedOrderOptions): Promise<SignedOrderOutcome> {
  const parsed = SignedOrderBody.safeParse(raw);
  if (!parsed.success) return { status: "rejected", reason: "invalid_request" };
  const body = parsed.data;
  const order = reviveOrder(body.order);
  const terms = OrderTerms.safeParse({ ...body.terms, invoiceAmountMinor: BigInt(body.terms.invoiceAmountMinor) });
  if (!terms.success) return { status: "rejected", reason: "invalid_request" };

  // The terms are what both parties signed through termsHash, and the id belongs to the parties
  if (termsHash(terms.data).toLowerCase() !== order.termsHash.toLowerCase()) return { status: "rejected", reason: "terms_mismatch" };
  if (orderIdOf(order.importer, order.exporter, order.nonce).toLowerCase() !== order.orderId.toLowerCase()) {
    return { status: "rejected", reason: "bad_order_id" };
  }
  if (!opts.importers.has(order.importer)) return { status: "rejected", reason: "unknown_importer" };

  const typed = purchaseOrderTypedData(opts.chainId, opts.escrow, order);
  if (!(await opts.signatures.isValid(order.exporter, typed, body.sigExporter as Hex))) return { status: "rejected", reason: "bad_exporter_signature" };

  // The key that signs for the importer: the importer itself, or an owner of its Safe
  const digest = hashTypedData(typed) as Hex;
  let owner: Hex | undefined;
  try {
    owner = (await recoverTypedDataAddress({ ...typed, signature: body.sigImporter as ViemHex } as Parameters<typeof recoverTypedDataAddress>[0])) as Hex;
    if (owner.toLowerCase() !== order.importer.toLowerCase()) owner = undefined;
  } catch {
    owner = undefined;
  }
  if (!owner) {
    try {
      owner = (await recoverTypedDataAddress({ ...safeMessageTypedData(opts.chainId, order.importer, digest), signature: body.sigImporter as ViemHex } as Parameters<typeof recoverTypedDataAddress>[0])) as Hex;
    } catch {
      return { status: "rejected", reason: "bad_importer_signature" };
    }
    // With the chain, the Safe itself says whether that key may sign for it. Without it, the key
    // has to be registered as the importer's: a weaker check, for a demo without an RPC.
    const valid = opts.signatures.onChain ? await opts.signatures.isValid(order.importer, typed, body.sigImporter as Hex) : opts.importers.has(owner);
    if (!valid) return { status: "rejected", reason: "bad_importer_signature" };
  }

  const file = canonicalJson(body);
  const existing = opts.store.signedOrder(order.orderId);
  if (existing) {
    return existing.body === file ? { status: "registered", orderId: order.orderId, already: true } : { status: "rejected", reason: "conflict" };
  }
  const entry: TradeOrderEntry = {
    orderId: order.orderId,
    payoutAddress: order.payoutAddress,
    carrier: order.carrier,
    uploaders: [
      { address: owner, party: "importer" },
      { address: order.exporter, party: "exporter" },
    ],
  };
  opts.store.saveSignedOrder(order.orderId, entry, file);
  if (opts.agentDir) {
    const dir = join(opts.agentDir, "orders", order.orderId.toLowerCase());
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "order.json"), file);
  }
  return { status: "registered", orderId: order.orderId, already: false };
}

// The orders file of the prototype, plus the orders registered from the app
export function withSignedOrders(file: OrderRegistry, store: IngestStore): OrderRegistry {
  return { get: (orderId) => file.get(orderId) ?? store.signedOrder(orderId)?.entry };
}
