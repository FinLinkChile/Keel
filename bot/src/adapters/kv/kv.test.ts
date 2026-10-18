// The cloud adapters over an in-memory store: each "invocation" builds a fresh NotifyService and
// directory, as a Lambda does, so only what is in the store carries over.
import { describe, expect, it, vi } from "vitest";
import { NotifyService } from "../../application/notify";
import { RetryableSendError, type ChatId } from "../../application/ports";
import type { Message } from "../../domain/message";
import { templateRenderer } from "../../presentation/templates";
import { CHATS, HASH, MemoryLogger, MemorySender, NOW_MS, nov, SAMPLES } from "../../testing/fixtures";
import { handleQueueMessage } from "../inbound/queue-source";
import { RecipientsAdmin } from "./kv-admin";
import { KvDirectory, KvOrders } from "./kv-directory";
import { CLAIM_LEASE_SECONDS, KvNotifyState } from "./kv-notify-state";
import { MemoryKeyValueStore } from "./memory-store";

const ORDER_ID = `0x${"12".repeat(32)}`;

export const DIRECTORY = {
  accounts: {
    "acme-imports": { kind: "company", name: "Acme Imports", roles: { owner: [111], operator: [222], cosigner: [333] } },
    lingnan: { kind: "company", name: "Lingnan Hydrocolloids", roles: { owner: [444], operator: [555] } },
    "hk-arbitration": { kind: "company", name: "HK Trade Arbitration", roles: { owner: [888] } },
    ana: { kind: "personal", name: "Ana", roles: { owner: [666], cosigner: [777] } },
  },
  orders: {
    [ORDER_ID]: { label: "PO-0142", importer: "acme-imports", exporter: "lingnan", arbiter: "hk-arbitration", shipmentDeadline: nov(20) },
  },
};

async function seeded() {
  let now = NOW_MS;
  const kv = new MemoryKeyValueStore(() => now);
  await new RecipientsAdmin(kv, () => now).apply(DIRECTORY, "ops@keel");
  return { kv, clock: () => now, advance: (ms: number) => (now += ms) };
}

function invocation(kv: MemoryKeyValueStore, clock: () => number, sender = new MemorySender(), max = 30) {
  const logger = new MemoryLogger();
  const service = new NotifyService(
    { directory: new KvDirectory(kv), renderer: templateRenderer, sender, clock: { now: clock }, logger, state: new KvNotifyState(kv, clock) },
    { maxMessagesPerChatPerHour: max },
  );
  return { service, sender, logger };
}

