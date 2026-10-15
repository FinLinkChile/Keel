// The demo files in bot/examples must stay valid: every notice is accepted and reaches someone.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseDirectory } from "./adapters/config/recipients-file";
import { NotifyService } from "./application/notify";
import { templateRenderer } from "./presentation/templates";
import { MemoryLogger, MemorySender, NOW_MS } from "./testing/fixtures";

const DIR = join(import.meta.dirname, "..", "examples");
const read = (f: string): unknown => JSON.parse(readFileSync(join(DIR, f), "utf8"));
const recipients = read("recipients.json") as { accounts: Record<string, { roles: Record<string, number[]> }> };
const allowed = new Set(Object.values(recipients.accounts).flatMap((a) => Object.values(a.roles).flat()));

describe("examples", () => {
  for (const file of readdirSync(DIR).filter((f) => f !== "recipients.json" && f.endsWith(".json"))) {
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
