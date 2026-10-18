// Policy engine. Owned by Area 2.
import type { InvoiceExtraction, PaymentIntent, Tier } from "@keel/schemas";

export * from "./documents";
export * from "./funding";
export * from "./keys";
export * from "./pdr";
export * from "./policy";
export * from "./verify";
export * from "./agent/agent";
export * from "./agent/detail";
export * from "./agent/escrow";
export * from "./agent/store";
// What a host other than the CLI needs to run the agent and the monitor (aws/src/handlers)
export * from "./agent/compose";
export * from "./agent/gate";
export * from "./agent/notices";
export * from "./agent/rpc";
export * from "./monitor/monitor";
export * from "./monitor/notices";
export * from "./monitor/rpc";

export interface RuleResult<R extends string = string, C extends string = string> {
  rule: R;
  // Minimum tier this rule forces. The final tier is the maximum across rules.
  tier: Tier;
  // Why the rule gave that tier, as a code for templated notices
  reason?: C;
}

export interface Evaluation {
  tier: Tier;
  rules: RuleResult[];
  // Absent when the payment is held or blocked
  intent?: PaymentIntent;
}

// Everything the engine needs besides the extraction. The time is a parameter:
// the engine has no network, no LLM and no implicit clock.
export interface EvaluationContext {
  // Unix timestamp, seconds
  now: number;
}

// Pure function. T2.2, issue #10.
export function evaluate(_extraction: InvoiceExtraction, _context: EvaluationContext): Evaluation {
  throw new Error("not implemented: T2.2 (#10)");
}
