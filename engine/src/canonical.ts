// Canonical JSON: keys sorted at every level and bigints as decimal strings, so the same
// value always hashes the same. `inputsHash` and `policyHash` are computed over it.
import type { Hex } from "@keel/schemas";
import { keccak256, toBytes } from "viem";

export function canonical(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as object)
        .sort()
        .map((k) => [k, canonical((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

export const canonicalHash = (value: unknown): Hex => keccak256(toBytes(JSON.stringify(canonical(value))));
