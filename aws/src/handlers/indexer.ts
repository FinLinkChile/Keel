// Indexer of TradeEscrow (EventBridge, every minute). Mirrors each order's state from the escrow
// events into OrderItem.chain, so the API and the fan-out read it without an RPC call. It is a
// mirror, never a source of truth: the agent re-reads every order from the chain before acting.
//
// Each run reads the escrow logs from agent_state cursor#indexer (the deploy block the first time)
// in ranges of at most MAX_RANGE blocks, and saves the cursor after each range. A write only
// advances: the escrow's state machine only moves forward (RANK), so an event is applied when it
// comes from the same or a later block than the mirror and leads to a later state. A replayed
// range (a run that died before saving its cursor) or two runs racing can never move an order back.
// Events of orders the orders table does not know are ignored. Reorgs are not handled: on the
// closed network and on Base Sepolia the minute between runs is far beyond the usual reorg depth.
import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { EscrowEvent, EscrowState, Hex } from "@keel/schemas";
import { ESCROW_ABI, EVENT_STATE, type MonitorChain, type MonitorLog, rpcMonitorChain } from "@keel/engine";
import { decodeEventLog } from "viem";
import { type Env, table } from "../config";
import { ddb, isConditionFailed } from "../db";
import { acquire } from "../lock";
import type { OrderItem } from "../tables";
import { logLine } from "../agent/clients";
import { type RuntimeDeployment, rpcUrl, runtimeDeployment } from "../agent/deployment";
import { readCursor, writeCursor } from "../agent/state";

export const MAX_RANGE = 2000n;
// Ranges per run, so a run that starts far behind still ends well inside the function timeout
export const MAX_RANGES_PER_RUN = 20;
const LOCK_SECONDS = 55;

// Progress of an order through the escrow (contracts/src/TradeEscrow.sol): every transition goes
// to a strictly higher rank, and the four final states share the last one
export const RANK: Record<EscrowState, number> = {
  NONE: 0,
  OPEN: 1,
  ADVANCE_PAID: 2,
  SHIPPED: 3,
  DISPUTED: 4,
  SETTLED: 5,
  REFUNDED: 5,
  RESOLVED: 5,
  CANCELLED: 5,
};

export type ChainMirror = NonNullable<OrderItem["chain"]>;

export function advances(prev: ChainMirror | undefined, state: EscrowState, block: bigint): boolean {
  if (!prev) return true;
  return block >= BigInt(prev.updatedBlock) && RANK[state] > (RANK[prev.state as EscrowState] ?? 0);
}

export type ApplyOutcome = "applied" | "stale" | "unknown";

// Get, compare in code (updatedBlock is a decimal string, which DynamoDB cannot compare as a
// number), then a write conditioned on the mirror being exactly what was read. A lost race reads again.
export async function applyEvent(orderId: Hex, state: EscrowState, log: Pick<MonitorLog, "blockNumber" | "transactionHash">, eventName: string, env: Env = process.env): Promise<ApplyOutcome> {
  const TableName = table("orders", env);
  const Key = { orderId: orderId.toLowerCase() };
  for (let attempt = 0; attempt < 3; attempt++) {
    const { Item } = await ddb().send(new GetCommand({ TableName, Key }));
    if (!Item) return "unknown";
    const prev = (Item as OrderItem).chain;
    if (!advances(prev, state, log.blockNumber)) return "stale";
    const chain: ChainMirror = { state, updatedBlock: log.blockNumber.toString(), lastTx: log.transactionHash, lastEvent: eventName };
    try {
      await ddb().send(
        new UpdateCommand({
          TableName,
          Key,
          UpdateExpression: "SET #chain = :chain",
          ConditionExpression: prev ? "#chain.#block = :block AND #chain.#state = :state" : "attribute_exists(orderId) AND attribute_not_exists(#chain)",
          ExpressionAttributeNames: { "#chain": "chain", ...(prev && { "#block": "updatedBlock", "#state": "state" }) },
          ExpressionAttributeValues: { ":chain": chain, ...(prev && { ":block": prev.updatedBlock, ":state": prev.state }) },
        }),
      );
      return "applied";
    } catch (e) {
      if (!isConditionFailed(e)) throw e;
    }
  }
  throw new Error(`orders: the chain mirror of ${orderId} kept changing`);
}

export interface IndexerPassDeps {
  context(): Promise<RuntimeDeployment>;
  chain(ctx: RuntimeDeployment): Promise<MonitorChain>;
  log(line: Record<string, unknown>): void;
  env: Env;
}

export function defaultDeps(env: Env = process.env): IndexerPassDeps {
  return { env, context: () => runtimeDeployment(env), chain: async () => rpcMonitorChain(await rpcUrl(env)), log: logLine };
}

export type IndexerPassResult = { status: "ran"; from: bigint; next: bigint; applied: number } | { status: "skipped"; reason: "LOCKED" };

export async function runIndexerPass(deps: IndexerPassDeps): Promise<IndexerPassResult> {
  const ctx = await deps.context();
  const lock = await acquire("indexer", LOCK_SECONDS, deps.env);
  if (!lock) {
    deps.log({ indexer: "skipped", reason: "LOCKED" });
    return { status: "skipped", reason: "LOCKED" };
  }
  try {
    const chain = await deps.chain(ctx);
    const latest = await chain.latestBlock();
    const from = (await readCursor("indexer", deps.env)) ?? ctx.deployBlock;
    let next = from;
    let applied = 0;
    for (let ranges = 0; ranges < MAX_RANGES_PER_RUN && next <= latest; ranges++) {
      const to = next + MAX_RANGE - 1n < latest ? next + MAX_RANGE - 1n : latest;
      const logs = await chain.logs([ctx.escrow], next, to);
      logs.sort((a, b) => (a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1));
      for (const log of logs) {
        if (log.address.toLowerCase() !== ctx.escrow.toLowerCase()) continue;
        let decoded: { eventName: string; args: { orderId?: Hex } };
        try {
          decoded = decodeEventLog({ abi: ESCROW_ABI, topics: log.topics as [Hex, ...Hex[]], data: log.data }) as never;
        } catch {
          continue;
        }
        const state = EVENT_STATE[decoded.eventName as EscrowEvent];
        const orderId = decoded.args.orderId;
        if (!state || !orderId) continue;
        const outcome = await applyEvent(orderId, state, log, decoded.eventName, deps.env);
        if (outcome === "applied") applied++;
        if (outcome !== "unknown") deps.log({ indexer: outcome, orderId, state, event: decoded.eventName, block: log.blockNumber, tx: log.transactionHash });
      }
      next = to + 1n;
      await writeCursor("indexer", next, deps.env);
    }
    deps.log({ indexer: "pass", from, next, latest, applied });
    return { status: "ran", from, next, applied };
  } finally {
    await lock.release();
  }
}

export const handler = async (): Promise<void> => {
  await runIndexerPass(defaultDeps());
};
