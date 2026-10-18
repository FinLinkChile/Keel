import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Hex } from "@keel/schemas";
import { FileStore, writeStoreFile } from "@keel/engine";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { attestation, extractions, order, terms, word } from "../../../engine/src/testing/fixtures";
import { setDdb, toItem } from "../db";
import type { OrderItem, PartyItem } from "../tables";
import { FakeDynamo, TEST_ENV } from "../testing/fakes";
import { DynamoSnapshotStore } from "./store";

const low = (a: string) => a.toLowerCase();
const SAFE = low(order.importer);
const FILES = [word("bl.pdf"), word("invoice.pdf")];
const stored = {
  order,
  terms,
  label: "PO-0131",
  sigImporter: word("sig importer"),
  sigExporter: word("sig exporter"),
  closing: {
    balanceApproval: { sigImporter: word("approval"), attestationHash: word("attestation") },
    cancel: { cancelNonce: 513n, sigImporter: word("cancel importer") },
    resolution: { toImporter: 1n, toExporter: 2n, sigArbiter: word("arbiter") },
  },
};
const shipment = { attestation, sigCarrier: word("sig carrier") };
const documents = { extractions, fileHashes: FILES };
const parties = [
  { address: SAFE, taxId: "76123456K", account: "acme-imports" },
  { address: low(order.exporter), account: "lingnan" },
  { address: low(order.arbiter), account: "hk-arbitration" },
];
const history = { [low(order.exporter)]: [9_000_000_000n, 11_000_000_000n] };

function orderItem(over: Partial<OrderItem> = {}): OrderItem {
  return {
    orderId: order.orderId,
    safe: SAFE,
    exporter: low(order.exporter),
    ...(toItem(stored) as Pick<OrderItem, "order" | "terms" | "label" | "sigImporter" | "sigExporter" | "closing">),
    shipment: toItem(shipment) as OrderItem["shipment"],
    documents: toItem(documents) as OrderItem["documents"],
    uploaders: [],
    createdAt: 1,
    ...over,
  };
}

describe("DynamoSnapshotStore reads what FileStore reads", () => {
  let db: FakeDynamo;
  beforeEach(() => {
    db = new FakeDynamo();
    setDdb(db as never);
  });
  afterEach(() => setDdb(undefined));

  it("the same order, shipment, documents and registry, revived by the same engine code", async () => {
    const dir = mkdtempSync(join(tmpdir(), "keel-store-"));
    writeStoreFile(dir, ["registry.json"], { parties, history });
    writeStoreFile(dir, ["orders", order.orderId, "order.json"], stored);
    writeStoreFile(dir, ["orders", order.orderId, "shipment.json"], shipment);
    writeStoreFile(dir, ["orders", order.orderId, "documents.json"], documents);
    const files = new FileStore(dir);

    db.put("orders", orderItem());
    // A settled order of the Safe and an order of another Safe are not in the snapshot
    db.put("orders", orderItem({ orderId: word("settled"), chain: { state: "SETTLED", updatedBlock: "9" } }));
    db.put("orders", orderItem({ orderId: word("other"), safe: low(word("x").slice(0, 42)) }));
    const kinds: PartyItem["kind"][] = ["importer", "exporter", "arbiter"];
    parties.forEach((p, i) => db.put("parties", { ...p, kind: kinds[i]!, ...(p.address === low(order.exporter) && { history: history[p.address]!.map(String) }) }));
    db.put("parties", { address: low(order.carrier), kind: "carrier", account: "not named by notices" });

    const snapshot = await DynamoSnapshotStore.load(order.importer, TEST_ENV);
    expect(snapshot.orderIds()).toEqual(files.orderIds());
    const id = order.orderId as Hex;
    expect(snapshot.order(id)).toEqual(files.order(id));
    expect(snapshot.order(id)?.closing?.cancel).toEqual({ cancelNonce: 513n, sigImporter: word("cancel importer") });
    expect(snapshot.shipment(id)).toEqual(files.shipment(id));
    expect(snapshot.documents(id)).toEqual(files.documents(id));
    const byAddress = (r: ReturnType<FileStore["registry"]>) => ({ ...r, parties: [...r.parties].sort((a, b) => a.address.localeCompare(b.address)) });
    expect(byAddress(snapshot.registry())).toEqual(byAddress(files.registry()));
    // Case of the id does not matter, as in the escrow
    expect(snapshot.order(id.toUpperCase().replace("0X", "0x") as Hex)).toEqual(files.order(id));
  });

  it("an order without shipment or documents yet reads as null, like a missing file", async () => {
    db.put("orders", orderItem({ shipment: undefined, documents: undefined, closing: undefined }));
    const snapshot = await DynamoSnapshotStore.load(SAFE, TEST_ENV);
    expect(snapshot.shipment(order.orderId)).toBeNull();
    expect(snapshot.documents(order.orderId)).toBeNull();
    expect(snapshot.order(order.orderId)?.closing).toBeUndefined();
    expect(snapshot.registry()).toEqual({ parties: [], history: {} });
  });
});
