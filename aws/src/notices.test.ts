import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setDdb } from "./db";
import { enqueueOnce, setSqs } from "./notices";
import { stateId } from "./tables";
import { FakeDynamo, FakeSqs, TEST_ENV } from "./testing/fakes";

describe("enqueueOnce", () => {
  let db: FakeDynamo;
  let sqs: FakeSqs;
  let failing: boolean;

  beforeEach(() => {
    db = new FakeDynamo();
    sqs = new FakeSqs();
    failing = false;
    setDdb(db as never);
    setSqs({ send: async (c: unknown) => (failing ? Promise.reject(new Error("SQS down")) : sqs.send(c)) } as never);
  });
  afterEach(() => {
    setDdb(undefined);
    setSqs(undefined);
  });

  it("sends each id once", async () => {
    expect(await enqueueOnce([{ id: "a" }, { id: "b" }], TEST_ENV)).toBe(2);
    expect(await enqueueOnce([{ id: "a" }, { id: "c" }], TEST_ENV)).toBe(1);
    expect(sqs.sent.map((m) => JSON.parse(m.MessageBody).notices.map((n: { id: string }) => n.id))).toEqual([["a", "b"], ["c"]]);
  });

  it("a failed send throws and leaves no marker, so the same notice goes out on the next try", async () => {
    failing = true;
    await expect(enqueueOnce([{ id: "a" }, { id: "b" }], TEST_ENV)).rejects.toThrow("SQS down");
    expect(db.get("agent_state", stateId.notice("a"))).toBeUndefined();
    expect(db.get("agent_state", stateId.notice("b"))).toBeUndefined();
    failing = false;
    expect(await enqueueOnce([{ id: "a" }, { id: "b" }], TEST_ENV)).toBe(2);
    expect(sqs.sent).toHaveLength(1);
    expect(db.get("agent_state", stateId.notice("a"))).toBeDefined();
  });
});
