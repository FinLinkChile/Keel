// FundingGate (Keel Trade gate, Area 1) against what the engine and schemas assume.
// Reference for Area 2: the PDR calldataHash of a deposit is
// keccak256(abi.encode(approveData, fundData)), checked here against fundingCalldataOf.
import { type FundIntent, GATE_ERRORS, GATE_EVENTS, type Hex } from "@keel/schemas";
import { structHash } from "@keel/schemas/hash";
import { encodeAbiParameters, keccak256, toBytes } from "viem";
import { beforeAll, describe, expect, it } from "vitest";
import { compile, createChain } from "./testing/chain";

const word = (label: string): Hex => keccak256(toBytes(label));
const address = (n: number): Hex => `0x${n.toString(16).padStart(40, "0")}`;

const OWNER = address(0x0e);

describe("FundingGate interface (T1.6 Trade, T1.11)", () => {
  let artifacts: ReturnType<typeof compile>;

  beforeAll(() => {
    artifacts = compile(["src/FundingGate.sol", "test/mocks/Mocks.sol"]);
  }, 120_000);

  it("schemas lists exactly the events and errors FundingGate declares", () => {
    const names = (type: string) =>
      artifacts.FundingGate!.abi.filter((x) => x.type === type).map((x) => (x as { name: string }).name).sort();
    expect(names("event")).toEqual([...GATE_EVENTS].sort());
    expect(names("error")).toEqual([...GATE_ERRORS].sort());
  });

  it("the deposit calldata hash is keccak256(abi.encode(approveData, fundData))", async () => {
    const chain = await createChain(artifacts);
    const usdc = await chain.deploy("MockUSDC", [], OWNER);
    const escrow = await chain.deploy("TradeEscrow", [usdc, 60n], OWNER);
    const gate = await chain.deploy(
      "FundingGate",
      [address(0x5afe), address(0x7015), escrow, word("AGENT"), word("AGENT_COSIGNED"), address(0xa1), address(0xc0), word("p"), 120n],
      OWNER,
    );

    const intent: FundIntent = {
      orderId: word("order"),
      orderHash: word("order hash"),
      escrow,
      token: usdc,
      amount: 10_000_000_000n,
      deadline: 1_762_000_900n,
      nonce: 7n,
    };
    const [approveData, fundData, hash] = await chain.read<[Hex, Hex, Hex]>("FundingGate", gate, "fundingCalldataOf", [intent]);

    expect(approveData).toBe(chain.calldata("MockUSDC", "approve", [escrow, intent.amount]));
    expect(fundData).toBe(chain.calldata("TradeEscrow", "fund", [intent.orderId]));
    expect(hash).toBe(keccak256(encodeAbiParameters([{ type: "bytes" }, { type: "bytes" }], [approveData, fundData])));
    expect(await chain.read("FundingGate", gate, "intentHashOf", [intent])).toBe(structHash("FundIntent", intent));
  });
});
