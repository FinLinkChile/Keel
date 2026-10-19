import { describe, expect, it } from "vitest";
import type { Hex } from "@keel/schemas";
import { describeIngestRepo } from "@keel/ingest/testing/repoContract";
import { FakeDynamo } from "../testing/fakeDynamo";
import { DynamoIngestRepo, ingestKey } from "./repo";

const fake = () => new FakeDynamo({ ingest: { pk: "pk", sk: "sk" } });

describeIngestRepo("DynamoIngestRepo (in-memory DocumentClient)", (now) => new DynamoIngestRepo("ingest", { client: fake(), now }));

describe("DynamoIngestRepo beyond the contract", () => {
  const NOW = new Date("2026-10-18T12:00:00Z");
  const ORDER = `0x${"ab".repeat(32)}` as Hex;
  const entry = {
    orderId: ORDER,
    payoutAddress: `0x${"11".repeat(20)}`,
    carrier: `0x${"22".repeat(20)}`,
    uploaders: [{ address: `0x${"33".repeat(20)}`, party: "exporter" }],
  };

  it("reads the order entry the orders API wrote, and treats a malformed one as unknown", async () => {
    const db = fake();
    const repo = new DynamoIngestRepo("ingest", { client: db, now: () => NOW });
    await db.send(new (await import("@aws-sdk/lib-dynamodb")).PutCommand({ TableName: "ingest", Item: { ...ingestKey.orderEntry(ORDER), ...entry, createdAt: 1 } }));
    expect(await repo.orderEntry(ORDER.toUpperCase().replace("0X", "0x") as Hex)).toEqual(entry);
    const other = `0x${"cd".repeat(32)}` as Hex;
    await db.send(
      new (await import("@aws-sdk/lib-dynamodb")).PutCommand({ TableName: "ingest", Item: { ...ingestKey.orderEntry(other), ...entry, orderId: other, uploaders: [] } }),
    );
    expect(await repo.orderEntry(other)).toBeUndefined();
    expect(await repo.orderEntry(`0x${"ef".repeat(32)}` as Hex)).toBeUndefined();
  });

  it("keeps transfers per day and reads them back between two moments", async () => {
    let now = NOW.getTime();
    const repo = new DynamoIngestRepo("ingest", { client: fake(), now: () => new Date(now) });
    await repo.recordTransfers([{ destino: "anthropic", n: 1 }]);
    now += 24 * 3600 * 1000;
    await repo.recordTransfers([{ destino: "anthropic", n: 2 }, { destino: "openai", n: 3 }]);
    expect(await repo.transfersSince(NOW, new Date(now + 1))).toEqual([{ destino: "anthropic", n: 1 }, { destino: "anthropic", n: 2 }, { destino: "openai", n: 3 }]);
    expect(await repo.transfersSince(new Date(NOW.getTime() + 1), new Date(now + 1))).toHaveLength(2);
    expect(await repo.transfersSince(NOW, new Date(now))).toHaveLength(1);
  });

  it("persists the digest cursor", async () => {
    const repo = new DynamoIngestRepo("ingest", { client: fake(), now: () => NOW });
    expect(await repo.digestCursor()).toEqual({});
    await repo.saveDigestCursor({ changes: NOW.toISOString(), transfers: NOW.toISOString() });
    expect(await repo.digestCursor()).toEqual({ changes: NOW.toISOString(), transfers: NOW.toISOString() });
  });

  it("gives daily counters a TTL and never one to what must be remembered", async () => {
    const db = fake();
    const repo = new DynamoIngestRepo("ingest", { client: db, now: () => NOW });
    await repo.recordEmail("h", "a.cl");
    const counter = db.get("ingest", ingestKey.sender("a.cl", "2026-10-18"))!;
    expect(counter.ttl).toBe(Date.parse("2026-10-21T00:00:00Z") / 1000);
    expect(db.get("ingest", ingestKey.email("h"))!.ttl).toBeUndefined();
  });
});
