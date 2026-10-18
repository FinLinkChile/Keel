import type { Hex } from "@keel/schemas";
import { deploymentSettings, MONITOR_EVENTS_ABI, type MonitorChain, type MonitorLog } from "@keel/engine";
import { encodeAbiParameters, encodeEventTopics, keccak256, toBytes } from "viem";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setDdb } from "../db";
import { acquire } from "../lock";
import { stateId } from "../tables";
import type { RuntimeDeployment } from "../agent/deployment";
import { s3EvidenceExists } from "../agent/evidence";
import { FakeDynamo, FakeS3, TEST_ENV } from "../testing/fakes";
import { type MonitorPassDeps, runMonitorPass } from "./monitor";

const word = (label: string): Hex => keccak256(toBytes(label));
const GATE = word("gate").slice(0, 42).toLowerCase() as Hex;
const ESCROW = word("escrow").slice(0, 42).toLowerCase() as Hex;
const SAFE = word("safe").slice(0, 42).toLowerCase() as Hex;
const DEPLOY = 500n;
const ISSUED = word("pdr the engine issued");
const FORGED = word("pdr signed outside the engine");

const fundingExecuted = (pdrHash: Hex, block: bigint): MonitorLog => ({
  address: GATE,
  topics: encodeEventTopics({ abi: MONITOR_EVENTS_ABI, eventName: "FundingExecuted", args: { intentHash: word("intent"), orderId: word("order") } }) as Hex[],
  data: encodeAbiParameters([{ type: "bytes32" }, { type: "uint8" }], [pdrHash, 1]),
  blockNumber: block,
  transactionHash: word(`tx ${block}`),
  logIndex: 0,
});

describe("monitor Lambda pass", () => {
  let db: FakeDynamo;
  let s3: FakeS3;
  let logs: MonitorLog[];
  let enqueued: { id: string }[];
  let pauses: number;

  const chain: MonitorChain = {
    latestBlock: async () => DEPLOY + 10n,
    logs: async (_a, from, to) => logs.filter((l) => l.blockNumber >= from && l.blockNumber <= to),
    attestationHash: async () => word("att"),
  };
  const deps = (): MonitorPassDeps => ({
    env: TEST_ENV,
    context: async (): Promise<RuntimeDeployment> => ({
      chainId: 1,
      settings: deploymentSettings(null, {}, 1, "test"),
      escrow: ESCROW,
      safe: SAFE,
      fundingGate: GATE,
      deployBlock: DEPLOY,
    }),
    chain: async () => chain,
    pauser: async () => ({
      address: word("guardian").slice(0, 42) as Hex,
      pause: async () => {
        pauses++;
        return { hash: word("pause tx"), status: "success" };
      },
    }),
    isIssued: s3EvidenceExists("evidence", s3),
    account: async () => "acme-imports",
    acquire: (name, hold) => acquire(name, hold, TEST_ENV),
    enqueue: async (notices) => (enqueued.push(...notices), notices.length),
    log: () => {},
    now: () => 1,
  });

  beforeEach(() => {
    db = new FakeDynamo();
    s3 = new FakeS3();
    setDdb(db as never);
    logs = [];
    enqueued = [];
    pauses = 0;
    s3.objects.set(`evidence/pdr/${ISSUED}.json`, "{}");
  });
  afterEach(() => setDdb(undefined));

  it("starts at the deploy block, reads the evidence on S3 and persists the cursor and the pause", async () => {
    logs = [fundingExecuted(ISSUED, DEPLOY + 1n), fundingExecuted(FORGED, DEPLOY + 2n)];
    const result = await runMonitorPass(deps());
    expect(result).toMatchObject({ status: "ran", next: DEPLOY + 11n });
    expect(result.status === "ran" && result.events).toMatchObject([{ reason: "UNKNOWN_FUNDING_PDR", pdrHash: FORGED, action: "paused" }]);
    expect(pauses).toBe(1);
    expect(enqueued.map((n) => n.id)).toEqual([`${word("tx 502")}:unauthorized`, `paused:${word("pause tx")}`]);
    expect(db.get("agent_state", stateId.cursor("monitor"))).toEqual({ id: stateId.cursor("monitor"), block: String(DEPLOY + 11n) });
    expect(db.get("agent_state", stateId.pause())).toMatchObject({ pausedHere: true });

    // The next run resumes there and, already paused, does not pause again
    logs.push(fundingExecuted(word("another forged pdr"), DEPLOY + 10n));
    db.put("agent_state", { id: stateId.cursor("monitor"), block: String(DEPLOY + 10n) });
    const again = await runMonitorPass(deps());
    expect(again.status === "ran" && again.events).toMatchObject([{ reason: "UNKNOWN_FUNDING_PDR", action: "paused" }]);
    expect(pauses).toBe(1);
  });

  it("an S3 failure fails the run before the cursor moves, instead of reporting an incident", async () => {
    logs = [fundingExecuted(ISSUED, DEPLOY + 1n)];
    const failing = { ...deps(), isIssued: async () => Promise.reject(new Error("S3 unavailable")) };
    await expect(runMonitorPass(failing)).rejects.toThrow("S3 unavailable");
    expect(pauses).toBe(0);
    expect(db.get("agent_state", stateId.cursor("monitor"))).toBeUndefined();
  });
});
