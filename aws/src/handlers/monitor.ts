// The monitor of use outside the system (T2.8) as a Lambda (EventBridge, every minute). Each run
// reads the gate and the escrow from where the last one stopped (agent_state cursor#monitor; the
// deploy block the first time) with the engine's Monitor, and remembers whether it paused the gate
// (pause#monitor) so an incident pauses once, as in a long-running `keel monitor`.
// Whether the engine issued a PDR is read from the S3 evidence the agent writes. The pause key is
// optional: without it the monitor only alerts. It holds no authority to move funds.
import type { Hex } from "@keel/schemas";
import { Monitor, type MonitorChain, type MonitorEvent, type Pauser, pauserOn, rpcChain, rpcMonitorChain, toMonitorNotices } from "@keel/engine";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { ConfigError, type Env, required, table } from "../config";
import { ddb, lower } from "../db";
import { loadKeys } from "../keys";
import { acquire, type Lock } from "../lock";
import { enqueueOnce } from "../notices";
import { redactedError } from "../redact";
import type { PartyItem } from "../tables";
import { logLine } from "../agent/clients";
import { type RuntimeDeployment, rpcUrl, runtimeDeployment } from "../agent/deployment";
import { s3EvidenceExists } from "../agent/evidence";
import { readCursor, readPausedHere, writeCursor, writePausedHere } from "../agent/state";

// Most blocks per getLogs request: RPC providers limit the range
export const MAX_RANGE = 2000n;
// Ranges per run, so a run that starts far behind ends inside the function timeout and the next
// minute continues from the cursor it saved
export const MAX_RANGES_PER_RUN = 20;
// One run at a time: a slow run overlapping the next minute would report and pause twice
const LOCK_SECONDS = 55;
const NO_EVIDENCE_DIR = "/tmp/keel-evidence-unused";

export interface MonitorPassDeps {
  context(): Promise<RuntimeDeployment>;
  chain(ctx: RuntimeDeployment): Promise<MonitorChain>;
  pauser(ctx: RuntimeDeployment): Promise<Pauser | undefined>;
  isIssued(hash: Hex): Promise<boolean>;
  // The importer Safe's account in the bot directory: monitor notices are wallet notices
  account(safe: Hex): Promise<string | undefined>;
  acquire(name: string, holdSeconds: number): Promise<Lock | null>;
  enqueue(notices: readonly { id: string }[]): Promise<number>;
  log(line: Record<string, unknown>): void;
  now(): number;
  env: Env;
}

export function defaultDeps(env: Env = process.env): MonitorPassDeps {
  return {
    env,
    context: () => runtimeDeployment(env),
    chain: async () => rpcMonitorChain(await rpcUrl(env)),
    async pauser() {
      // Only when a pause key is configured: loadKeys defaults to KMS and would fail without one
      if (!env.KEY_SOURCE_PAUSER && !env.PAUSER_KEY_ID) return undefined;
      const { pauser } = await loadKeys(["pauser"], { env });
      return pauser && pauserOn(rpcChain(await rpcUrl(env), pauser), pauser.address);
    },
    isIssued: (hash) => s3EvidenceExists(required(env, "EVIDENCE_BUCKET"))(hash),
    async account(safe) {
      const { Item } = await ddb().send(new GetCommand({ TableName: table("parties", env), Key: { address: lower(safe) } }));
      return (Item as PartyItem | undefined)?.account;
    },
    acquire: (name, hold) => acquire(name, hold, env),
    enqueue: (notices) => enqueueOnce(notices, env),
    log: logLine,
    now: () => Math.floor(Date.now() / 1000),
  };
}

export type MonitorPassResult = { status: "ran"; events: MonitorEvent[]; next: bigint } | { status: "skipped"; reason: "LOCKED" };

export async function runMonitorPass(deps: MonitorPassDeps): Promise<MonitorPassResult> {
  const ctx = await deps.context();
  if (!ctx.fundingGate) throw new ConfigError("the monitor needs the funding gate of the deployment");
  const gate = ctx.fundingGate;
  const lock = await deps.acquire("monitor", LOCK_SECONDS);
  if (!lock) {
    deps.log({ monitor: "skipped", reason: "LOCKED" });
    return { status: "skipped", reason: "LOCKED" };
  }
  try {
    const chain = await deps.chain(ctx);
    // Where the last run stopped; the first run starts at the deploy block, or at the next block
    // when nobody recorded it (reading the whole chain is not an option on a public network)
    const fromBlock = (await readCursor("monitor", deps.env)) ?? (ctx.deployBlock > 0n ? ctx.deployBlock : (await chain.latestBlock()) + 1n);
    const pausedHere = await readPausedHere(deps.env);
    const pauser = await deps.pauser(ctx);
    const account = await deps.account(ctx.safe);
    const pending: Promise<unknown>[] = [];
    // Blocks whose people were not told must be read again: the cursor stays before them
    let notAlerted = false;
    let noAccount = false;
    const notify = (event: MonitorEvent) => {
      deps.log({ monitor: event });
      if (!account) {
        deps.log({ bot: "skipped", reason: "ACCOUNT_MISSING", txHash: event.txHash });
        if (event.kind === "incident") {
          noAccount = true;
          deps.log({ monitor: "MONITOR_NO_ACCOUNT", safe: ctx.safe, txHash: event.txHash, reason: event.reason });
        }
        return;
      }
      const notices = toMonitorNotices(event, account, gate, deps.now());
      if (notices.length) {
        pending.push(
          deps.enqueue(notices).catch((e: unknown) => {
            notAlerted = true;
            deps.log({ bot: "enqueue_failed", txHash: event.txHash, error: e instanceof Error ? e.name : "Error" });
          }),
        );
      }
    };
    const monitor = new Monitor(
      { chainId: ctx.chainId, gate, escrow: ctx.escrow, safe: ctx.safe, evidenceDir: NO_EVIDENCE_DIR, fromBlock, maxRange: MAX_RANGE, maxRangesPerTick: MAX_RANGES_PER_RUN, pausedHere },
      { chain, pauser, notify, isIssued: deps.isIssued },
    );
    // A read that fails stops the tick, but the ranges it finished are done: they are saved below
    // (their notices already went out, and enqueueOnce keeps them from repeating anyway)
    let events: MonitorEvent[] = [];
    let failure: unknown;
    try {
      events = await monitor.tick();
    } catch (e) {
      failure = e;
    }
    await Promise.all(pending);
    // The pause happened on chain whatever comes next: remember it
    if (monitor.paused !== pausedHere) await writePausedHere(monitor.paused, deps.env);
    if (!notAlerted && !noAccount && monitor.cursor > fromBlock) await writeCursor("monitor", monitor.cursor, deps.env);
    if (failure) throw redactedError(failure);
    // Throwing (not advancing) retries the incident every minute and shows in the Lambda error metric
    if (noAccount) throw new Error("MONITOR_NO_ACCOUNT: an incident was found and the Safe has no bot account to tell");
    if (notAlerted) throw new Error("the monitor could not enqueue its notices");
    deps.log({ monitor: "pass", fromBlock, next: monitor.cursor, events: events.length, pauser: pauser?.address ?? null });
    return { status: "ran", events, next: monitor.cursor };
  } finally {
    await lock.release();
  }
}

// An error that leaves this function reaches the Lambda runtime log: no RPC URL in it
export const handler = async (): Promise<void> => {
  try {
    await runMonitorPass(defaultDeps());
  } catch (e) {
    throw redactedError(e);
  }
};
