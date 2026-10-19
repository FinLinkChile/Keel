import { describe, expect, it } from "vitest";
import type { Notice } from "../../domain/notice";
import type { Recipient } from "../../domain/recipients";
import { directory, NOW_MS, SAMPLES } from "../../testing/fixtures";
import { render } from "./index";

const ctx = { now: NOW_MS, name: (a: string) => directory.name(a) ?? a };
const to = (n: Notice, role: Recipient["role"] = "owner") => render(n, { accountId: "ana", role }, ctx);

describe("personal templates", () => {
  it("says a held bill is due and how to pay it by hand", () => {
    expect(to(SAMPLES.payment_deadline).text).toBe(
      "Your LUZ bill of $45.990 is on hold and is due in 3 days (Oct 17). If it is urgent, pay it from your bank as usual.",
    );
    expect(to({ ...SAMPLES.payment_deadline, daysLeft: 1 }).text).toContain("is due tomorrow");
    expect(to(SAMPLES.payment_held).text).toBe(
      "Your LUZ bill of $45.990 is on hold: the exchange rate sources disagree. Nothing was paid. It is due on Oct 17. If it is urgent, pay it from your bank as usual.",
    );
    expect(to(SAMPLES.payment_held).link).toEqual({ label: "Open the bill", path: "/bills/LUZ" });
    expect(to({ ...SAMPLES.payment_held, reason: "issuer_mismatch" }).text).toBe(
      "Your LUZ bill of $45.990 is on hold: the bill comes from a different company than the one registered for LUZ. Nothing was paid. It is due on Oct 17. If it is urgent, pay it from your bank as usual.",
    );
  });

  it("shows both readings of the amount, as in T3.5", () => {
    expect(to(SAMPLES.invoice_needs_cosign).text).toBe(
      "The two readings of your LUZ bill disagree on the amount: $45.990 and $459.900. Your cosigner needs to approve it before it is paid.",
    );
    const cosigner = to(SAMPLES.invoice_needs_cosign, "cosigner");
    expect(cosigner.text).toBe(
      "Your approval is needed. The two readings of Ana's LUZ bill disagree on the amount: $45.990 and $459.900. Nothing is paid until you approve it.",
    );
    expect(cosigner.link?.path).toBe("/cosigner");
  });

  it("names identifiers without showing them, and lists several diffs", () => {
    const n: Notice = {
      ...SAMPLES.invoice_needs_cosign,
      diffs: [
        { field: "issuer_tax_id", a: "761234560", b: "912345678" },
        { field: "period", a: "202610", b: "202611" },
        { field: "alias_id", a: "LUZ", b: "INTERNET" },
      ],
    };
    const text = to(n).text;
    expect(text).toContain("Issuer tax ID: does not match, both values are in Keel.");
    expect(text).toContain("Period: Oct 2026 and Nov 2026.");
    expect(text).toContain("Bill type: LUZ and INTERNET.");
    expect(text).not.toMatch(/761234560|912345678/);
    expect(to({ ...n, diffs: [{ field: "invoice_number", a: "4521", b: "4512" }] }).text).toBe(
      "The two readings of your LUZ bill disagree on the invoice number. Both values are in Keel. Your cosigner needs to approve it before it is paid.",
    );
  });

  it("tells about a change request without the domain or the accounts", () => {
    const owner = to(SAMPLES.change_requested);
    expect(owner.text).toBe(
      "A LUZ bill asks to change where it is paid: it announces a new account and it shows an account that is not registered. Keel changed nothing and paid nothing. Approve it in Keel only if you expected this change.",
    );
    expect(owner.link?.path).toBe("/changes/12");
    expect(to(SAMPLES.change_requested, "cosigner").text).toContain("Ana got a request to change where the LUZ bill is paid");
  });

  it("summarizes change requests", () => {
    expect(to(SAMPLES.change_digest).text).toBe(
      "3 account change requests arrived today for LUZ and INTERNET. Review them in Keel. Do not approve a change you did not expect.",
    );
    expect(to({ ...SAMPLES.change_digest, count: 1, aliasIds: ["GASTOS_COMUNES"] }).text).toContain(
      "1 account change request arrived today for GASTOS COMUNES.",
    );
  });

  it("says a bill could not be read", () => {
    expect(to(SAMPLES.invoice_held).text).toBe(
      "Keel could not read a bill. It was not paid. Check it in Keel. If it is urgent, pay it from your bank as usual.",
    );
    expect(to({ ...SAMPLES.invoice_held, aliasId: "INTERNET", reason: "extractor_failed" }).text).toContain(
      "Keel could not finish reading your INTERNET bill.",
    );
  });

  it("covers payments made and changes stopped or scheduled", () => {
    expect(to(SAMPLES.payment_executed).text).toBe("Your LUZ bill of $45.990 was paid to its registered account.");
    expect(to(SAMPLES.change_vetoed).text).toContain("was stopped");
    expect(to(SAMPLES.change_scheduled).text).toContain("takes effect on Oct 21");
    expect(to(SAMPLES.change_scheduled, "cosigner").text).toContain("Ana's LUZ bill");
  });
});
