import type { Hex, PurchaseOrder } from "@keel/schemas";
import { bytes32Text, requiredDocsHash, structHash } from "@keel/schemas/hash";
import { describe, expect, it } from "vitest";
import { DEFAULT_FUNDING_POLICY, evaluateFunding, type FundingContext } from "./funding";

const address = (n: number): Hex => `0x${n.toString(16).padStart(40, "0")}`;
const DAY = 24 * 60 * 60;
const NOW = 1_792_000_000;

const order: PurchaseOrder = {
  orderId: `0x${"42".repeat(32)}`,
  importer: address(0xa1),
  exporter: address(0xb2),
  payoutAddress: address(0xb3),
  token: address(0xc4),
  totalAmount: 10_000_000_000n,
  advanceBps: 5000,
  shipmentDeadline: BigInt(NOW + 30 * DAY),
  disputeWindow: BigInt(7 * DAY),
  carrier: address(0xd5),
  arbiter: address(0xe6),
  documentVerifier: address(0xe7),
  incoterm: bytes32Text("CIF"),
  termsHash: `0x${"11".repeat(32)}`,
  requiredDocsHash: requiredDocsHash(["BILL_OF_LADING", "COMMERCIAL_INVOICE"]),
  nonce: 7n,
};

const context: FundingContext = {
  now: NOW,
  safe: order.importer,
  escrow: address(0xf7),
  escrowOrder: { state: "OPEN", orderHash: structHash("PurchaseOrder", order) },
  registeredParties: [order.importer, order.exporter, order.carrier, order.arbiter, order.documentVerifier],
  knownSuppliers: [{ exporter: order.exporter, payoutAddress: order.payoutAddress }],
  allowance: { token: order.token, remaining: 50_000_000_000n },
  history: [9_000_000_000n, 11_000_000_000n],
  nonce: 1n,
};

const ruleOf = (ctx: FundingContext, rule: string, o: PurchaseOrder = order) =>
  evaluateFunding(o, ctx).rules.find((r) => r.rule === rule);

