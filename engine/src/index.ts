// Policy engine. Owned by Area 2.
import type { InvoiceExtraction, PaymentIntent, Tier } from "@keel/schemas";

export interface RuleResult {
  rule: string;
  // Minimum tier this rule forces. The final tier is the maximum across rules.
  tier: Tier;
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
