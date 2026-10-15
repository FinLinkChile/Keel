import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Hex } from "@keel/schemas";
import { encodeErrorResult, keccak256, toBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { afterEach, describe, expect, it } from "vitest";
import { CallReverted } from "./agent";
import { ESCROW_ABI } from "./escrow";
import { rpcChain } from "./rpc";

const relayer = privateKeyToAccount(keccak256(toBytes("test relayer")));
const call = { to: "0x00000000000000000000000000000000000000e5" as Hex, data: "0x" as Hex };

// A node that answers every eth_call with the given JSON-RPC error
let server: Server;
async function nodeAnswering(error: { code: number; message: string; data?: Hex }): Promise<string> {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const { id } = JSON.parse(body);
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ jsonrpc: "2.0", id, error }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

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
});
