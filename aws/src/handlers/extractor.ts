// Reads the Keel Trade documents that land in DOCS_BUCKET. S3 ObjectCreated notifications for
// orders/<orderId>/<fileHash> go to the extraction queue; each message runs here:
//
//   1. the upload must have been admitted (./upload.ts) and not read yet;
//   2. keccak256 of the bytes must be the fileHash of the key, the hash the uploader signed:
//      otherwise the object is deleted and nothing is read (the uploader may PUT again);
//   3. the upload is claimed, so a redelivered or duplicated message reads it once;
//   4. the trade pipeline reads it (parser, quarantined extractor, two-source agreement,
//      account alert, acceptance), persisting through the DynamoDB repo;
//   5. an accepted document is appended to OrderItem.documents, where the agent reads it;
//   6. the outcome goes to the bot as { kind: "ingest_outcome", payload: { source: "trade_upload", outcome } }
//      and the reading is marked finished.
// Nothing here pays or changes an order's state. A message that fails is retried by SQS
// (partial batch response) and ends in the queue's DLQ.
import type { S3Event, SQSBatchResponse, SQSEvent } from "aws-lambda";
import { fileHash as keccakFile, MAX_PDF_BYTES, readTradeDocument, type Received, type TradeOutcome } from "@keel/ingest";
import { parseDocumentKey } from "../ingest/objects";
import { defaultRuntime, withTransfers, type IngestRuntime } from "../ingest/runtime";

// A reading that has not finished after this long is taken over by the next delivery. Above
// the Lambda timeout, so a live reading is never read twice.
export const READ_CLAIM_STALE_MS = 15 * 60 * 1000;

const log = (entry: object) => console.log(JSON.stringify({ at: new Date().toISOString(), ...entry }));

export type ObjectResult =
  | "read"
  | "already_read"
  | "being_read"
  | "not_a_document"
  | "not_admitted"
  | "missing"
  | "hash_mismatch"
  | "unknown_order";

export async function readObject(rt: IngestRuntime, key: string): Promise<ObjectResult> {
  const id = parseDocumentKey(key);
  if (!id) return "not_a_document";
  const upload = await rt.repo.upload(id.orderId, id.fileHash);
  if (!upload) {
    // Nothing authorized this object: it is never read
    await rt.objects.delete(key);
    log({ event: "trade_document_not_admitted", key });
    return "not_admitted";
  }
  if (upload.readStatus !== undefined) return "already_read";

  const object = await rt.objects.get(key, MAX_PDF_BYTES);
  if (!object) return "missing";
  const received: Received = {
    orderId: upload.orderId,
    docType: upload.docType,
    fileHash: upload.fileHash,
    uploader: upload.uploader,
    party: upload.party,
  };
  let outcome: TradeOutcome | undefined;
  if (!object.bytes) {
    // Bigger than any document: refused without reading it (the presigned URL fixes the length,
    // so this is an object written some other way)
    outcome = { status: "quarantined", reason: "too_large", ...received };
  } else if (keccakFile(object.bytes) !== id.fileHash) {
    await rt.objects.delete(key);
    log({ event: "trade_document_hash_mismatch", orderId: id.orderId, fileHash: id.fileHash });
    return "hash_mismatch";
  }

  if (!(await rt.repo.claimReading(id.orderId, id.fileHash, READ_CLAIM_STALE_MS))) {
    const again = await rt.repo.upload(id.orderId, id.fileHash);
    if (again?.readStatus !== undefined) return "already_read";
    return "being_read";
  }

  if (!outcome) {
    const order = await rt.orders.get(id.orderId);
    if (!order) {
      await rt.repo.finishReading(id.orderId, id.fileHash, "unknown_order");
      log({ event: "trade_document_unknown_order", orderId: id.orderId, fileHash: id.fileHash });
      return "unknown_order";
    }
    const extractor = await rt.extractor();
    outcome = await withTransfers(rt.repo, () => readTradeDocument(object.bytes!, received, order, extractor, { store: rt.repo, now: () => rt.now() }));
  }

  if (outcome.status === "ready" && "extraction" in outcome) {
    const update = await rt.appendOrderDocument({
      orderId: received.orderId,
      docType: received.docType,
      fileHash: received.fileHash,
      extraction: outcome.extraction,
    });
    if (update !== "appended" && update !== "already_there") {
      log({ event: "trade_document_not_in_order", orderId: received.orderId, fileHash: received.fileHash, reason: update });
    }
  }
  await rt.notify({ kind: "ingest_outcome", payload: { source: "trade_upload", outcome } });
  await rt.repo.finishReading(id.orderId, id.fileHash, outcome.status);
  log({
    event: "trade_document_read",
    orderId: received.orderId,
    fileHash: received.fileHash,
    docType: received.docType,
    status: outcome.status,
    ...("reason" in outcome ? { reason: String(outcome.reason) } : {}),
  });
  return "read";
}

// The S3 keys in one SQS message (an S3 notification; S3's test event carries none)
export function documentKeysOf(body: string): string[] {
  const event = JSON.parse(body) as Partial<S3Event> & { Event?: string };
  return (event.Records ?? [])
    .filter((r) => r.eventName?.startsWith("ObjectCreated:"))
    .map((r) => decodeURIComponent(r.s3.object.key.replace(/\+/g, " ")));
}

export function createExtractorHandler(runtime: () => IngestRuntime = () => defaultRuntime()) {
  return async (event: SQSEvent): Promise<SQSBatchResponse> => {
    const rt = runtime();
    const batchItemFailures: SQSBatchResponse["batchItemFailures"] = [];
    for (const record of event.Records) {
      try {
        for (const key of documentKeysOf(record.body)) {
          const result = await readObject(rt, key);
          // Someone else holds a fresh claim: retry later rather than drop the message
          if (result === "being_read") throw new Error("reading in progress elsewhere");
        }
      } catch (e) {
        console.error(JSON.stringify({ event: "trade_document_read_failed", messageId: record.messageId, error: (e as Error).message }));
        batchItemFailures.push({ itemIdentifier: record.messageId });
      }
    }
    return { batchItemFailures };
  };
}

export const handler = createExtractorHandler();
