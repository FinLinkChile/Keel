import { describe, expect, it } from "vitest";
import { explorerAddressUrl, explorerTxUrl } from "./explorer";

const hash = `0x${"ab".repeat(32)}`;
const address = `0x${"12".repeat(20)}`;

describe("explorer links", () => {
  it("links a transaction on Base Sepolia", () => {
    expect(explorerTxUrl(84532, hash)).toBe(`https://sepolia.basescan.org/tx/${hash}`);
  });
  it("links a contract on Base Sepolia and on Base mainnet", () => {
    expect(explorerAddressUrl(84532, address)).toBe(`https://sepolia.basescan.org/address/${address}`);
    expect(explorerAddressUrl(8453, address)).toBe(`https://basescan.org/address/${address}`);
  });
  it("returns undefined for an unknown chain", () => {
    expect(explorerTxUrl(31337, hash)).toBeUndefined();
    expect(explorerAddressUrl(1, address)).toBeUndefined();
  });
});
