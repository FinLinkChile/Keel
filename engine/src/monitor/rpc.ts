// The monitor's chain over JSON-RPC: latest block, logs of the watched contracts and the
// attestation an order carries. Read only; the pause goes through the agent's rpcChain.
import type { Hex } from "@keel/schemas";
import { createPublicClient, decodeFunctionResult, encodeFunctionData, http } from "viem";
import { ESCROW_ABI } from "../agent/escrow";
import type { MonitorChain } from "./monitor";

export function rpcMonitorChain(rpcUrl: string): MonitorChain {
  const client = createPublicClient({ transport: http(rpcUrl) });
  return {
    latestBlock: () => client.getBlockNumber(),
    async logs(addresses, fromBlock, toBlock) {
      const logs = await client.getLogs({ address: [...addresses], fromBlock, toBlock });
      return logs.map((l) => ({
        address: l.address,
        topics: l.topics as Hex[],
        data: l.data,
        blockNumber: l.blockNumber,
        transactionHash: l.transactionHash,
        logIndex: l.logIndex,
      }));
    },
    async attestationHash(escrow, orderId) {
      const data = encodeFunctionData({ abi: ESCROW_ABI, functionName: "orderOf", args: [orderId] });
      const { data: out } = await client.call({ to: escrow, data });
      return decodeFunctionResult({ abi: ESCROW_ABI, functionName: "orderOf", data: out ?? "0x" }).attestationHash;
    },
  };
}
