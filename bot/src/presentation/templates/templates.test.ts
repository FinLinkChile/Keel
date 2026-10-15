import { describe, expect, it } from "vitest";
import { route } from "../../application/routing";
import type { Notice } from "../../domain/notice";
import type { Recipient } from "../../domain/recipients";
import { directory, nov, NOW_MS, SAMPLES } from "../../testing/fixtures";
import { render } from "./index";

const ctx = { now: NOW_MS, name: (a: string) => directory.name(a) ?? a };
const as = (n: Notice, side: Recipient["side"], role: Recipient["role"] = "owner") =>
  render(n, { accountId: "x", side, role }, ctx);

describe("templates", () => {
  it("renders every kind for every recipient, without the dot separator", () => {
    for (const n of Object.values(SAMPLES)) {
      for (const r of route(n)) {
        const m = render(n, r, ctx);
        expect(m.text).not.toContain("·");
        expect(m.text).not.toMatch(/undefined|NaN|\[object/);
        expect(m.link?.path).toMatch(/^\/[a-z0-9/_-]*$/i);
      }
    }
  });

  it("tells each side its own version", () => {
    expect(as(SAMPLES.advance_released, "importer").text).toBe(
      "Advance of 14,400.00 USD paid to Lingnan Hydrocolloids for PO-0142, as the signed order says. The rest stays locked until proof of shipment.",
    );
    expect(as(SAMPLES.advance_released, "exporter").text).toContain("You received the 14,400.00 USD advance for PO-0142.");
    expect(as(SAMPLES.balance_released, "importer").text).toBe(
      "Balance of 33,600.00 USD paid to Lingnan Hydrocolloids. Order PO-0142 is settled.",
    );
    expect(as(SAMPLES.order_funded, "exporter").text).toContain("The total is locked for you.");
  });

  it("tells the importer the advance is not part of a refund", () => {
    expect(as(SAMPLES.refunded, "importer").text).toBe(
      "33,600.00 USD went back to you for PO-0142. There was no accepted proof of shipment by the deadline. The advance already paid is not part of this refund. The order is closed.",
    );
    expect(as(SAMPLES.refunded, "exporter").text).toBe(
      "33,600.00 USD went back to Acme Imports for PO-0142. There was no accepted proof of shipment by the deadline. The order is closed.",
    );
  });

  it("links to the order", () => {
    expect(as(SAMPLES.order_opened, "importer").link).toEqual({ label: "Open the order", path: "/orders/po-0142" });
  });

  it("says how much time is left", () => {
    expect(as(SAMPLES.deadline_approaching, "exporter").text).toBe(
      "Ship by Oct 17: 3 days left for PO-0142. If there is no proof of shipment by then, the balance goes back to Acme Imports. Upload the bill of lading in Keel as soon as the goods are on board.",
    );
    expect(as({ ...SAMPLES.deadline_approaching, daysLeft: 1 }, "importer").text).toContain("1 day left");
    expect(as({ ...SAMPLES.order_opened, shipmentDeadline: Date.UTC(2027, 0, 5) / 1000 }, "importer").text).toContain(
      "Jan 5, 2027",
    );
  });

  it("stops an account change without naming the account", () => {
    expect(as(SAMPLES.account_change_attempt, "importer").text).toContain(
      "Keel stopped an account change on PO-0142. The account in the signed order did not change. Nothing was paid.",
    );
  });

  it("asks the cosigner to approve a deposit above the limit", () => {
    const n: Notice = {
      ...SAMPLES.operation_held,
      orderLabel: "PO-0160",
      reason: "over_limit_cosign",
      amountMinor: 9_500_000,
      currency: "USD",
      deadline: undefined,
    };
    expect(as(n, "importer", "owner").text).toContain(
      "Your cosigner needs to approve a 95,000.00 USD deposit for PO-0160. It is above this month's limit.",
    );
    const toCosigner = as(n, "importer", "cosigner");
    expect(toCosigner.text).toContain("Your approval is needed");
    expect(toCosigner.link?.path).toBe("/cosigner");
  });

  it("never tells the exporter which control fired", () => {
    for (const reason of ["documents_mismatch", "two_source_mismatch", "hidden_text", "account_change_mention"] as const) {
      const n: Notice = {
        ...SAMPLES.operation_held,
        reason,
        currency: "USD",
        amountMinor: 3_360_000,
        ...(reason === "two_source_mismatch" ? { diffs: [{ field: "amount_minor" as const, a: 3_360_000, b: 33_600_000 }] } : {}),
      };
      expect(as(n, "exporter", "operator").text).toBe(
        "Your documents for PO-0142 are under review. The balance is not paid yet. Accepted proof of shipment is needed by Nov 20. If anything else is needed, Acme Imports will contact you.",
      );
      expect(as(n, "importer").link?.path).toBe("/orders/po-0142/documents");
    }
  });

  it("shows both readings of fixed shape fields and only the name of identifiers", () => {
    const n: Notice = {
      ...SAMPLES.operation_held,
      reason: "two_source_mismatch",
      amountMinor: 3_360_000,
      currency: "USD",
      diffs: [
        { field: "amount_minor", a: 3_360_000, b: 33_600_000 },
        { field: "on_board_date", a: nov(12), b: nov(14) },
        { field: "document_number", a: "MAEU123456", b: "MAEU123465" },
      ],
    };
    const text = as(n, "importer").text;
    expect(text).toContain("Amount: 33,600.00 USD and 336,000.00 USD.");
    expect(text).toContain("On board date: Nov 12 and Nov 14.");
    expect(text).toContain("Document number: does not match, both values are in Keel.");
    expect(text).not.toContain("MAEU");
  });

  it("falls back to the field name when a value fails its check", () => {
    const n: Notice = {
      ...SAMPLES.operation_held,
      reason: "two_source_mismatch",
      currency: "USD",
      amountMinor: 3_360_000,
      diffs: [{ field: "amount_minor", a: 3_360_000, b: "call +56 9 1234 5678" }],
    };
    const text = as(n, "importer").text;
    expect(text).toContain("Amount: does not match, both values are in Keel.");
    expect(text).not.toContain("5678");
  });
});
