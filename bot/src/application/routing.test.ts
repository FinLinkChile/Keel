import { describe, expect, it } from "vitest";
import { DOCUMENT_REASONS, HELD_REASONS, type Notice } from "../domain/notice";
import { PERSONAL_SAMPLES, SAMPLES, TRADE_SAMPLES } from "../testing/fixtures";
import { route } from "./routing";

const who = (n: Notice) => route(n).map((r) => `${r.side}:${r.role}`);
const held = (reason: (typeof HELD_REASONS)[number]): Notice => ({ ...SAMPLES.operation_held, reason });

describe("route", () => {
  it("follows the routing table", () => {
    expect(who(SAMPLES.order_funded)).toEqual(["importer:owner", "importer:operator", "exporter:owner", "exporter:operator"]);
    expect(who(SAMPLES.advance_released)).toEqual(["importer:operator", "exporter:owner", "exporter:operator"]);
    expect(who(SAMPLES.deadline_approaching)).toEqual(["importer:operator", "exporter:owner", "exporter:operator"]);
    expect(who(held("over_limit_cosign"))).toEqual(["importer:cosigner", "importer:owner"]);
    expect(who(held("new_supplier_wait"))).toEqual(["importer:owner", "importer:operator"]);
    for (const r of ["funding_blocked", "simulation_failed", "agent_data_incomplete"] as const) {
      expect(who(held(r))).toEqual(["importer:owner", "importer:operator"]);
    }
    expect(who(SAMPLES.account_change_attempt)).toEqual(["importer:owner", "importer:operator", "exporter:owner"]);
    expect(who(SAMPLES.change_queued)).toEqual(["importer:cosigner", "importer:owner"]);
    for (const k of ["transfer_blocked", "agent_revoked", "gate_paused"] as const) {
      expect(who(SAMPLES[k])).toEqual(["importer:owner", "importer:cosigner"]);
    }
    expect(who(SAMPLES.dispute_raised)).toEqual([
      "importer:owner",
      "importer:operator",
      "exporter:owner",
      "exporter:operator",
      "arbiter:owner",
    ]);
  });

  it("sends document holds to the exporter's operator only", () => {
    for (const reason of DOCUMENT_REASONS) {
      expect(who(held(reason))).toEqual(["importer:owner", "importer:operator", "exporter:operator"]);
    }
  });

  it("gives every Trade recipient a side", () => {
    for (const n of TRADE_SAMPLES) for (const r of route(n)) expect(r.side).toBeDefined();
  });

  it("gives no Personal recipient a side, and never an operator", () => {
    for (const n of PERSONAL_SAMPLES) {
      expect(route(n).length).toBeGreaterThan(0);
      for (const r of route(n)) {
        expect(r.side).toBeUndefined();
        expect(r.accountId).toBe("ana");
        expect(r.role).not.toBe("operator");
      }
    }
  });

  it("follows the Personal routing table", () => {
    const roles = (n: Notice) => route(n).map((r) => r.role);
    for (const k of ["payment_held", "payment_deadline", "invoice_held", "payment_executed", "change_vetoed"] as const) {
      expect(roles(SAMPLES[k])).toEqual(["owner"]);
    }
    for (const k of ["change_scheduled", "change_requested", "change_digest"] as const) {
      expect(roles(SAMPLES[k])).toEqual(["owner", "cosigner"]);
    }
    expect(roles(SAMPLES.invoice_needs_cosign)).toEqual(["cosigner", "owner"]);
  });

  it("reaches the arbiter only on disputes", () => {
    for (const n of Object.values(SAMPLES)) {
      const toArbiter = route(n).some((r) => r.side === "arbiter");
      expect(toArbiter).toBe(n.kind === "dispute_raised" || n.kind === "dispute_resolved");
    }
  });

  it("maps sides to the parties of the notice", () => {
    const [imp, , exp, , arb] = route(SAMPLES.dispute_raised);
    expect([imp?.accountId, exp?.accountId, arb?.accountId]).toEqual(["acme-imports", "lingnan", "hk-arbitration"]);
    expect(route(SAMPLES.transfer_blocked).every((r) => r.accountId === "acme-imports")).toBe(true);
  });
});
