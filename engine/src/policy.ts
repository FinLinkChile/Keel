// Version of the rules behind `policyHash` (T2.2). The gate rejects a decision whose
// `policyHash` is not the one the owner set through the Delay (StalePolicy), and the
// verifier (T2.9) only replays a decision with the rules version it was made with.
import type { Hex } from "@keel/schemas";
import { canonicalHash } from "./canonical";
import { DEFAULT_FUNDING_POLICY, type FundingPolicy } from "./funding";

// Bump it whenever a rule of funding.ts or documents.ts changes what it decides.
// policy.test.ts fails on any change to those files until the version is reviewed.
export const TRADE_RULES_VERSION = "keel-trade/2";

export interface TradePolicy {
  rulesVersion: string;
  funding: FundingPolicy;
  // Hash of the versioned Zodiac Roles configuration file (Area 1): the on-chain part
  rolesConfigHash: Hex;
}

export const tradePolicy = (rolesConfigHash: Hex, funding: FundingPolicy = DEFAULT_FUNDING_POLICY): TradePolicy => ({
  rulesVersion: TRADE_RULES_VERSION,
  funding,
  rolesConfigHash,
});

// One policy hash per mode: Keel Trade signs both the funding and the document decisions with it.
export const tradePolicyHash = (policy: TradePolicy): Hex => canonicalHash({ mode: "trade", ...policy });