describe("NotifyService on the key-value store", () => {
  it("delivers a notice to its chats once, even across invocations", async () => {
    const { kv, clock } = await seeded();
    const first = invocation(kv, clock);
    expect(await first.service.notify(SAMPLES.balance_released)).toEqual({ status: "accepted", sent: 4 });
    expect(first.sender.sent.map((s) => s.chatId)).toEqual([CHATS.acme.owner, CHATS.acme.operator, CHATS.lingnan.owner, CHATS.lingnan.operator]);

    const second = invocation(kv, clock);
    expect(await second.service.notify(SAMPLES.balance_released)).toEqual({ status: "duplicate" });
    expect(second.sender.sent).toHaveLength(0);
  });

  it("keeps the hourly cap across invocations, and opens a new hour fresh", async () => {
    const { kv, clock, advance } = await seeded();
    const sender = new MemorySender();
    for (let i = 0; i < 2; i++) await invocation(kv, clock, sender, 2).service.notify({ ...SAMPLES.order_funded, id: `funded-${i}` });
    // A later invocation still sees two messages this hour: the third gets the fixed notice
    for (let i = 2; i < 5; i++) await invocation(kv, clock, sender, 2).service.notify({ ...SAMPLES.order_funded, id: `funded-${i}` });
    const toOwner = sender.to(CHATS.acme.owner);
    expect(toOwner).toHaveLength(3);
    expect(toOwner[2]?.text).toBe("More alerts arrived this hour. See them in Keel.");

    advance(3_600_000);
    await invocation(kv, clock, sender, 2).service.notify({ ...SAMPLES.order_funded, id: "funded-next" });
    expect(sender.to(CHATS.acme.owner)).toHaveLength(4);
  });

  it("asks for a retry on a retryable failure and then reaches only the chat left", async () => {
    const { kv, clock } = await seeded();
    const flaky = new MemorySender();
    let down = true;
    const sender = {
      sent: flaky.sent,
      to: (c: ChatId) => flaky.to(c),
      async send(chatId: ChatId, message: Message) {
        if (down && chatId === CHATS.acme.operator) throw new RetryableSendError("telegram");
        await flaky.send(chatId, message);
      },
    } as MemorySender;
    expect(await invocation(kv, clock, sender).service.notify(SAMPLES.balance_released)).toEqual({ status: "accepted", sent: 3, retry: 1 });
    down = false;
    expect(await invocation(kv, clock, sender).service.notify(SAMPLES.balance_released)).toEqual({ status: "accepted", sent: 1 });
    expect(flaky.sent.map((s) => s.chatId).sort()).toEqual([CHATS.acme.owner, CHATS.acme.operator, CHATS.lingnan.owner, CHATS.lingnan.operator].sort());
  });

  it("returns the cap slot after a retryable failure, so retries do not eat the cap", async () => {
    const { kv, clock } = await seeded();
    let down = true;
    const sender = {
      send: async (chatId: ChatId) => {
        if (down && chatId === CHATS.acme.owner) throw new RetryableSendError("telegram");
      },
    } as unknown as MemorySender;
    // Cap of 1: the owner's only slot of the hour must survive three failed attempts
    for (let i = 0; i < 3; i++) await invocation(kv, clock, sender, 1).service.notify(SAMPLES.balance_released);
    down = false;
    const log = invocation(kv, clock, sender, 1);
    expect(await log.service.notify(SAMPLES.balance_released)).toEqual({ status: "accepted", sent: 1 });
    expect(log.logger.entries).toContainEqual(expect.objectContaining({ event: "sent", chatId: CHATS.acme.owner }));
  });

  it("releases the claim when the store throws before the send, so the redelivery reaches the chat", async () => {
    const { kv, clock } = await seeded();
    const state = new KvNotifyState(kv, clock);
    const flaky = vi.spyOn(state, "admit").mockRejectedValueOnce(new Error("ProvisionedThroughputExceeded"));
    const sender = new MemorySender();
    const service = new NotifyService(
      { directory: new KvDirectory(kv), renderer: templateRenderer, sender, clock: { now: clock }, logger: new MemoryLogger(), state },
      { maxMessagesPerChatPerHour: 30 },
    );
    await expect(service.notify(SAMPLES.balance_released)).rejects.toThrow("ProvisionedThroughputExceeded");
    flaky.mockRestore();
    // The redelivery: every chat gets it exactly once
    expect(await service.notify(SAMPLES.balance_released)).toEqual({ status: "accepted", sent: 4 });
    expect(sender.sent).toHaveLength(4);
  });

  it("frees a claim left by a crashed invocation once the lease ends, but not a confirmed one", async () => {
    const { kv, clock, advance } = await seeded();
    const state = new KvNotifyState(kv, clock);
    expect(await state.claim("n-crash", 111)).toBe(true);
    expect(await state.claim("n-crash", 222)).toBe(true);
    await state.confirm("n-crash", 222);
    advance((CLAIM_LEASE_SECONDS - 1) * 1000);
    expect(await state.claim("n-crash", 111)).toBe(false);
    advance(2000);
    expect(await state.claim("n-crash", 111)).toBe(true);
    expect(await state.claim("n-crash", 222)).toBe(false);
  });

  it("keeps a chat claimed for good after a final send error", async () => {
    const { kv, clock, advance } = await seeded();
    const sender = { send: async (chatId: ChatId) => { if (chatId === CHATS.acme.owner) throw new TypeError("blocked"); } } as unknown as MemorySender;
    await invocation(kv, clock, sender).service.notify(SAMPLES.balance_released);
    advance((CLAIM_LEASE_SECONDS + 60) * 1000);
    expect(await new KvNotifyState(kv, clock).claim(SAMPLES.balance_released.id, CHATS.acme.owner)).toBe(false);
  });

  it("does not retry a final failure", async () => {
    const { kv, clock } = await seeded();
    const sender = { send: async (chatId: ChatId) => { if (chatId === CHATS.acme.owner) throw new TypeError("blocked"); } } as unknown as MemorySender;
    expect(await invocation(kv, clock, sender).service.notify(SAMPLES.balance_released)).toEqual({ status: "accepted", sent: 3 });
  });

  it("remembers a document hold on the order across invocations", async () => {
    const { kv, clock } = await seeded();
    const sender = new MemorySender();
    await invocation(kv, clock, sender).service.notify({ ...SAMPLES.operation_held, id: "h-1", reason: "hidden_text" });
    await invocation(kv, clock, sender).service.notify({ ...SAMPLES.operation_held, id: "h-2", reason: "documents_mismatch" });
    expect(sender.to(CHATS.lingnan.operator)[1]?.text).toMatch(/^Another document for PO-0142 is under review/);
  });

  it("rejects a notice for an account the operator has not registered", async () => {
    const { kv, clock } = await seeded();
    const n = { ...SAMPLES.order_funded, parties: { importer: "acme-imports", exporter: "someone-else" } };
    expect(await invocation(kv, clock).service.notify(n)).toEqual({ status: "rejected" });
  });
});

