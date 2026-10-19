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
  // Most milliseconds to wait for a receipt. Default: viem's (180 s), which suits the CLI; a Lambda
  // with a shorter timeout passes less, and the next pass finds the order where the chain left it.
  receiptTimeoutMs?: number;
  // Most blocks per eth_getLogs request. Many RPC providers cap the range (the public Base Sepolia
  // endpoint answers "limited to a 200 range"). Unset, the funding log is searched in one request
  // from fromBlock, as before; set, it is searched backwards from the latest block in ranges of
  // this size, at most maxLogRanges of them.
  logRange?: bigint;
  // Most ranges searched for one order. An order funded further back is not found: fundedAt
  // answers undefined and the escrow's own check decides, as when the log is missing.
  maxLogRanges?: number;
}

export const DEFAULT_MAX_LOG_RANGES = 50;

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
      const find = (fromBlock: bigint | "earliest", toBlock: bigint | "latest") =>
        client.getLogs({ address: escrow, event: ORDER_FUNDED_EVENT, args: { orderId }, fromBlock, toBlock });
      let log: Awaited<ReturnType<typeof find>>[number] | undefined;
      if (options.logRange === undefined) {
        [log] = await find(options.fromBlock ?? "earliest", "latest");
      } else {
        // The funding is recent for the orders an agent still steps, so the newest ranges go first
        const floor = options.fromBlock ?? 0n;
        let to = await client.getBlockNumber();
        for (let i = 0; i < (options.maxLogRanges ?? DEFAULT_MAX_LOG_RANGES) && to >= floor && !log; i++) {
          const from = to - options.logRange + 1n > floor ? to - options.logRange + 1n : floor;
          [log] = await find(from, to);
          to = from - 1n;
        }
      }
      if (!log?.blockHash) return undefined;
      return (await client.getBlock({ blockHash: log.blockHash })).timestamp;
    },
    async send(c) {
      const hash = await wallet.sendTransaction({ to: c.to, data: c.data, chain: null });
      const { status } = await client.waitForTransactionReceipt({ hash, ...(options.receiptTimeoutMs !== undefined && { timeout: options.receiptTimeoutMs }) });
      return { hash, status };
    },
  };
}