describe("evaluateFunding", () => {
  it("a signed order to a known supplier within every limit is tier 1, with its funding intent", () => {
    const result = evaluateFunding(order, context);
    expect(result.tier).toBe(1);
    expect(result.intent).toEqual({
      orderId: order.orderId,
      orderHash: structHash("PurchaseOrder", order),
      escrow: context.escrow,
      token: order.token,
      amount: order.totalAmount,
      deadline: BigInt(NOW + DEFAULT_FUNDING_POLICY.intentTtlSeconds),
      nonce: 1n,
    });
  });

  it("is deterministic: the same inputs give the same decision", () => {
    expect(evaluateFunding(order, context)).toEqual(evaluateFunding(order, context));
  });

  describe("order-signed", () => {
    it("blocks an order the escrow never opened", () => {
      expect(ruleOf({ ...context, escrowOrder: null }, "order-signed")).toMatchObject({ tier: 4, reason: "ORDER_NOT_FOUND" });
    });

    it("treats the NONE state as an order that does not exist", () => {
      const escrowOrder = { ...context.escrowOrder!, state: "NONE" as const };
      expect(ruleOf({ ...context, escrowOrder }, "order-signed")).toMatchObject({ tier: 4, reason: "ORDER_NOT_FOUND" });
    });

    it("blocks an order that is no longer open", () => {
      const escrowOrder = { ...context.escrowOrder!, state: "FUNDED" as const };
      expect(ruleOf({ ...context, escrowOrder }, "order-signed")).toMatchObject({ tier: 4, reason: "ORDER_NOT_OPEN" });
    });

    it("blocks an order that differs from the signed one, for example in the payout address", () => {
      const tampered = { ...order, payoutAddress: address(0x666) };
      expect(ruleOf(context, "order-signed", tampered)).toMatchObject({ tier: 4, reason: "ORDER_HASH_MISMATCH" });
    });
  });

  describe("own-order", () => {
    it("blocks an order whose importer is another Safe", () => {
      expect(ruleOf({ ...context, safe: address(0x5afe) }, "own-order")).toMatchObject({ tier: 4, reason: "NOT_THIS_SAFE" });
    });
  });

  describe("known-supplier", () => {
    it("escalates to tier 2 a supplier never verified", () => {
      expect(ruleOf({ ...context, knownSuppliers: [] }, "known-supplier")).toMatchObject({ tier: 2, reason: "SUPPLIER_NEW" });
    });

    it("treats a known exporter with a new payout address as a new supplier", () => {
      const knownSuppliers = [{ exporter: order.exporter, payoutAddress: address(0xb4) }];
      expect(ruleOf({ ...context, knownSuppliers }, "known-supplier")).toMatchObject({ tier: 2, reason: "SUPPLIER_NEW" });
    });

    it.each(["importer", "exporter", "carrier", "arbiter", "documentVerifier"] as const)("blocks when the %s is not registered", (party) => {
      const registeredParties = context.registeredParties.filter((p) => p !== order[party]);
      expect(ruleOf({ ...context, registeredParties }, "known-supplier")).toMatchObject({ tier: 4, reason: "PARTY_NOT_REGISTERED" });
    });

    it("compares addresses without regard to checksum case", () => {
      const knownSuppliers = [{ exporter: order.exporter.toUpperCase().replace("0X", "0x") as Hex, payoutAddress: order.payoutAddress }];
      expect(ruleOf({ ...context, knownSuppliers }, "known-supplier")).toMatchObject({ tier: 1 });
    });
  });

  describe("independent-roles", () => {
    it.each([
      ["the carrier is the exporter", { carrier: order.exporter }],
      ["the arbiter is the importer", { arbiter: order.importer }],
      ["the document verifier is the importer", { documentVerifier: order.importer }],
      ["the document verifier is the exporter", { documentVerifier: order.exporter }],
      ["the document verifier is the carrier", { documentVerifier: order.carrier }],
    ])("blocks an order where %s", (_case, over) => {
      const o = { ...order, ...over };
      const ctx = { ...context, escrowOrder: { state: "OPEN" as const, orderHash: structHash("PurchaseOrder", o) } };
      expect(ruleOf(ctx, "independent-roles", o)).toMatchObject({ tier: 4, reason: "ROLE_NOT_INDEPENDENT" });
    });

    it("accepts five different roles", () => {
      expect(ruleOf(context, "independent-roles")).toMatchObject({ tier: 1, reason: "ROLES_INDEPENDENT" });
    });
  });

  describe("period-allowance", () => {
    it("asks for the cosigner when the order does not fit the remaining allowance", () => {
      const allowance = { ...context.allowance, remaining: order.totalAmount - 1n };
      expect(ruleOf({ ...context, allowance }, "period-allowance")).toMatchObject({ tier: 3, reason: "OVER_ALLOWANCE" });
    });

    it("accepts an order that uses exactly the remaining allowance", () => {
      const allowance = { ...context.allowance, remaining: order.totalAmount };
      expect(ruleOf({ ...context, allowance }, "period-allowance")).toMatchObject({ tier: 1 });
    });

    it("blocks a token with no allowance", () => {
      const allowance = { ...context.allowance, token: address(0xc5) };
      expect(ruleOf({ ...context, allowance }, "period-allowance")).toMatchObject({ tier: 4, reason: "TOKEN_NOT_ALLOWED" });
    });
  });

  describe("amount-in-range", () => {
    it("asks for the cosigner when the amount is far from the usual one with that supplier", () => {
      expect(ruleOf({ ...context, history: [2_000_000_000n, 2_000_000_000n] }, "amount-in-range")).toMatchObject({
        tier: 3,
        reason: "AMOUNT_OUT_OF_RANGE",
      });
    });

    it("accepts the edge of the tolerance and escalates just past it", () => {
      // Average 8.000, tolerance 25%: 10.000 is exactly on the edge
      expect(ruleOf({ ...context, history: [8_000_000_000n] }, "amount-in-range")).toMatchObject({ tier: 1 });
      expect(ruleOf({ ...context, history: [7_999_999_999n] }, "amount-in-range")).toMatchObject({ tier: 3 });
    });

    it("does not escalate a first order: the supplier rule already covers it", () => {
      expect(ruleOf({ ...context, history: [] }, "amount-in-range")).toMatchObject({ tier: 1, reason: "NO_HISTORY" });
    });
  });

  describe("shipment-deadline", () => {
    it("blocks an order whose shipment deadline already passed", () => {
      expect(ruleOf({ ...context, now: Number(order.shipmentDeadline) }, "shipment-deadline")).toMatchObject({
        tier: 4,
        reason: "DEADLINE_PASSED",
      });
    });

    it("accepts a close deadline with a notice", () => {
      const now = Number(order.shipmentDeadline) - DAY;
      expect(ruleOf({ ...context, now }, "shipment-deadline")).toMatchObject({ tier: 1, reason: "DEADLINE_SOON" });
    });
  });

  it("the final tier is the highest one any rule forces", () => {
    const result = evaluateFunding(order, {
      ...context,
      knownSuppliers: [],
      allowance: { ...context.allowance, remaining: 0n },
    });
    expect(result.tier).toBe(3);
    expect(result.intent).toBeDefined();
  });

  it("a blocked deposit carries no intent, so there is nothing to sign", () => {
    const result = evaluateFunding(order, { ...context, escrowOrder: null });
    expect(result.tier).toBe(4);
    expect(result.intent).toBeUndefined();
  });
});
