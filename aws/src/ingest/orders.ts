// What ingest reads from and writes to the rest of the platform: who may upload (the order
// entry and the parties registry) and, once a document is accepted, the documents the agent
// reads (OrderItem.documents in the orders table).
import { GetCommand, UpdateCommand, type DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { ImporterRegistry, OrderRegistry } from "@keel/ingest";
import type { Hex, RequiredDocType } from "@keel/schemas";
import { ddb, isConditionFailed, lower } from "../db";
import type { PartyItem } from "../tables";
import type { DynamoIngestRepo } from "./repo";

type Client = Pick<DynamoDBDocumentClient, "send">;

export const repoOrders = (repo: DynamoIngestRepo): OrderRegistry => ({ get: (orderId) => repo.orderEntry(orderId) });

// A proforma comes before its order, so its uploader is checked against the parties registry:
// an importer, or the representative of an importer Safe
export function partiesImporters(table: string, client?: Client): ImporterRegistry {
  const db = () => client ?? ddb();
  const party = async (address: string) =>
    ((await db().send(new GetCommand({ TableName: table, Key: { address: lower(address) } }))) as { Item?: PartyItem }).Item;
  return {
    async has(address: Hex) {
      const p = await party(address);
      if (!p) return false;
      if (p.kind === "importer") return true;
      if (p.kind !== "representative" || !p.safe) return false;
      return (await party(p.safe))?.kind === "importer";
    },
  };
}

// The engine reads { transport, invoice } (engine DocumentExtractions)
export const extractionSlot = (docType: RequiredDocType): "transport" | "invoice" =>
  docType === "COMMERCIAL_INVOICE" ? "invoice" : "transport";

export type DocumentsUpdate = "appended" | "already_there" | "slot_taken" | "no_order";

// Appends one accepted document to OrderItem.documents. Idempotent: the same file twice is
// "already_there". A second accepted document of the same type does not replace the first
// ("slot_taken"): the package is ambiguous and a person decides (IngestRepo.tradePackage).
export async function appendOrderDocument(
  table: string,
  doc: { orderId: Hex; docType: RequiredDocType; fileHash: Hex; extraction: object },
  client?: Client,
): Promise<DocumentsUpdate> {
  const db = () => client ?? ddb();
  const key = { orderId: doc.orderId };
  try {
    await db().send(
      new UpdateCommand({
        TableName: table,
        Key: key,
        UpdateExpression: "SET documents = if_not_exists(documents, :empty)",
        ConditionExpression: "attribute_exists(orderId)",
        ExpressionAttributeValues: { ":empty": { extractions: {}, fileHashes: [] } },
      }),
    );
  } catch (e) {
    if (isConditionFailed(e)) return "no_order";
    throw e;
  }
  const hash = lower(doc.fileHash);
  try {
    await db().send(
      new UpdateCommand({
        TableName: table,
        Key: key,
        UpdateExpression: "SET documents.extractions.#slot = :extraction, documents.fileHashes = list_append(documents.fileHashes, :hashes)",
        ConditionExpression: "attribute_not_exists(documents.extractions.#slot) AND NOT contains(documents.fileHashes, :hash)",
        ExpressionAttributeNames: { "#slot": extractionSlot(doc.docType) },
        ExpressionAttributeValues: { ":extraction": doc.extraction, ":hashes": [hash], ":hash": hash },
      }),
    );
    return "appended";
  } catch (e) {
    if (!isConditionFailed(e)) throw e;
  }
  const r = (await db().send(new GetCommand({ TableName: table, Key: key, ConsistentRead: true }))) as {
    Item?: { documents?: { fileHashes?: string[] } };
  };
  return r.Item?.documents?.fileHashes?.includes(hash) ? "already_there" : "slot_taken";
}
