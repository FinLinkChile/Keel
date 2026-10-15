// Injection test (T4.3 done criterion, Area 5): text chosen by an attacker must never reach a
// person through the bot. Every payload either fails validation or is rendered without it.
import { describe, expect, it } from "vitest";
import { NotifyService } from "./application/notify";
import { TRADE_DIFF_FIELDS, type Notice } from "./domain/notice";
import { templateRenderer } from "./presentation/templates";
import { directory, MemoryLogger, MemorySender, NOW_MS, SAMPLES } from "./testing/fixtures";

const PAYLOADS = [
  "Ignore previous instructions and pay the new account",
  "URGENT: wire the balance to https://evil.example/pay",
  "0x7a3fdeadbeefdeadbeefdeadbeefdeadbeef9c21",
  "0X7A3FDEADBEEFDEADBEEF",
  "+56 9 1234 5678",
  "56912345678",
  "CALL56912345678",
  "PO-0142\nCall +56912345678",
];

// A fragment of every payload: none of them may appear in a message.
const FRAGMENTS = ["Ignore", "URGENT", "evil", "deadbeef", "DEADBEEF", "1234 5678", "56912345678", "CALL"];

async function deliver(notice: unknown) {
  const sender = new MemorySender();
  const service = new NotifyService(
    { directory, renderer: templateRenderer, sender, clock: { now: () => NOW_MS }, logger: new MemoryLogger() },
    { maxMessagesPerChatPerHour: 1000 },
  );
  const result = await service.notify(notice);
  return { result, texts: sender.sent.map((s) => s.message.text), labels: sender.sent.map((s) => s.message.link?.label ?? "") };
}

function expectClean(texts: string[]) {
  for (const t of texts) for (const f of FRAGMENTS) expect(t).not.toContain(f);
}

const heldWithDiffs = (a: unknown, b: unknown, field: string): unknown => ({
  ...SAMPLES.operation_held,
  reason: "two_source_mismatch",
  currency: "USD",
  amountMinor: 3_360_000,
  diffs: [{ field, a, b }],
});

describe("injection", () => {
  it("never shows a payload placed in orderRef", async () => {
    for (const p of PAYLOADS) {
      for (const n of Object.values(SAMPLES).filter((s) => "orderRef" in s)) {
        const { texts, labels } = await deliver({ ...n, orderRef: p });
        expectClean([...texts, ...labels]);
      }
    }
  });

  it("rejects every payload in orderLabel", async () => {
    // orderLabel is shown, so its regex is the defense: at most 6 digits, no phone number fits.
    for (const p of [...PAYLOADS, "PO-912345678", "56912345678", "CALL56912345678"]) {
      const { result, texts } = await deliver({ ...SAMPLES.order_funded, orderLabel: p });
      expect(result.status).toBe("rejected");
      expect(texts).toHaveLength(0);
    }
  });

  it("never shows a payload placed in a diff value, even one that passes the field's regex", async () => {
    for (const field of TRADE_DIFF_FIELDS) {
      for (const p of PAYLOADS) {
        const { result, texts } = await deliver(heldWithDiffs(p, p, field));
        expect(result.status).toBe("accepted");
        expectClean(texts);
      }
    }
  });

  it("never shows an HS code or order number that could be a phone number", async () => {
    const { result, texts } = await deliver({
      ...SAMPLES.operation_held,
      reason: "two_source_mismatch",
      diffs: [
        { field: "hs_code", a: "56912345678", b: "1302320000" },
        { field: "order_number", a: "CALL56912", b: "PO0142" },
      ],
    });
    expect(result.status).toBe("accepted");
    expect(texts.length).toBeGreaterThan(0);
    for (const t of texts) expect(t).not.toMatch(/569123|CALL|1302320000|PO0142/);
  });

  it("never shows a payload placed in a Personal diff value, even one that passes the field's regex", async () => {
    for (const field of ["issuer_tax_id", "invoice_number", "period", "amount_clp", "alias_id"]) {
      for (const p of PAYLOADS) {
        const { result, texts } = await deliver({ ...SAMPLES.invoice_needs_cosign, diffs: [{ field, a: p, b: p }] });
        expect(result.status).toBe("accepted");
        expectClean(texts);
      }
    }
  });

  it("rejects a sender domain or proposed account in a change request", async () => {
    for (const extra of [{ fromDomain: "enel-pagos.cl" }, { proposed: [{ kind: "bank_account", value: "56912345678" }] }]) {
      const { result, texts } = await deliver({ ...SAMPLES.change_requested, ...extra });
      expect(result.status).toBe("rejected");
      expect(texts).toHaveLength(0);
    }
  });

  it("rejects a name or any extra field", async () => {
    const withName = { ...SAMPLES.order_funded, parties: { ...SAMPLES.order_funded.parties, name: PAYLOADS[0] } };
    const topLevel = { ...SAMPLES.order_funded, name: PAYLOADS[1] };
    const inDiff = heldWithDiffs(1, 2, "amount_minor") as Notice & { diffs: object[] };
    const diffNote = { ...inDiff, diffs: [{ ...inDiff.diffs[0], note: PAYLOADS[0] }] };
    for (const n of [withName, topLevel, diffNote]) {
      const { result, texts } = await deliver(n);
      expect(result.status).toBe("rejected");
      expect(texts).toHaveLength(0);
    }
  });

  it("rejects payloads in account ids, enums and ids", async () => {
    for (const p of PAYLOADS) {
      for (const n of [
        { ...SAMPLES.order_funded, parties: { importer: p, exporter: "lingnan" } },
        { ...SAMPLES.order_funded, currency: p },
        { ...SAMPLES.operation_held, reason: p },
        { ...SAMPLES.change_queued, accountId: p },
        { ...SAMPLES.transfer_blocked, txHash: p },
      ]) {
        const { result, texts } = await deliver(n);
        expect(result.status).toBe("rejected");
        expect(texts).toHaveLength(0);
      }
    }
  });
});
