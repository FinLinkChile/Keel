import { describe, expect, it } from "vitest";
import { advanceOf, checkOrder, labelOf, lockedIn, orderDifferences } from "./rules";
import { ESCROW, makeOrder, now, TOKEN } from "./testkit";

describe("rules", () => {
  it("accepts a well formed order and names each problem of a bad one", () => {
    const { po, terms } = makeOrder();
    expect(checkOrder(po, terms, { now: now(), escrow: ESCROW, token: TOKEN })).toEqual([]);
    const bad = { ...po, carrier: po.arbiter, advanceBps: 10_001, shipmentDeadline: 1n };
    expect(checkOrder(bad, terms, { now: now(), escrow: ESCROW })).toEqual(["third_party_not_independent", "bad_advance", "deadline_passed"]);
    expect(checkOrder({ ...po, payoutAddress: ESCROW }, terms, { now: now(), escrow: ESCROW })).toContain("escrow_as_party");
  });

  it("labels and differences", () => {
    expect(labelOf("PO0131")).toBe("PO-0131");
    expect(labelOf("PO1234567")).toBeUndefined();
    const a = makeOrder();
    expect(orderDifferences(a, makeOrder({}, { hsCodes: ["090111"] }))).toEqual([]);
    expect(orderDifferences(a, makeOrder({}, { currency: "EUR" }))).toEqual(["termsHash", "terms.currency"]);
  });

  it("amounts the escrow holds", () => {
    const po = { totalAmount: 1001n, advanceBps: 3000 };
    expect(advanceOf(po)).toBe(300n);
    expect(lockedIn("OPEN", po)).toBe(0n);
    expect(lockedIn("SHIPPED", po)).toBe(701n);
    expect(lockedIn("SETTLED", po)).toBe(0n);
  });
});
