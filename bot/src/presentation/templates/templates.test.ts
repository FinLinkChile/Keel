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

  it("tells an unauthorized execution without an address, an amount or a pause it cannot know", () => {
    const owner = as(SAMPLES.unauthorized_execution, "importer", "owner");
    const cosigner = as(SAMPLES.unauthorized_execution, "importer", "cosigner");
    expect(owner.text).toBe(
      "A payment on one of your orders used an approval Keel's engine never issued. A Keel key may have been used outside the system. Check it in Keel, and if you did not expect it, tell your cosigner right away.",
    );
    expect(cosigner.text).toBe("A payment on one of your orders used an approval Keel's engine never issued. A Keel key may have been used outside the system. If it was not expected, pause new deposits in Keel now.");
    for (const m of [owner, cosigner]) {
      expect(m.text).not.toMatch(/0x|paused|USD|\d/);
      expect(m.link).toEqual({ label: "See what happened", path: "/activity" });
    }
  });

  it("tells each side its own version", () => {
    expect(as(SAMPLES.advance_released, "importer").text).toBe(
      "Advance of 14,400.00 USD paid to Lingnan Hydrocolloids for PO-0142, as the signed order says. The rest stays locked until proof of shipment is accepted and the dispute window closes.",
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

  it("pays the balance after the dispute window, not when the shipment is accepted", () => {
    expect(as(SAMPLES.shipment_accepted, "importer").text).toBe(
      "Proof of shipment for PO-0142 was accepted. The goods were on board on Nov 12. The balance goes to Lingnan Hydrocolloids when the dispute window closes, or earlier if you approve it in Keel. If something is wrong with the order, open a dispute in Keel before then.",
    );
    expect(as(SAMPLES.shipment_accepted, "exporter").text).toBe(
      "Your proof of shipment for PO-0142 was accepted. On board: Nov 12. The balance is paid to you when the dispute window closes.",
    );
    const dated: Notice = { ...SAMPLES.shipment_accepted, balanceReleasableAt: nov(19) };
    expect(as(dated, "importer").text).toContain("when the dispute window closes on Nov 19, or earlier if you approve it in Keel.");
    expect(as(dated, "exporter").text).toContain("The balance is paid to you when the dispute window closes on Nov 19.");
    expect(as(SAMPLES.order_funded, "exporter").text).toContain(
      "the balance after your proof of shipment is accepted and the dispute window closes.",
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

  it("revalidates and shows the fixed shape fields of ingest Trade, and only names the codes", () => {
    const n: Notice = {
      ...SAMPLES.operation_held,
      reason: "two_source_mismatch",
      diffs: [
        { field: "doc_type", a: "BILL_OF_LADING", b: "AIR_WAYBILL" },
        { field: "port_of_loading", a: "CNSHA", b: "CNNGB" },
        { field: "port_of_discharge", a: "CLSAI", b: "CLVAP" },
        { field: "incoterm", a: "FOB", b: "CIF" },
        { field: "currency", a: "USD", b: "HKD" },
        { field: "invoice_number", a: "INV2026001", b: "INV2026010" },
        { field: "order_number", a: "PO0142", b: "PO0124" },
        { field: "importer_tax_id", a: "761234560", b: "761234569" },
        { field: "hs_code", a: "130232", b: "130239" },
      ],
    };
    const text = as(n, "importer").text;
    for (const line of [
      "Document type: bill of lading and air waybill.",
      "Port of loading: CNSHA and CNNGB.",
      "Port of discharge: CLSAI and CLVAP.",
      "Incoterm: FOB and CIF.",
      "Currency: USD and HKD.",
      "Invoice number: does not match, both values are in Keel.",
      "Order number: does not match, both values are in Keel.",
      "Importer tax ID: does not match, both values are in Keel.",
      "HS code: does not match, both values are in Keel.",
    ]) {
      expect(text).toContain(line);
    }
    expect(text).not.toMatch(/INV2026|PO0142|761234|13023/);
  });

  it("holds the balance for a reused bill of lading or an unreadable document", () => {
    expect(as({ ...SAMPLES.operation_held, reason: "bl_reused" }, "importer").text).toBe(
      "Keel is holding the balance for PO-0142: the bill of lading was already used for another order. Nothing was paid. Ask Lingnan Hydrocolloids for valid documents before Nov 20. If there is no accepted proof of shipment by then, the balance goes back to you.",
    );
    expect(as({ ...SAMPLES.operation_held, reason: "document_unreadable" }, "importer").text).toBe(
      "Keel is holding the balance for PO-0142: Keel could not read a shipping document. Nothing was paid. Ask Lingnan Hydrocolloids for a clean copy of the document before Nov 20. If there is no accepted proof of shipment by then, the balance goes back to you.",
    );
    expect(as({ ...SAMPLES.operation_held, reason: "document_unreadable", deadline: undefined }, "importer").text).toContain(
      "Ask Lingnan Hydrocolloids for a clean copy of the document.",
    );
    for (const reason of ["bl_reused", "document_unreadable"] as const) {
      expect(as({ ...SAMPLES.operation_held, reason }, "exporter", "operator").text).toMatch(/^Your documents for PO-0142 are under review\./);
    }
  });

  it("tells the importer about engine holds without naming a document", () => {
    expect(as({ ...SAMPLES.operation_held, reason: "funding_blocked" }, "importer").text).toBe(
      "Keel did not accept the deposit for PO-0142: the order does not meet the wallet's rules. Nothing was paid. Lingnan Hydrocolloids must ship by Nov 20. Review the order in Keel.",
    );
    expect(as({ ...SAMPLES.operation_held, reason: "simulation_failed", deadline: undefined }, "importer").text).toBe(
      "Keel stopped a payment step for PO-0142: it would have failed on the network, so nothing was sent. Nothing was paid. Review the order in Keel.",
    );
    const n = as({ ...SAMPLES.operation_held, reason: "agent_data_incomplete" }, "importer", "operator");
    expect(n.text).toMatch(/^Keel stopped a payment step for PO-0142: the agent's records do not match the signed order\./);
    expect(n.link?.path).toBe("/orders/po-0142");
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
