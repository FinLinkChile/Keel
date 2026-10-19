// Reads the Keel Trade documents that land in DOCS_BUCKET. S3 ObjectCreated notifications for
// orders/<orderId>/<fileHash> go to the extraction queue; each message runs here:
//
//   1. the upload must have been admitted (./upload.ts) and not read yet;
//   2. keccak256 of the bytes must be the fileHash of the key, the hash the uploader signed:
//      otherwise the object is deleted and nothing is read (the uploader may PUT again);
//   3. the upload is claimed, so a redelivered or duplicated message reads it once;
//   4. the trade pipeline reads it (parser, quarantined extractor, two-source agreement,
//      account alert, acceptance), persisting through the DynamoDB repo;
//      A file already accepted by an earlier delivery (whose append to the order then failed)
//      is not read again: its accepted record is used;
//   5. an accepted document is appended to OrderItem.documents, where the agent reads it;
//   6. the outcome goes to the bot as { kind: "ingest_outcome", payload: { source: "trade_upload", outcome } }
//      and the reading is marked finished. A notice that could not be queued fails the message
//      before the reading is marked finished, so the retry sends it.
// A model failure that does not depend on the file (provider_error: an outage, a timeout, a
// 429) releases the claim and fails the message, so SQS retries it; only the last delivery ends
// it as held, with the notice, and the uploader may upload the same file again.
// Nothing here pays or changes an order's state. A message that fails is retried by SQS
// (partial batch response) and ends in the queue's DLQ.
// DEMO SHORTCUT, off by default: with KEEL_DEMO_AUTO_ATTEST=1, once the order has its bill of
// lading and invoice, the carrier's attestation is signed and stored here (../orders/autoAttest.ts).
// Its failure is logged and never fails the reading.
import type { S3Event, SQSBatchResponse, SQSEvent } from "aws-lambda";
import { fileHash as keccakFile, MAX_PDF_BYTES, readTradeDocument, READ_EXTRACTOR_FAILED, type Received, type TradeOutcome } from "@keel/ingest";
import { parseDocumentKey } from "../ingest/objects";
import { autoAttest, type AutoAttestResult } from "../orders/autoAttest";
import { defaultRuntime, withTransfers, type IngestRuntime } from "../ingest/runtime";

// A reading that has not finished after this long is taken over by the next delivery. Above
// the extractor's timeout (300 s), so a live reading is never read twice, and below the queue's
// visibility timeout (720 s): after a crash the second delivery already reads, not only the
// third (maxReceive 3).
export const READ_CLAIM_STALE_MS = 6 * 60 * 1000;

// The extraction queue's maxReceiveCount (infra): on this delivery a transient model failure
// stops being retried and ends the reading
export const EXTRACTOR_MAX_RECEIVE = 3;

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

export async function readObject(rt: IngestRuntime, key: string, options: { lastAttempt?: boolean } = {}): Promise<ObjectResult> {
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

  let finalStatus: string | undefined;
  if (!outcome) {
    // Accepted by an earlier delivery whose append to the order failed: finish from the record.
    // Reading again would meet its own bill of lading and hold it as a duplicate forever.
    const accepted = await rt.repo.acceptedDocument(id.orderId, id.fileHash);
    if (accepted) {
      // The alert (if any) was recorded by the first delivery; destinations are not kept
      outcome = {
        status: "ready",
        extraction: accepted.extraction,
        destinations: [],
        hiddenReasons: [],
        ...(accepted.blHash ? { blNumberHash: accepted.blHash } : {}),
        ...received,
      } as unknown as TradeOutcome;
      log({ event: "trade_document_already_accepted", orderId: received.orderId, fileHash: received.fileHash });
    } else {
      const order = await rt.orders.get(id.orderId);
      if (!order) {
        await rt.repo.finishReading(id.orderId, id.fileHash, "unknown_order");
        log({ event: "trade_document_unknown_order", orderId: id.orderId, fileHash: id.fileHash });
        return "unknown_order";
      }
      const extractor = await rt.extractor();
      outcome = await withTransfers(rt.repo, () => readTradeDocument(object.bytes!, received, order, extractor, { store: rt.repo, now: () => rt.now() }));
    }
  }
  if (outcome.status === "held" && outcome.reason === "extractor_failed") {
    if (outcome.failure === "provider_error") {
      if (!options.lastAttempt) {
        // Not the file's fault: give the upload back and let SQS deliver it again
        await rt.repo.releaseReading(id.orderId, id.fileHash);
        log({ event: "trade_document_extractor_unavailable", orderId: received.orderId, fileHash: received.fileHash });
        throw new Error("extractor unavailable (provider_error): retrying");
      }
      // Retries ran out: held, with the notice, and the same file may be uploaded again
      finalStatus = READ_EXTRACTOR_FAILED;
    }
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
  // A held or rejected outcome the bot never hears of is a document nobody looks at: when the
  // notice cannot be queued the message fails, and the retry sends it
  if (!(await rt.notify({ kind: "ingest_outcome", payload: { source: "trade_upload", outcome } }))) {
    throw new Error("notice not queued: retrying");
  }
  await rt.repo.finishReading(id.orderId, id.fileHash, finalStatus ?? outcome.status);
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

// After a document of an order is read (now or by an earlier delivery): the demo attestation
async function afterRead(key: string, attestOrder: (orderId: string) => Promise<AutoAttestResult>) {
  const id = parseDocumentKey(key);
  if (!id) return;
  try {
    const result = await attestOrder(id.orderId);
    if (result !== "off") log({ event: "demo_auto_attest", orderId: id.orderId, result });
  } catch (e) {
    log({ event: "demo_auto_attest", orderId: id.orderId, result: "failed", error: (e as Error).message });
  }
}

export function createExtractorHandler(
  runtime: () => IngestRuntime = () => defaultRuntime(),
  attestOrder: (orderId: string) => Promise<AutoAttestResult> = (orderId) => autoAttest(orderId),
) {
  return async (event: SQSEvent): Promise<SQSBatchResponse> => {
    const rt = runtime();
    const batchItemFailures: SQSBatchResponse["batchItemFailures"] = [];
    for (const record of event.Records) {
      try {
        for (const key of documentKeysOf(record.body)) {
          const lastAttempt = Number(record.attributes?.ApproximateReceiveCount) >= EXTRACTOR_MAX_RECEIVE;
          const result = await readObject(rt, key, { lastAttempt });
          // Someone else holds a fresh claim: retry later rather than drop the message
          if (result === "being_read") throw new Error("reading in progress elsewhere");
          if (result === "read" || result === "already_read") await afterRead(key, attestOrder);
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
