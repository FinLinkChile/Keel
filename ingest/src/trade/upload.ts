// Authenticated upload of the Keel Trade documents. T3.1, issue #18.
// A document of an order is uploaded from the app by a representative of one of its parties,
// who signs with their wallet an EIP-712 message over the order, the declared document type
// and the keccak256 of the exact file. Ingest recovers the signer and records who uploaded
// what. A document that is not signed by a registered representative is never read.
import { recoverTypedDataAddress, keccak256, type Hex as ViemHex } from "viem";
import type { Hex, RequiredDocType } from "@keel/schemas";
import { REQUIRED_DOC_TYPES } from "@keel/schemas";
import type { PaymentDestination } from "../parser";

// Its own domain name, so an upload signature can never be replayed as one of the structs the
// contracts verify (domain "Keel"). There is no verifying contract: ingest checks it off chain.
export const uploadDomain = (chainId: number) => ({ name: "Keel Ingest", version: "1", chainId }) as const;

export const UPLOAD_TYPES = {
  DocumentUpload: [
    { name: "orderId", type: "bytes32" },
    { name: "docType", type: "string" },
    { name: "fileHash", type: "bytes32" },
    { name: "issuedAt", type: "uint64" },
  ],
} as const;

export interface DocumentUpload {
  orderId: Hex;
  docType: RequiredDocType;
  // keccak256 of the file bytes, the hash that goes into docsHash
  fileHash: Hex;
  // Unix seconds. Accepted within UPLOAD_MAX_SKEW_SECONDS of the server clock.
  issuedAt: bigint;
}

export const UPLOAD_MAX_SKEW_SECONDS = 10 * 60;

export type Party = "importer" | "exporter";

// What ingest knows about an order: who may upload its documents and where the exporter is
// paid. In the prototype it comes from a file (INGEST_ORDERS_FILE); it mirrors the signed
// order and the party registry, it never comes from a document.
export interface TradeOrderEntry {
  orderId: Hex;
  // From the signed PurchaseOrder: the only address the escrow pays the exporter
  payoutAddress: Hex;
  // From the signed PurchaseOrder: who signs the shipment attestation. A B/L number is unique
  // per carrier, so it is part of blNumberHash.
  carrier: Hex;
  // Representatives' wallets (EOAs). A Safe cannot sign here: its owners sign for it.
  uploaders: { address: Hex; party: Party }[];
  // Bank accounts or wallets registered for the exporter, which a document may print without
  // raising an alert (T3.6). Optional.
  knownDestinations?: PaymentDestination[];
}

// Synchronous for a file, asynchronous for a database (aws/src/ingest reads DynamoDB)
export interface OrderRegistry {
  get(orderId: Hex): TradeOrderEntry | undefined | Promise<TradeOrderEntry | undefined>;
}

export const staticOrders = (orders: readonly TradeOrderEntry[]): OrderRegistry => {
  const byId = new Map(orders.map((o) => [o.orderId.toLowerCase(), o]));
  return { get: (orderId) => byId.get(orderId.toLowerCase()) };
};

export const fileHash = (file: Uint8Array): Hex => keccak256(file);

export const UPLOAD_REJECTIONS = ["too_large", "unknown_order", "unknown_doc_type", "bad_signature", "stale_signature", "not_a_party"] as const;
export type UploadRejection = (typeof UPLOAD_REJECTIONS)[number];

export interface UploadRequest {
  orderId: Hex;
  docType: string;
  issuedAt: number;
  signature: Hex;
  file: Uint8Array;
}

// The same request before the file exists: the uploader declares the hash it signed. Used to
// hand out a presigned upload URL (aws/src/handlers/upload.ts); the reader recomputes the hash
// from the bytes that arrive and refuses a file whose hash is not the declared one.
export interface DeclaredUpload extends Omit<UploadRequest, "file"> {
  fileHash: Hex;
}

export type UploadAuth =
  | { status: "rejected"; reason: UploadRejection }
  | { status: "authorized"; order: TradeOrderEntry; docType: RequiredDocType; uploader: Hex; party: Party; fileHash: Hex };

// The signature covers the hash the server computes from the bytes it received: a file swapped
// after signing recovers a different address and is rejected as not_a_party.
export async function authorizeUpload(
  req: UploadRequest,
  orders: OrderRegistry,
  chainId: number,
  now: Date = new Date(),
): Promise<UploadAuth> {
  const { file, ...rest } = req;
  return authorizeDeclaredUpload({ ...rest, fileHash: fileHash(file) }, orders, chainId, now);
}

// Authorization from a declared hash. Callers that hold the bytes use authorizeUpload, which
// computes the hash itself; callers that do not must check the bytes against it later.
export async function authorizeDeclaredUpload(
  req: DeclaredUpload,
  orders: OrderRegistry,
  chainId: number,
  now: Date = new Date(),
): Promise<UploadAuth> {
  const order = await orders.get(req.orderId);
  if (!order) return { status: "rejected", reason: "unknown_order" };
  if (!(REQUIRED_DOC_TYPES as readonly string[]).includes(req.docType)) return { status: "rejected", reason: "unknown_doc_type" };
  const docType = req.docType as RequiredDocType;
  if (Math.abs(now.getTime() / 1000 - req.issuedAt) > UPLOAD_MAX_SKEW_SECONDS) {
    return { status: "rejected", reason: "stale_signature" };
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(req.fileHash)) return { status: "rejected", reason: "bad_signature" };
  const hash = req.fileHash.toLowerCase() as Hex;
  let signer: Hex;
  try {
    signer = await recoverTypedDataAddress({
      domain: uploadDomain(chainId),
      types: UPLOAD_TYPES,
      primaryType: "DocumentUpload",
      message: { orderId: order.orderId, docType, fileHash: hash, issuedAt: BigInt(req.issuedAt) },
      signature: req.signature as ViemHex,
    });
  } catch {
    return { status: "rejected", reason: "bad_signature" };
  }
  const uploader = order.uploaders.find((u) => u.address.toLowerCase() === signer.toLowerCase());
  if (!uploader) return { status: "rejected", reason: "not_a_party" };
  return { status: "authorized", order, docType, uploader: uploader.address, party: uploader.party, fileHash: hash };
}
