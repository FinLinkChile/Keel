import { ESCROW_ERRORS, ESCROW_EVENTS } from "@keel/schemas";
import { type AbiEvent, type AbiFunction, toEventSelector, toFunctionSelector } from "viem";
import { beforeAll, describe, expect, it } from "vitest";
import { compile } from "../testing/chain";
import { ESCROW_ABI } from "./escrow";

// Inherited from OpenZeppelin (EIP712, ReentrancyGuard, SafeERC20, ShortStrings): not part of the Keel interface
const INHERITED = ["EIP712DomainChanged", "InvalidShortString", "ReentrancyGuardReentrantCall", "SafeERC20FailedOperation", "StringTooLong"];

describe("TradeEscrow ABI", () => {
  let abi: ReturnType<typeof compile>[string]["abi"];

  beforeAll(() => {
    abi = compile(["src/TradeEscrow.sol"]).TradeEscrow!.abi;
  }, 120_000);

  const names = (type: string) =>
    abi
      .filter((x) => x.type === type)
      .map((x) => (x as { name: string }).name)
      .filter((n) => !INHERITED.includes(n))
      .sort();

  it("schemas lists exactly the events and errors the escrow declares", () => {
    expect(names("event")).toEqual([...ESCROW_EVENTS].sort());
    expect(names("error")).toEqual([...ESCROW_ERRORS].sort());
  });

  it("the agent decodes exactly the errors schemas lists for the escrow", () => {
    expect(ESCROW_ABI.filter((x) => x.type === "error").map((x) => x.name).sort()).toEqual([...ESCROW_ERRORS].sort());
  });

  it("every function, event and error the agent encodes exists in the escrow", () => {
    // Errors share the selector rule of functions: the first 4 bytes of keccak256 of the signature
    const selector = (item: (typeof abi)[number]) =>
      item.type === "event" ? toEventSelector(item as AbiEvent) : toFunctionSelector({ ...(item as AbiFunction), type: "function" });
    const kinds = ["function", "event", "error"];
    const compiled = new Set(abi.filter((x) => kinds.includes(x.type)).map(selector));
    for (const item of ESCROW_ABI.filter((x) => kinds.includes(x.type))) {
      expect(compiled.has(selector(item)), (item as { name: string }).name).toBe(true);
    }
  });
});
