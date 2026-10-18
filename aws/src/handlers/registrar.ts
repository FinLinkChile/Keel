// DynamoDB Stream of the proposals table, filtered by Terraform to status fully_signed. Creates the
// order for the agent and registers its uploaders for ingest (../orders/registrar.ts). Idempotent:
// a record delivered twice finds the order already there.
//
// A failure throws, so Lambda retries the batch; every step is safe to repeat. The order is not
// opened here: the agent opens and funds it.
//
// Reads: PROPOSALS_TABLE, ORDERS_TABLE, PARTIES_TABLE, INGEST_TABLE, KEEL_CHAIN_ID or
// KEEL_CONFIG_PREFIX (deployment: the escrow, for the order checks). No secret.
import type { DynamoDBStreamEvent } from "aws-lambda";
import { deployment } from "../config";
import { orderIdsOf, registerOrder, type StreamRecord } from "../orders/registrar";

export async function handler(event: DynamoDBStreamEvent): Promise<void> {
  const ids = orderIdsOf(event.Records as StreamRecord[]);
  if (!ids.length) return;
  const { escrow } = await deployment();
  for (const orderId of ids) await registerOrder(orderId, { escrow });
}
