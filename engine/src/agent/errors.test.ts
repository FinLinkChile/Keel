import { ESCROW_ERRORS, GATE_ERRORS, type Hex } from "@keel/schemas";
import { type Abi, type AbiFunction, encodeErrorResult, toFunctionSelector } from "viem";
import { beforeAll, describe, expect, it } from "vitest";
import { compile } from "../testing/chain";
import { REVERT_ABI, revertName, ROLES_ERRORS_ABI, TOKEN_ERRORS_ABI } from "./errors";
import { FUNDING_GATE_ABI } from "./gate";

// Errors share the selector rule of functions: the first 4 bytes of keccak256 of the signature
const selectors = (abi: Abi) =>
  new Set(abi.filter((x) => x.type === "error").map((x) => toFunctionSelector({ ...(x as unknown as AbiFunction), type: "function" })));
const errorNames = (abi: Abi) => abi.filter((x) => x.type === "error").map((x) => (x as { name: string }).name);

describe("revert names of the agent's holds", () => {
  let artifacts: ReturnType<typeof compile>;

  beforeAll(() => {
    artifacts = compile(["src/FundingGate.sol", "test/mocks/Mocks.sol", "test/mocks/TradeMocks.sol"]);
  }, 120_000);

  it("the agent decodes exactly the errors schemas lists for FundingGate, with their signatures", () => {
    expect(errorNames(FUNDING_GATE_ABI).sort()).toEqual([...GATE_ERRORS].sort());
    expect(selectors(FUNDING_GATE_ABI)).toEqual(selectors(artifacts.FundingGate!.abi));
  });

  it("the Roles and token errors match the contracts that raise them", () => {
    const roles = selectors(artifacts.MockTradeRoles!.abi);
    for (const s of selectors(ROLES_ERRORS_ABI)) expect(roles.has(s), s).toBe(true);
    const token = selectors([...artifacts.MockUSDC!.abi, ...artifacts.TradeEscrow!.abi]);
    for (const s of selectors(TOKEN_ERRORS_ABI)) expect(token.has(s), s).toBe(true);
  });

  it("names every escrow, gate, Roles and token error, arguments included", () => {
    const names = new Set(errorNames(REVERT_ABI));
    for (const name of [...ESCROW_ERRORS, ...GATE_ERRORS]) expect(names.has(name), name).toBe(true);
    for (const name of ["DeadlinePassed", "NotParty", "AmountMismatch", "UnknownSupplier", "BadPolicySignature", "NoMembership", "ModuleTransactionFailed"]) {
      expect(revertName(encodeErrorResult({ abi: REVERT_ABI, errorName: name }))).toBe(name);
    }
    const violation = encodeErrorResult({ abi: ROLES_ERRORS_ABI, errorName: "ConditionViolation", args: [11, `0x${"00".repeat(32)}`] });
    expect(revertName(violation)).toBe("ConditionViolation");
    expect(revertName(encodeErrorResult({ abi: FUNDING_GATE_ABI, errorName: "StringTooLong", args: ["Keel"] }))).toBe("StringTooLong");
  });

  it("unknown data stays as hex, an empty revert is REVERTED", () => {
    const unknown: Hex = "0xdeadbeef";
    expect(revertName(unknown)).toBe(unknown);
    expect(revertName("0x")).toBe("REVERTED");
    expect(revertName(undefined)).toBe("REVERTED");
  });
});