describe("RecipientsAdmin", () => {
  it("reads back what it wrote, in the shape of the local files", async () => {
    const { kv } = await seeded();
    expect(await new RecipientsAdmin(kv).view()).toEqual(DIRECTORY);
  });

  it("replaces an account whole, removes with null and audits each change once", async () => {
    const { kv, clock } = await seeded();
    const admin = new RecipientsAdmin(kv, clock);
    const audit = await admin.apply(
      { accounts: { lingnan: { kind: "company", name: "Lingnan Hydrocolloids", roles: { owner: [999] } }, ana: null } },
      "ops@keel",
    );
    expect(audit?.actor).toBe("ops@keel");
    expect(Object.keys(audit!.changes.accounts!)).toEqual(["lingnan", "ana"]);
    expect(await new KvDirectory(kv).chats("lingnan", "operator")).toEqual([]);
    expect(await new KvDirectory(kv).chats("lingnan", "owner")).toEqual([999]);
    expect(await new KvDirectory(kv).name("ana")).toBeUndefined();
    expect((await kv.query("audit#recipients", "")).length).toBe(2);
    // The same change again changes nothing and leaves no audit
    expect(await admin.apply({ accounts: { lingnan: { kind: "company", name: "Lingnan Hydrocolloids", roles: { owner: [999] } } } }, "ops@keel")).toBeNull();
  });

  it("rejects what the local files reject, before writing anything", async () => {
    const { kv } = await seeded();
    const admin = new RecipientsAdmin(kv);
    await expect(admin.apply({ accounts: { ana: { kind: "personal", name: "Ana", roles: { operator: [1] } } } }, "x")).rejects.toThrow(/has no operator/);
    await expect(
      admin.apply({ orders: { [`0x${"34".repeat(32)}`]: { label: "PO-0150", importer: "acme-imports", exporter: "nobody", shipmentDeadline: nov(20) } } }, "x"),
    ).rejects.toThrow(/not in the directory/);
    await expect(admin.apply({ accounts: { "Bad Id": null } }, "x")).rejects.toThrow(/does not validate/);
    expect(await admin.view()).toEqual(DIRECTORY);
  });
});

