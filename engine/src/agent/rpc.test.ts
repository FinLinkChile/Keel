import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Hex } from "@keel/schemas";
import { encodeErrorResult, keccak256, toBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { afterEach, describe, expect, it } from "vitest";
import { CallReverted } from "./agent";
import { ESCROW_ABI, orderFundedTopics } from "./escrow";
import { rpcChain } from "./rpc";

const relayer = privateKeyToAccount(keccak256(toBytes("test relayer")));
const call = { to: "0x00000000000000000000000000000000000000e5" as Hex, data: "0x" as Hex };

// A node that answers each request with what `answer` returns for its method and params
let server: Server;
type Answer = { result: unknown } | { error: { code: number; message: string; data?: Hex } };
async function node(answer: (method: string, params: unknown[]) => Answer): Promise<string> {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const { id, method, params } = JSON.parse(body);
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ jsonrpc: "2.0", id, ...answer(method, params) }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

// A node that answers every request with the given JSON-RPC error
const nodeAnswering = (error: { code: number; message: string; data?: Hex }) => node(() => ({ error }));

afterEach(() => new Promise<void>((r) => server.close(() => r())));

describe("agent chain over JSON-RPC", () => {
  it("a reverted eth_call becomes a hold with the escrow error name", async () => {
    const data = encodeErrorResult({ abi: ESCROW_ABI, errorName: "BadCarrierSignature" });
    const chain = rpcChain(await nodeAnswering({ code: 3, message: "execution reverted", data }), relayer);
    await expect(chain.call(call)).rejects.toEqual(new CallReverted("BadCarrierSignature"));
  });

  it("a node failure is not mistaken for a revert", async () => {
    const chain = rpcChain(await nodeAnswering({ code: -32000, message: "header not found" }), relayer);
    const error = await chain.call(call).catch((e) => e);
    expect(error).not.toBeInstanceOf(CallReverted);
  });

  it("the funding time is the time of the block with the OrderFunded log of the order", async () => {
    const escrow = call.to;
    const orderId = keccak256(toBytes("order"));
    const blockHash = keccak256(toBytes("block"));
    const asked: unknown[] = [];
    const url = await node((method, params) => {
      if (method === "eth_getLogs") {
        asked.push(params[0]);
        const log = { address: escrow, topics: orderFundedTopics(orderId), data: `0x${"00".repeat(32)}`, blockHash, blockNumber: "0x2a", transactionHash: blockHash, transactionIndex: "0x0", logIndex: "0x0", removed: false };
        return { result: [log] };
      }
      if (method === "eth_getBlockByHash") return { result: { hash: blockHash, number: "0x2a", timestamp: "0x690a0000", transactions: [] } };
      return { error: { code: -32601, message: "method not found" } };
    });
    expect(await rpcChain(url, relayer, { fromBlock: 7n }).fundedAt(escrow, orderId)).toBe(0x690a0000n);
    expect(asked).toEqual([{ address: escrow, topics: orderFundedTopics(orderId), fromBlock: "0x7", toBlock: "latest" }]);
  });

  it("with logRange, searches backwards in ranges no larger than the provider allows, and stops at the cap", async () => {
    const escrow = call.to;
    const orderId = keccak256(toBytes("order"));
    const blockHash = keccak256(toBytes("block"));
    const ranges: [number, number][] = [];
    const url = await node((method, params) => {
      if (method === "eth_blockNumber") return { result: "0x3e8" }; // 1000
      if (method === "eth_getLogs") {
        const { fromBlock, toBlock } = params[0] as { fromBlock: string; toBlock: string };
        const [from, to] = [Number(fromBlock), Number(toBlock)];
        ranges.push([from, to]);
        // A provider that refuses wide ranges, like the public Base Sepolia endpoint
        if (to - from + 1 > 200) return { error: { code: -32614, message: "eth_getLogs is limited to a 200 range" } };
        const funded = 650;
        if (from > funded || to < funded) return { result: [] };
        const log = { address: escrow, topics: orderFundedTopics(orderId), data: `0x${"00".repeat(32)}`, blockHash, blockNumber: "0x28a", transactionHash: blockHash, transactionIndex: "0x0", logIndex: "0x0", removed: false };
        return { result: [log] };
      }
      if (method === "eth_getBlockByHash") return { result: { hash: blockHash, number: "0x28a", timestamp: "0x690a0000", transactions: [] } };
      return { error: { code: -32601, message: "method not found" } };
    });
    expect(await rpcChain(url, relayer, { fromBlock: 100n, logRange: 200n }).fundedAt(escrow, orderId)).toBe(0x690a0000n);
    expect(ranges).toEqual([
      [801, 1000],
      [601, 800],
    ]);
    ranges.length = 0;
    // Funded before the searched window: not found, and never more than maxLogRanges requests
    expect(await rpcChain(url, relayer, { fromBlock: 100n, logRange: 100n, maxLogRanges: 2 }).fundedAt(escrow, orderId)).toBeUndefined();
    expect(ranges).toEqual([
      [901, 1000],
      [801, 900],
    ]);
  });

  it("gives up waiting for a receipt after receiptTimeoutMs", async () => {
    const hash = keccak256(toBytes("tx"));
    const url = await node((method) => {
      switch (method) {
        case "eth_chainId":
          return { result: "0x1" };
        case "eth_getTransactionCount":
          return { result: "0x0" };
        case "eth_estimateGas":
          return { result: "0x5208" };
        case "eth_gasPrice":
        case "eth_maxPriorityFeePerGas":
          return { result: "0x1" };
        case "eth_getBlockByNumber":
          return { result: { number: "0x1", hash, timestamp: "0x1", baseFeePerGas: "0x1", transactions: [] } };
        case "eth_sendRawTransaction":
          return { result: hash };
        case "eth_getTransactionReceipt":
        case "eth_getTransactionByHash":
          return { result: null };
        default:
          return { error: { code: -32601, message: "method not found" } };
      }
    });
    const started = Date.now();
    const error = await rpcChain(url, relayer, { receiptTimeoutMs: 300 }).send(call).catch((e) => e);
    expect(error.name).toBe("WaitForTransactionReceiptTimeoutError");
    expect(Date.now() - started).toBeLessThan(5000);
  }, 15_000);

  it("an order never funded has no funding time", async () => {
    const url = await node((method) => (method === "eth_getLogs" ? { result: [] } : { error: { code: -32601, message: "method not found" } }));
    expect(await rpcChain(url, relayer).fundedAt(call.to, keccak256(toBytes("order")))).toBeUndefined();
  });
});
