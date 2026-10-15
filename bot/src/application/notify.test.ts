import { describe, expect, it } from "vitest";
import type { Notice } from "../domain/notice";
import type { Role } from "../domain/recipients";
import { templateRenderer } from "../presentation/templates";
import { CHATS, directory, MemoryLogger, MemorySender, NOW_MS, SAMPLES } from "../testing/fixtures";
import { NotifyService } from "./notify";

function setup(max = 30) {
  const sender = new MemorySender();
  const logger = new MemoryLogger();
  let now = NOW_MS;
  const clock = { now: () => now };
  const service = new NotifyService(
    { directory, renderer: templateRenderer, sender, clock, logger },
    { maxMessagesPerChatPerHour: max },
  );
  return { service, sender, logger, advance: (ms: number) => (now += ms) };
}

describe("NotifyService", () => {
  it("sends one message per routed chat", async () => {
    const { service, sender } = setup();
    expect(await service.notify(SAMPLES.balance_released)).toEqual({ status: "accepted", sent: 4 });
    expect(sender.sent.map((s) => s.chatId)).toEqual([CHATS.acme.owner, CHATS.acme.operator, CHATS.lingnan.owner, CHATS.lingnan.operator]);
  });

  it("sends the same notice id only once", async () => {
    const { service, sender } = setup();
    await service.notify(SAMPLES.order_funded);
    expect(await service.notify(SAMPLES.order_funded)).toEqual({ status: "duplicate" });
    expect(sender.sent).toHaveLength(4);
    expect(service.stats().duplicates).toBe(1);
  });

  it("rejects and counts a notice that does not validate", async () => {
    const { service, sender, logger } = setup();
    expect(await service.notify({ ...SAMPLES.order_funded, kind: "wire_now" })).toEqual({ status: "rejected" });
    expect(sender.sent).toHaveLength(0);
    expect(service.stats().rejected).toBe(1);
    expect(logger.entries[0]).toMatchObject({ event: "rejected", noticeId: "n-2" });
  });

  it("rejects a notice that names an account outside the directory", async () => {
    const { service, sender } = setup();
    const n = { ...SAMPLES.order_funded, parties: { importer: "acme-imports", exporter: "someone-else" } };
    expect(await service.notify(n)).toEqual({ status: "rejected" });
    expect(sender.sent).toHaveLength(0);
  });

  it("logs a recipient without chats and goes on", async () => {
    const sender = new MemorySender();
    const logger = new MemoryLogger();
    const noOperator = { ...directory, chats: (a: string, role: Role) => (role === "operator" ? [] : directory.chats(a, role)) };
    const service = new NotifyService(
      { directory: noOperator, renderer: templateRenderer, sender, clock: { now: () => NOW_MS }, logger },
      { maxMessagesPerChatPerHour: 30 },
    );
    expect(await service.notify(SAMPLES.balance_released)).toEqual({ status: "accepted", sent: 2 });
    expect(logger.entries.filter((e) => e.event === "no_chats")).toHaveLength(2);
    expect(service.stats().noChats).toBe(2);
  });

  it("caps messages per chat per hour with a single fixed notice", async () => {
    const { service, sender, advance } = setup(2);
    for (let i = 0; i < 5; i++) await service.notify({ ...SAMPLES.order_funded, id: `funded-${i}` });
    const toOwner = sender.to(CHATS.acme.owner);
    expect(toOwner).toHaveLength(3);
    expect(toOwner[2]?.text).toBe("More alerts arrived this hour. See them in Keel.");
    expect(service.stats().rateLimited).toBe(3 * 4);

    // Chain and engine notices always go out.
    await service.notify({ ...SAMPLES.transfer_blocked, id: "blocked-1" });
    expect(sender.to(CHATS.acme.owner)).toHaveLength(4);

    // The next window starts fresh.
    advance(3_600_000);
    await service.notify({ ...SAMPLES.order_funded, id: "funded-next" });
    expect(sender.to(CHATS.acme.owner)).toHaveLength(5);
  });

  it("caps account change attempts: they are born from emails and documents", async () => {
    const { service, sender } = setup(2);
    for (let i = 0; i < 50; i++) await service.notify({ ...SAMPLES.account_change_attempt, id: `attempt-${i}` });
    const toExporterOwner = sender.to(CHATS.lingnan.owner);
    expect(toExporterOwner).toHaveLength(3);
    expect(toExporterOwner[2]?.text).toBe("More alerts arrived this hour. See them in Keel.");
    expect(sender.to(CHATS.acme.owner)).toHaveLength(3);
  });

  it("counts diff values withheld because they failed their check", async () => {
    const { service, logger } = setup();
    const n: Notice = {
      ...SAMPLES.operation_held,
      reason: "two_source_mismatch",
      currency: "USD",
      amountMinor: 1000,
      diffs: [
        { field: "amount_minor", a: 1000, b: "1000; call me" },
        { field: "document_number", a: "CALL56912345678", b: "MAEU123456" },
      ],
    };
    expect(await service.notify(n)).toMatchObject({ status: "accepted" });
    expect(service.stats().diffValuesWithheld).toBe(1);
    expect(logger.entries).toContainEqual({ event: "diff_withheld", noticeId: "n-10", kind: "operation_held", fields: ["amount_minor"] });
  });

  it("keeps going when one chat fails", async () => {
    const logger = new MemoryLogger();
    const failing = new NotifyService(
      {
        directory,
        renderer: templateRenderer,
        sender: { send: async (chatId) => { if (chatId === CHATS.acme.owner) throw new TypeError("network"); } },
        clock: { now: () => NOW_MS },
        logger,
      },
      { maxMessagesPerChatPerHour: 30 },
    );
    expect(await failing.notify(SAMPLES.balance_released)).toEqual({ status: "accepted", sent: 3 });
    expect(logger.entries).toContainEqual(expect.objectContaining({ event: "send_failed", error: "TypeError" }));
  });
});