describe("RecipientsAdmin audit and references", () => {
  it("writes the audit before the entries, so a failed audit changes nothing", async () => {
    const { kv, clock } = await seeded();
    const failing = Object.create(kv) as MemoryKeyValueStore;
    failing.put = async (pk, sk, ...rest) => {
      if (pk === "audit#recipients") throw new Error("audit down");
      return kv.put(pk, sk, ...rest);
    };
    const change = { accounts: { lingnan: { kind: "company", name: "Lingnan", roles: { owner: [999] } } } };
    await expect(new RecipientsAdmin(failing, clock).apply(change, "ops")).rejects.toThrow("audit down");
    expect((await new RecipientsAdmin(kv).view()).accounts.lingnan?.name).toBe("Lingnan Hydrocolloids");
    // The retry applies it and audits it
    expect(await new RecipientsAdmin(kv, clock).apply(change, "ops")).not.toBeNull();
  });

  it("leaves the intent on record when an entry write fails halfway", async () => {
    const { kv, clock } = await seeded();
    const failing = Object.create(kv) as MemoryKeyValueStore;
    failing.put = async (pk, sk, ...rest) => {
      if (pk === "account#lingnan") throw new Error("store down");
      return kv.put(pk, sk, ...rest);
    };
    const change = { accounts: { lingnan: { kind: "company", name: "Lingnan", roles: { owner: [999] } } } };
    await expect(new RecipientsAdmin(failing, clock).apply(change, "ops")).rejects.toThrow("store down");
    const audits = await kv.query("audit#recipients", "");
    expect(audits.at(-1)).toMatchObject({ actor: "ops", changes: { accounts: { lingnan: { to: { name: "Lingnan" } } } } });
  });

  it("refuses to delete an account that a stored order still names", async () => {
    const { kv } = await seeded();
    const admin = new RecipientsAdmin(kv);
    await expect(admin.apply({ accounts: { lingnan: null } }, "x")).rejects.toThrow(/lingnan.*PO-0142/);
    await expect(admin.apply({ accounts: { "hk-arbitration": null } }, "x")).rejects.toThrow(/PO-0142/);
    expect(await admin.view()).toEqual(DIRECTORY);
    // Deleting the order in the same request is fine
    await admin.apply({ accounts: { lingnan: null }, orders: { [ORDER_ID]: null } }, "x");
    expect((await admin.view()).accounts.lingnan).toBeUndefined();
    // And an account no order names goes alone
    await admin.apply({ accounts: { ana: null } }, "x");
  });
});

describe("queue source", () => {
  const deps = async () => {
    const { kv, clock } = await seeded();
    const { service, sender } = invocation(kv, clock);
    const log: object[] = [];
    const orders = new KvOrders(kv);
    return { sender, log, d: { sink: service, orders: (id: string) => orders.book(id), now: clock, log: (e: object) => log.push(e) } };
  };

  it("drops a message that is not an envelope, logging no content", async () => {
    const { d, log } = await deps();
    expect(await handleQueueMessage("not json", d)).toBe("invalid");
    expect(await handleQueueMessage(JSON.stringify({ kind: "other", secret: "+56912345678" }), d)).toBe("invalid");
    expect(await handleQueueMessage(JSON.stringify({ kind: "notices", notices: [{ ...SAMPLES.order_funded, kind: "wire_now" }] }), d)).toBe("invalid");
    expect(JSON.stringify(log)).not.toContain("56912345678");
  });

  it("maps a trade upload with the order the operator registered", async () => {
    const { d, sender } = await deps();
    const outcome = { status: "held", reason: "bl_used_by_other_order", orderId: ORDER_ID, docType: "COMMERCIAL_INVOICE", fileHash: HASH, party: "exporter" };
    expect(await handleQueueMessage(JSON.stringify({ kind: "ingest_outcome", payload: { source: "trade_upload", outcome } }), d)).toBe("delivered");
    expect(sender.to(CHATS.acme.owner)[0]?.text).toContain("PO-0142");
  });

  it("drops a trade upload for an order nobody registered", async () => {
    const { d } = await deps();
    const outcome = { status: "held", reason: "bl_used_by_other_order", orderId: `0x${"99".repeat(32)}`, docType: "COMMERCIAL_INVOICE", fileHash: HASH, party: "exporter" };
    expect(await handleQueueMessage(JSON.stringify({ kind: "ingest_outcome", payload: { source: "trade_upload", outcome } }), d)).toBe("invalid");
  });
});
