import { readFileSync } from "node:fs";
import { keccak256, toBytes } from "viem";
import { describe, expect, it } from "vitest";
import { DEFAULT_FUNDING_POLICY } from "./funding";
import { TRADE_RULES_VERSION, tradePolicy, tradePolicyHash } from "./policy";
import { word } from "./testing/fixtures";

// The rule files each version was reviewed with. Line endings are normalized for Windows checkouts.
const REVIEWED: Record<string, string> = {
  "keel-trade/1": "0x257dd920e56629cd135498340a0eb3075b2dd30e7b991b67dcf3b544545f14cf",
};

const rulesSource = () =>
  keccak256(toBytes(["funding.ts", "documents.ts"].map((f) => readFileSync(new URL(f, import.meta.url), "utf8").replace(/\r\n/g, "\n")).join("\n")));

describe("policy hash (T2.2)", () => {
  // If this fails you changed a rule file. When the change alters any decision, bump
  // TRADE_RULES_VERSION (the owner then sets the new policy hash through the Delay);
  // either way record the new hash here.
  it("the rule files are the ones reviewed for the current rules version", () => {
    expect(rulesSource()).toBe(REVIEWED[TRADE_RULES_VERSION]);
  });

  it("changes with the rules version, the parameters and the Roles configuration", () => {
    const base = tradePolicyHash(tradePolicy(word("roles-v1")));
    expect(tradePolicyHash(tradePolicy(word("roles-v1")))).toBe(base);
    expect(tradePolicyHash({ ...tradePolicy(word("roles-v1")), rulesVersion: "keel-trade/2" })).not.toBe(base);
    expect(tradePolicyHash(tradePolicy(word("roles-v1"), { ...DEFAULT_FUNDING_POLICY, intentTtlSeconds: 60 }))).not.toBe(base);
    expect(tradePolicyHash(tradePolicy(word("roles-v2")))).not.toBe(base);
  });
});
