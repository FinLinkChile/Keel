// The agent's chain over JSON-RPC: block time, eth_call from the relayer, transactions it signs
// and the funding time of an order (block of its OrderFunded log).
import type { Hex } from "@keel/schemas";
import { BaseError, createPublicClient, createWalletClient, ExecutionRevertedError, http, type LocalAccount, RawContractError } from "viem";
import { type AgentChain, CallReverted } from "./agent";
import { revertName } from "./errors";
import { ORDER_FUNDED_EVENT } from "./escrow";

// The revert data of a failed eth_call, or null when the failure was not a revert (network, node).
// Nodes put the data on the JSON-RPC error, which viem keeps somewhere in the cause chain.
function revertData(e: unknown): { data?: Hex } | null {
  if (!(e instanceof BaseError)) return null;
  const isRevert = e.walk((x) => x instanceof ExecutionRevertedError || x instanceof RawContractError);
  if (!isRevert) return null;
  const withData = e.walk((x) => {
    const data = (x as { data?: unknown }).data;
    return typeof data === "string" && data.startsWith("0x");
  }) as { data: Hex } | null;
  return { data: withData?.data };
}

export interface RpcChainOptions {
  // First block searched for escrow logs, such as the escrow deployment block. Default: earliest.
  fromBlock?: bigint;
}

export function rpcChain(rpcUrl: string, relayer: LocalAccount, options: RpcChainOptions = {}): AgentChain & { chainId(): Promise<number> } {
  const transport = http(rpcUrl);
  const client = createPublicClient({ transport });
  const wallet = createWalletClient({ account: relayer, transport });
  return {
    chainId: () => client.getChainId(),
    now: async () => (await client.getBlock()).timestamp,
    async call(c) {
      try {
        return (await client.call({ account: relayer.address, to: c.to, data: c.data })).data ?? "0x";
      } catch (e) {
        const revert = revertData(e);
        if (revert) throw new CallReverted(revertName(revert.data));
        throw e;
      }
    },
    async fundedAt(escrow, orderId) {
      const [log] = await client.getLogs({ address: escrow, event: ORDER_FUNDED_EVENT, args: { orderId }, fromBlock: options.fromBlock ?? "earliest", toBlock: "latest" });
      if (!log?.blockHash) return undefined;
      return (await client.getBlock({ blockHash: log.blockHash })).timestamp;
    },
    async send(c) {
      const hash = await wallet.sendTransaction({ to: c.to, data: c.data, chain: null });
      const { status } = await client.waitForTransactionReceipt({ hash });
      return { hash, status };
    },
  };
}
