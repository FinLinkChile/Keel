// Seams between the pieces of the AWS architecture that were built separately: what the orders
// API writes is what ingest and the agent read. Each piece has its own tests; these check that
// the item one writes is the item the other expects, on the same in-memory DynamoDB.
import { TradeOrderEntrySchema } from "@keel/ingest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DynamoSnapshotStore } from "./agent/store";
import { handler as proposals } from "./handlers/proposals";
import { handler as registrar } from "./handlers/registrar";
import { handler as signatures } from "./handlers/signatures";
import { appendOrderDocument } from "./ingest/orders";
import { DynamoIngestRepo } from "./ingest/repo";
import type { FakeDdb } from "./orders/fakeDdb";
import { call, exporter, makeOrder, owner, payout, resetChainDeps, SAFE, setup, signAs, signAsSafe } from "./orders/testkit";

vi.mock("./secrets", () => ({ secret: async () => "unused" }));

let ddb: FakeDdb;
beforeEach(async () => {
  ddb = await setup();
});
afterEach(resetChainDeps);

async function signedAndRegistered() {
  const { po, terms } = makeOrder();
  const params = { orderId: po.orderId };
  expect((await call(proposals, owner, "POST /proposals", { body: { po, terms } })).status).toBe(201);
  await call(proposals, exporter, "POST /proposals/{orderId}/exporter-signature", { params, body: { signature: await signAs(exporter, "PurchaseOrder", po) } });
  const signed = await call(proposals, owner, "POST /proposals/{orderId}/importer-signature", { params, body: { signature: await signAsSafe(owner, "PurchaseOrder", po) } });
  expect(signed.body.status).toBe("fully_signed");
  await registrar({ Records: [{ eventName: "MODIFY", dynamodb: { Keys: { orderId: { S: po.orderId } }, NewImage: { status: { S: "fully_signed" } } } }] } as never);
  return { po, terms, params };
}

describe("orders API -> agent", () => {
  it("the agent revives the order the registrar wrote, with both signatures, ready to open", async () => {
    const { po, terms } = await signedAndRegistered();
    const store = await DynamoSnapshotStore.load(SAFE);
    expect(store.orderIds().map((id) => id.toLowerCase())).toEqual([po.orderId.toLowerCase()]);
    const stored = store.order(po.orderId)!;
    expect(stored.order).toEqual(po);
    expect(stored.terms).toEqual(terms);
    expect(stored.sigImporter).toMatch(/^0x[0-9a-f]+$/i);
    expect(stored.sigExporter).toMatch(/^0x[0-9a-f]+$/i);
    // The importer's tax id and bot account come from the parties table
    expect(store.registry().parties.some((p) => p.address.toLowerCase() === SAFE.toLowerCase() && p.account === "importer-co")).toBe(true);
  });

  it("the agent sees a cancel signed through the API with its nonce", async () => {
    const { po, params } = await signedAndRegistered();
    const message = { orderId: po.orderId, nonce: 0n };
    await call(signatures, owner, "POST /orders/{orderId}/cancel-signature", { params, body: { nonce: "0", signature: await signAsSafe(owner, "CancelOrder", message) } });
    await call(signatures, exporter, "POST /orders/{orderId}/cancel-signature", { params, body: { nonce: "0", signature: await signAs(exporter, "CancelOrder", message) } });
    const closing = (await DynamoSnapshotStore.load(SAFE)).order(po.orderId)!.closing;
    expect(closing?.cancel?.cancelNonce).toBe(0n);
    expect(closing?.cancel?.sigImporter).toBeDefined();
    expect(closing?.cancel?.sigExporter).toBeDefined();
  });
});

describe("orders API -> ingest -> agent", () => {
  it("ingest reads the upload entry the registrar wrote", async () => {
    const { po } = await signedAndRegistered();
    const entry = await new DynamoIngestRepo(process.env.INGEST_TABLE!).orderEntry(po.orderId);
    expect(entry).toBeDefined();
    expect(TradeOrderEntrySchema.safeParse(entry).success).toBe(true);
    expect(entry!.payoutAddress.toLowerCase()).toBe(payout.address.toLowerCase());
    expect(entry!.uploaders.map((u) => u.address.toLowerCase())).toEqual(expect.arrayContaining([owner.address.toLowerCase(), exporter.address.toLowerCase()]));
  });

  it("an accepted document reaches the agent's store", async () => {
    const { po } = await signedAndRegistered();
    const fileHash = `0x${"12".repeat(32)}` as const;
    const extraction = { docType: "COMMERCIAL_INVOICE", invoiceNumber: "INV-1" };
    const orderId = po.orderId.toLowerCase() as `0x${string}`;
    expect(await appendOrderDocument(process.env.ORDERS_TABLE!, { orderId, docType: "COMMERCIAL_INVOICE", fileHash, extraction })).toBe("appended");
    expect(await appendOrderDocument(process.env.ORDERS_TABLE!, { orderId, docType: "COMMERCIAL_INVOICE", fileHash, extraction })).toBe("already_there");
    const docs = (await DynamoSnapshotStore.load(SAFE)).documents(po.orderId);
    expect(docs?.fileHashes).toEqual([fileHash]);
    expect(docs?.extractions).toEqual({ invoice: extraction });
  });
});
