import type { Hex } from "@keel/schemas";
import { deploymentSettings, ESCROW_ABI, type MonitorChain, type MonitorLog } from "@keel/engine";
import { encodeEventTopics, encodeAbiParameters, getAbiItem, keccak256, toBytes } from "viem";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setDdb } from "../db";
import { stateId } from "../tables";
import type { RuntimeDeployment } from "../agent/deployment";
import { FakeDynamo, TEST_ENV } from "../testing/fakes";
import { MAX_RANGE, runIndexerPass } from "./indexer";

const word = (label: string): Hex => keccak256(toBytes(label));
const ESCROW = word("escrow").slice(0, 42).toLowerCase() as Hex;
const OTHER = word("other contract").slice(0, 42).toLowerCase() as Hex;
const ORDER = word("order 1");
const UNKNOWN = word("order nobody stored");
const DEPLOY = 1_000n;

// An escrow log as a node returns it: indexed arguments in topics, the rest ABI-encoded in data
function logOf(eventName: string, args: Record<string, unknown>, blockNumber: bigint, logIndex = 0, address = ESCROW): MonitorLog {
  const item = getAbiItem({ abi: ESCROW_ABI, name: eventName } as never) as unknown as { inputs: { name: string; type: string; indexed?: boolean }[] };
  const plain = item.inputs.filter((i) => !i.indexed);
  return {
    address,
    topics: encodeEventTopics({ abi: ESCROW_ABI, eventName, args } as never) as Hex[],
    data: encodeAbiParameters(plain, plain.map((i) => args[i.name]) as never),
    blockNumber,
    transactionHash: word(`tx ${blockNumber} ${logIndex}`),
    logIndex,
  };
}

const opened = (orderId: Hex, block: bigint, i = 0) =>
  logOf("OrderOpened", { orderId, orderHash: word("hash"), importer: OTHER, exporter: OTHER, payoutAddress: OTHER, totalAmount: 10n }, block, i);
const funded = (orderId: Hex, block: bigint, i = 0) => logOf("OrderFunded", { orderId, amount: 10n }, block, i);
const advance = (orderId: Hex, block: bigint, i = 0) => logOf("AdvanceReleased", { orderId, to: OTHER, amount: 5n }, block, i);
const shipped = (orderId: Hex, block: bigint, i = 0) =>
  logOf("ShipmentAccepted", { orderId, attestationHash: word("att"), blKey: word("bl"), onBoardDate: 1n }, block, i);

describe("escrow indexer", () => {
  let db: FakeDynamo;
  let logs: MonitorLog[];
  let latest: bigint;
  let requested: [bigint, bigint][];

  const chain: MonitorChain = {
    latestBlock: async () => latest,
    logs: async (addresses, from, to) => {
      requested.push([from, to]);
      return logs.filter((l) => l.blockNumber >= from && l.blockNumber <= to && addresses.some((a) => a.toLowerCase() === l.address));
    },
    attestationHash: async () => word("unused"),
  };
  const deps = {
    env: TEST_ENV,
    context: async (): Promise<RuntimeDeployment> => ({
      chainId: 1,
      settings: deploymentSettings(null, {}, 1, "test"),
      escrow: ESCROW,
      safe: OTHER,
      deployBlock: DEPLOY,
    }),
    chain: async () => chain,
    log: () => {},
  };
  const mirror = () => db.get("orders", ORDER)?.chain;
  const cursor = () => db.get("agent_state", stateId.cursor("indexer"))?.block;

  beforeEach(() => {
    db = new FakeDynamo();
    setDdb(db as never);
    logs = [];
    requested = [];
    latest = DEPLOY + 10n;
    db.put("orders", { orderId: ORDER, safe: OTHER, exporter: OTHER, order: {}, terms: {}, uploaders: [], createdAt: 1 });
  });
  afterEach(() => setDdb(undefined));

  it("starts at the deploy block, mirrors each state and saves the next block to read", async () => {
    logs = [opened(ORDER, DEPLOY + 1n), funded(ORDER, DEPLOY + 3n, 0), advance(ORDER, DEPLOY + 3n, 1), opened(UNKNOWN, DEPLOY + 4n)];
    const result = await runIndexerPass(deps);
    expect(result).toMatchObject({ status: "ran", from: DEPLOY, next: DEPLOY + 11n, applied: 2 });
    expect(requested).toEqual([[DEPLOY, DEPLOY + 10n]]);
    expect(mirror()).toEqual({ state: "ADVANCE_PAID", updatedBlock: String(DEPLOY + 3n), lastTx: word(`tx ${DEPLOY + 3n} 0`), lastEvent: "OrderFunded" });
    expect(cursor()).toBe(String(DEPLOY + 11n));
    // Unknown orders are ignored, never created
    expect(db.get("orders", UNKNOWN)).toBeUndefined();

    // The next run continues from the cursor
    logs.push(shipped(ORDER, DEPLOY + 12n));
    latest = DEPLOY + 12n;
    await runIndexerPass(deps);
    expect(requested.at(-1)).toEqual([DEPLOY + 11n, DEPLOY + 12n]);
    expect(mirror()).toMatchObject({ state: "SHIPPED", updatedBlock: String(DEPLOY + 12n) });
  });

  it("reads in ranges of at most MAX_RANGE blocks and saves the cursor after each", async () => {
    latest = DEPLOY + 2n * MAX_RANGE + 5n;
    logs = [opened(ORDER, DEPLOY + MAX_RANGE + 1n)];
    await runIndexerPass(deps);
    expect(requested).toEqual([
      [DEPLOY, DEPLOY + MAX_RANGE - 1n],
      [DEPLOY + MAX_RANGE, DEPLOY + 2n * MAX_RANGE - 1n],
      [DEPLOY + 2n * MAX_RANGE, latest],
    ]);
    expect(cursor()).toBe(String(latest + 1n));
    expect(mirror()).toMatchObject({ state: "OPEN" });
  });

  it("never moves an order back: a replayed range and an earlier event of the same block are stale", async () => {
    logs = [opened(ORDER, DEPLOY + 1n), shipped(ORDER, DEPLOY + 5n)];
    // An earlier mirror run already saw a later state
    db.put("orders", { ...db.get("orders", ORDER), chain: { state: "SHIPPED", updatedBlock: String(DEPLOY + 5n) } });
    const result = await runIndexerPass(deps);
    expect(result).toMatchObject({ applied: 0 });
    expect(mirror()).toEqual({ state: "SHIPPED", updatedBlock: String(DEPLOY + 5n) });

    // Same block, lower state: still stale
    db.put("orders", { ...db.get("orders", ORDER), chain: { state: "ADVANCE_PAID", updatedBlock: String(DEPLOY + 20n) } });
    logs = [opened(ORDER, DEPLOY + 20n)];
    db.put("agent_state", { id: stateId.cursor("indexer"), block: String(DEPLOY + 20n) });
    latest = DEPLOY + 20n;
    await runIndexerPass(deps);
    expect(mirror()).toMatchObject({ state: "ADVANCE_PAID" });
  });

  it("logs of another contract are not escrow events", async () => {
    logs = [logOf("OrderFunded", { orderId: ORDER, amount: 10n }, DEPLOY + 1n, 0, OTHER)];
    await runIndexerPass(deps);
    expect(mirror()).toBeUndefined();
  });
});
