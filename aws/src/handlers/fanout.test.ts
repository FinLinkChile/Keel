import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setDdb } from "../db";
import { setAgentSqs } from "../agent/clients";
import { FakeDynamo, FakeSqs, TEST_ENV } from "../testing/fakes";
import { fanOut } from "./fanout";

const A = `0x${"a".repeat(40)}`;
const B = `0x${"b".repeat(40)}`;
const C = `0x${"c".repeat(40)}`;

describe("agent fan-out", () => {
  let db: FakeDynamo;
  let sqs: FakeSqs;
  beforeEach(() => {
    db = new FakeDynamo();
    sqs = new FakeSqs();
    setDdb(db as never);
    setAgentSqs(sqs);
  });
  afterEach(() => {
    setDdb(undefined);
    setAgentSqs(undefined);
  });

  it("one FIFO message per Safe with a live order, deduplicated per minute", async () => {
    db.put("orders", { orderId: "0x1", safe: A }); // not on chain yet: NONE is live
    db.put("orders", { orderId: "0x2", safe: A, chain: { state: "SHIPPED", updatedBlock: "5" } });
    db.put("orders", { orderId: "0x3", safe: B.toUpperCase().replace("0X", "0x"), chain: { state: "DISPUTED", updatedBlock: "5" } });
    db.put("orders", { orderId: "0x4", safe: C, chain: { state: "SETTLED", updatedBlock: "5" } });
    const safes = await fanOut(TEST_ENV, () => 120_000);
    expect(safes).toEqual([A, B]);
    expect(sqs.sent).toEqual([
      { QueueUrl: TEST_ENV.AGENT_QUEUE_URL, MessageBody: JSON.stringify({ safe: A }), MessageGroupId: A, MessageDeduplicationId: `${A}-2` },
      { QueueUrl: TEST_ENV.AGENT_QUEUE_URL, MessageBody: JSON.stringify({ safe: B }), MessageGroupId: B, MessageDeduplicationId: `${B}-2` },
    ]);
  });
});
