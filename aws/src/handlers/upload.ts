// Keel Trade document upload, in two steps (docs/interfaces/carga-de-documentos.md):
//
//   POST /trade/uploads     { orderId, docType, fileHash, size, issuedAt, signature }
//     The DocumentUpload signature (EIP-712, domain "Keel Ingest") of a registered
//     representative over the order, the declared type and the keccak256 of the file is checked
//     against the order entry; the upload is admitted (one per file, at most
//     MAX_DOCUMENTS_PER_ORDER_PER_DAY per order, party and day) and the reply is a presigned PUT to
//     orders/<orderId>/<fileHash> that only accepts exactly `size` bytes, for a few minutes.
//     The document is read asynchronously when it lands (./extractor.ts); the outcome arrives
//     as a notice.
//   POST /trade/documents   { orderId, docType, issuedAt, signature, file }   (compatibility)
//     The same authorization with the file in the body (base64): stored at the same key and
//     read the same way. API Gateway's 10 MB payload limit applies to the base64 body.
//
// Asking again for a file that was admitted but not read (the PUT or the store failed, or the
// reading ended as extractor_failed), by the same uploader with the same type, is allowed and
// not counted: a new URL, or the object stored again.
//
// No ApiRequest signature here ({ auth: false }): the DocumentUpload signature is the
// authentication, and it binds the uploader to the exact file.
import { z } from "zod";
import {
  admitTradeUpload,
  authorizeDeclaredUpload,
  authorizeUpload,
  MAX_PDF_BYTES,
  READ_EXTRACTOR_FAILED,
  receivedOf,
  TRADE_REJECTION_STATUS,
  TradeUploadBody,
  type Received,
  type TradeOutcome,
} from "@keel/ingest";
import type { Hex } from "@keel/schemas";
import { api, parseJson, type Reply, type Request } from "../http";
import { documentKey } from "../ingest/objects";
import { defaultRuntime, type IngestRuntime } from "../ingest/runtime";

// Long enough to upload 10 MB on a slow link, short enough that a leaked URL is soon useless
export const UPLOAD_URL_TTL_SECONDS = 300;

const hex = (bytes: number) =>
  z
    .string()
    .regex(new RegExp(`^0x[0-9a-fA-F]{${bytes * 2}}$`))
    .transform((v) => v.toLowerCase() as Hex);

export const PresignBody = z
  .object({
    orderId: hex(32),
    docType: z.string().max(32),
    fileHash: hex(32),
    // Bytes of the file: the presigned URL accepts exactly this length. The cap is checked after
    // parsing, so a file over it is a 413 too_large and not a malformed body.
    size: z.number().int().positive(),
    issuedAt: z.number().int().positive(),
    signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/),
  })
  .strict();

const log = (entry: object) => console.log(JSON.stringify({ at: new Date().toISOString(), ...entry }));

function refused(outcome: Extract<TradeOutcome, { status: "rejected" | "duplicate" | "quarantined" }>, status: number): Reply {
  log({ event: "trade_upload_refused", status: outcome.status, reason: outcome.reason, ...("orderId" in outcome ? { orderId: outcome.orderId } : {}) });
  return { status, body: outcome };
}

// The same uploader asking again for a file that is admitted but still waiting to be read: a
// PUT or a store that failed, or a reading that ended as extractor_failed. Reopens the latter so
// the new object is read; call it before the object is written, or the notification is dropped.
async function retryable(rt: IngestRuntime, received: Received): Promise<boolean> {
  const existing = await rt.repo.upload(received.orderId, received.fileHash);
  if (
    !existing ||
    existing.uploader.toLowerCase() !== received.uploader.toLowerCase() ||
    existing.docType !== received.docType
  ) {
    return false;
  }
  if (existing.readStatus === undefined) return existing.readClaimedAt === undefined;
  if (existing.readStatus !== READ_EXTRACTOR_FAILED) return false;
  return rt.repo.releaseReading(received.orderId, received.fileHash);
}

export function createUploadHandler(runtime: () => IngestRuntime = () => defaultRuntime()) {
  const presign = async (req: Request): Promise<Reply> => {
    const rt = runtime();
    const body = parseJson(req, (v) => PresignBody.parse(v));
    if (body.size > MAX_PDF_BYTES) return refused({ status: "rejected", reason: "too_large" }, 413);
    const auth = await authorizeDeclaredUpload({ ...body, signature: body.signature as Hex }, rt.orders, req.chainId, rt.now());
    if (auth.status === "rejected") return refused(auth, TRADE_REJECTION_STATUS[auth.reason]);
    const received = receivedOf(auth);
    const key = documentKey(received.orderId, received.fileHash);
    const refusal = await admitTradeUpload(received, rt.repo);
    if (refusal?.status === "quarantined") return refused(refusal, 429);
    // A new URL for the same key, without spending another upload of the day
    if (refusal && !(await retryable(rt, received))) return refused(refusal, 409);
    const uploadUrl = await rt.objects.presignPut(key, body.size, UPLOAD_URL_TTL_SECONDS);
    log({ event: "trade_upload_presigned", orderId: received.orderId, fileHash: received.fileHash, docType: received.docType, retry: !!refusal });
    return { body: { uploadUrl, key, expiresIn: UPLOAD_URL_TTL_SECONDS } };
  };

  const documents = async (req: Request): Promise<Reply> => {
    const rt = runtime();
    const body = parseJson(req, (v) => TradeUploadBody.parse(v));
    const file = new Uint8Array(Buffer.from(body.file, "base64"));
    if (file.byteLength > MAX_PDF_BYTES) return refused({ status: "rejected", reason: "too_large" }, 413);
    const auth = await authorizeUpload({ ...body, signature: body.signature as Hex, file }, rt.orders, req.chainId, rt.now());
    if (auth.status === "rejected") return refused(auth, TRADE_REJECTION_STATUS[auth.reason]);
    const received = receivedOf(auth);
    const refusal = await admitTradeUpload(received, rt.repo);
    // As on the local server: a duplicate or an upload over the limit is an answer, not an error
    if (refusal && (refusal.status === "quarantined" || !(await retryable(rt, received)))) return refused(refusal, 200);
    await rt.objects.put(documentKey(received.orderId, received.fileHash), file, "application/pdf");
    log({ event: "trade_document_stored", orderId: received.orderId, fileHash: received.fileHash, docType: received.docType, retry: !!refusal });
    return { status: 202, body: { status: "accepted_for_reading", orderId: received.orderId, fileHash: received.fileHash } };
  };

  return api(
    { "POST /trade/uploads": presign, "POST /trade/documents": documents },
    { "POST /trade/uploads": { auth: false }, "POST /trade/documents": { auth: false } },
  );
}

export const handler = createUploadHandler();
