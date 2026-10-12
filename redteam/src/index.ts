// Red team battery. Owned by Area 5. T5.4, issue #37.

export const CATEGORIES = [
  "invoice",
  "email",
  "interface",
  "exchange_rate",
  "keys",
  "contract",
  "onboarding",
] as const;
export type Category = (typeof CATEGORIES)[number];

// The layer that stopped the attack: the metric that shows defense in depth.
export const LAYERS = ["email", "extractor", "engine", "gate", "roles", "human"] as const;
export type Layer = (typeof LAYERS)[number];

export interface Scenario {
  id: string;
  category: Category;
  // true for the adversarial cases, false for legitimate invoices (false positive check)
  attack: boolean;
  expectedLayer?: Layer;
  run(): Promise<ScenarioResult>;
}

export interface ScenarioResult {
  paid: boolean;
  stoppedBy?: Layer;
  latencyMs: number;
}
