import type { EmailOutcome, StoredChangeRequest } from "@keel/ingest";
import { describe, expect, it } from "vitest";
import { NotifyService } from "../../application/notify";
import { Notice } from "../../domain/notice";
import { templateRenderer } from "../../presentation/templates";
import { directory, MemoryLogger, MemorySender, NOW_MS } from "../../testing/fixtures";
import { mapChangeDigest, mapEmailOutcome } from "./ingest-mapper";

const opts = { accountId: "ana", now: () => NOW_MS };
const received = { messageHash: "a".repeat(64), auth: { spf: "pass", dkim: "pass", dmarc: "pass", fromDomain: "enel-pagos.cl" } };
const extraction = {
  alias_id: "LUZ" as const,
  issuer_tax_id: "761234560",
  invoice_number: "4521",
  period: "202610",
  amount_clp: 45990,
  due_date: 1792195200,
  mentions_account_change: true,
  hidden_text_detected: false,
};
const readings = {
  extraction,
  invoiceKey: `0x${"1".repeat(64)}` as const,
  destinations: [{ kind: "bank_account" as const, value: "56912345678" }],
  hiddenReasons: [],
};
const request = (id: number, aliasId: "LUZ" | "INTERNET" = "LUZ"): StoredChangeRequest => ({
  id,
  status: "pending",
  aliasId,
  previous: [{ kind: "bank_account", value: "123456789" }],
  proposed: [{ kind: "bank_account", value: "56912345678" }],
  triggers: ["announced_in_document", "unknown_destination"],
  source: { fromDomain: "enel-pagos.cl", auth: received.auth },
  documentHash: "b".repeat(64),
  messageHash: "c".repeat(64),
  createdAt: "2026-10-14T09:00:00.000Z",
});

describe("mapEmailOutcome", () => {
  it("maps an escalated invoice to a cosign notice, parser in a and LLM in b", () => {
    const outcome: EmailOutcome = {
      status: "escalated",
      tier: 3,
      diffs: [{ field: "amount_clp", parser: 45990, llm: 459900 }],
      ...readings,
      ...received,
    };
    expect(mapEmailOutcome(outcome, opts)).toEqual({
      mode: "personal",
      accountId: "ana",
      occurredAt: NOW_MS / 1000,
      id: `ingest:escalated:${"a".repeat(64)}`,
      kind: "invoice_needs_cosign",
      aliasId: "LUZ",
      diffs: [{ field: "amount_clp", a: 45990, b: 459900 }],
    });
  });

  it("maps held invoices with their reason", () => {
    const parser: EmailOutcome = { status: "held", reason: "parser_failed", failure: "no_text", ...received };
    const llm: EmailOutcome = { status: "held", reason: "extractor_failed", failure: "refused", ...received };
    expect(mapEmailOutcome(parser, opts)).toMatchObject({ kind: "invoice_held", reason: "parser_failed" });
    expect(mapEmailOutcome(llm, opts)).toMatchObject({ kind: "invoice_held", reason: "extractor_failed" });
  });

  it("maps a change request without the domain or the accounts", () => {
    const outcome: EmailOutcome = { status: "change_requested", changeRequest: request(12), ...readings, ...received };
    const notice = mapEmailOutcome(outcome, opts);
    expect(notice).toEqual({
      mode: "personal",
      accountId: "ana",
      occurredAt: Date.parse("2026-10-14T09:00:00.000Z") / 1000,
      id: "ingest:change:12",
      kind: "change_requested",
      aliasId: "LUZ",
      triggers: ["announced_in_document", "unknown_destination"],
      requestId: 12,
    });
    expect(JSON.stringify(notice)).not.toMatch(/enel|56912345678|123456789/);
  });

  it("produces nothing for quarantined, duplicate or ready emails", () => {
    const outcomes: EmailOutcome[] = [
      { status: "quarantined", reason: "rate_limited", ...received },
      { status: "duplicate", ...received },
      { status: "ready", ...readings, ...received },
    ];
    for (const o of outcomes) expect(mapEmailOutcome(o, opts)).toBeNull();
  });

  it("produces notices the service accepts and sends", async () => {
    const sender = new MemorySender();
    const service = new NotifyService(
      { directory, renderer: templateRenderer, sender, clock: { now: () => NOW_MS }, logger: new MemoryLogger() },
      { maxMessagesPerChatPerHour: 30 },
    );
    const outcome: EmailOutcome = { status: "change_requested", changeRequest: request(12), ...readings, ...received };
    const notice = mapEmailOutcome(outcome, opts);
    expect(Notice.safeParse(notice).success).toBe(true);
    expect(await service.notify(notice)).toEqual({ status: "accepted", sent: 2 });
  });
});

describe("mapChangeDigest", () => {
  const since = new Date("2026-10-14T00:00:00Z");

  it("counts requests and lists each alias once", () => {
    const notice = mapChangeDigest([request(3), request(4, "INTERNET"), request(5)], since, opts);
    expect(notice).toEqual({
      mode: "personal",
      accountId: "ana",
      occurredAt: NOW_MS / 1000,
      id: `ingest:digest:${since.getTime() / 1000}:5`,
      kind: "change_digest",
      count: 3,
      aliasIds: ["LUZ", "INTERNET"],
    });
    expect(Notice.safeParse(notice).success).toBe(true);
  });

  it("produces nothing without requests", () => {
    expect(mapChangeDigest([], since, opts)).toBeNull();
  });
});
