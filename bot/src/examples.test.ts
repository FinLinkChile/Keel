// The demo files in bot/examples must stay valid: every notice is accepted and reaches someone.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseOrders } from "./adapters/config/orders-file";
import { parseDirectory } from "./adapters/config/recipients-file";
import { NotifyService } from "./application/notify";
import { templateRenderer } from "./presentation/templates";
import { MemoryLogger, MemorySender, NOW_MS } from "./testing/fixtures";

const DIR = join(import.meta.dirname, "..", "examples");
const read = (f: string): unknown => JSON.parse(readFileSync(join(DIR, f), "utf8"));
const recipients = read("recipients.json") as { accounts: Record<string, { roles: Record<string, number[]> }> };
const allowed = new Set(Object.values(recipients.accounts).flatMap((a) => Object.values(a.roles).flat()));

describe("examples", () => {
  const NOT_NOTICES = new Set(["recipients.json", "orders.json"]);
  const noticeFiles = readdirSync(DIR).filter((f) => !NOT_NOTICES.has(f) && f.endsWith(".json"));

  it("orders.json loads and every order notice matches its entry", () => {
    const d = parseDirectory(recipients, allowed);
    const book = parseOrders(read("orders.json"), (a) => d.name(a) !== undefined);
    expect(book.size).toBe(3);
    for (const file of noticeFiles) {
      for (const n of read(file) as { orderRef?: string; orderLabel?: string; parties?: object }[]) {
        if (!n.orderRef) continue;
        const entry = book.get(n.orderRef);
        expect(entry, `${file} ${n.orderLabel}`).toBeDefined();
        expect(entry?.label).toBe(n.orderLabel);
        expect(entry?.parties).toEqual(n.parties);
      }
    }
  });

  for (const file of noticeFiles) {
    it(`${file} is accepted in full`, async () => {
      const sender = new MemorySender();
      const service = new NotifyService(
        {
          directory: parseDirectory(recipients, allowed),
          renderer: templateRenderer,
          sender,
          clock: { now: () => NOW_MS },
          logger: new MemoryLogger(),
        },
        { maxMessagesPerChatPerHour: 30 },
      );
      const notices = read(file) as unknown[];
      for (const n of notices) expect(await service.notify(n)).toMatchObject({ status: "accepted" });
      expect(service.stats()).toMatchObject({ rejected: 0, noChats: 0, rateLimited: 0 });
      expect(sender.sent.length).toBeGreaterThan(0);
    });
  }
});
