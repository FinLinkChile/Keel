import type { Hex } from "@keel/schemas";
import { decodeFunctionData, encodeFunctionResult, keccak256, toBytes } from "viem";
import { describe, expect, it } from "vitest";
import type { AgentChain } from "./agent";
import { accruedAllowance, type RolesAllowance, ZODIAC_ROLES_ABI, zodiacRolesAllowance } from "./gate";

const DAY = 86_400n;
const T0 = 1_762_000_000n;
const CAP = 20_000_000_000n;
// TradeRolesConfig: setAllowance(key, cap, cap, cap, period, 0)
const fresh: RolesAllowance = { refill: CAP, maxRefill: CAP, period: 30n * DAY, balance: CAP, timestamp: T0 };

describe("allowance of the real Zodiac Roles (v2.1.1 AllowanceTracker)", () => {
  it("is the stored balance inside the period", () => {
    const spent = { ...fresh, balance: CAP - 7n };
    expect(accruedAllowance(spent, T0)).toBe(CAP - 7n);
    expect(accruedAllowance(spent, T0 + 30n * DAY - 1n)).toBe(CAP - 7n);
  });

  it("refills once per whole period elapsed, up to maxRefill", () => {
    const low = { ...fresh, refill: 5n, balance: 1n };
    expect(accruedAllowance(low, T0 + 30n * DAY)).toBe(6n);
    expect(accruedAllowance(low, T0 + 90n * DAY + 1n)).toBe(16n);
    expect(accruedAllowance({ ...fresh, balance: 0n }, T0 + 300n * DAY)).toBe(CAP);
  });

  it("keeps a balance already at or over the cap, and period 0 never refills", () => {
    expect(accruedAllowance({ ...fresh, balance: CAP + 1n }, T0 + 60n * DAY)).toBe(CAP + 1n);
    expect(accruedAllowance({ ...fresh, period: 0n, balance: 3n }, T0 + 300n * DAY)).toBe(3n);
  });

  it("reads allowances(key) of the Roles instance, with the allowance key, at the chain's time", async () => {
    const roles: Hex = "0x00000000000000000000000000000000000000a0";
    const key = keccak256(toBytes("keel.trade.allowance.agent"));
    const asked: Hex[] = [];
    const chain = {
      now: async () => T0 + 31n * DAY,
      call: async ({ to, data }: { to: Hex; data: Hex }) => {
        expect(to).toBe(roles);
        const { args } = decodeFunctionData({ abi: ZODIAC_ROLES_ABI, data });
        asked.push(args[0]);
        return encodeFunctionResult({ abi: ZODIAC_ROLES_ABI, functionName: "allowances", result: [CAP, CAP, 30n * DAY, 1_000n, T0] });
      },
    } as unknown as AgentChain;
    expect(await zodiacRolesAllowance(chain, roles, key)()).toBe(CAP);
    expect(asked).toEqual([key]);
  });
});
