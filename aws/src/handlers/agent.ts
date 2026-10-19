// The agent service of one importer Safe (T2.11) as a Lambda, triggered by the FIFO agent queue
// with batch size 1 (./fanout.ts sends one message per Safe and minute). One invocation is one
// tick() of the engine's Agent, composed exactly as `keel agent` composes it
// (engine/src/agent/compose.ts), with three adapters:
//
//   store     DynamoSnapshotStore: orders of the Safe and their parties, loaded once per pass
//   evidence  S3 pdr/<pdrHash>.json, awaited before the call that carries the PDR is sent
//   notices   engine toNotices, enqueued once per notice id (../notices.ts enqueueOnce)
//
// Keys: relayer and policy signer from KMS or SSM (../keys.ts); the policy key must be the signer
// registered on chain. The owner key never comes here. A lock per relayer (../lock.ts) keeps two
// passes from racing for the relayer's nonce; the FIFO group already serializes one Safe.
import type { SQSEvent } from "aws-lambda";
import type { Hex } from "@keel/schemas";
import {
  type AgentChain,
  type AgentEvent,
  type AgentStore,
  composeAgent,
  type OrderRecord,
  type PdrEvidence,
  type PolicySigner,
  rpcChain,
  toNotices,
} from "@keel/engine";
import type { LocalAccount } from "viem";
import { ConfigError, type Env, logRange, required } from "../config";
import { lower } from "../db";
import { loadKeys, type ServerKeys } from "../keys";
import { acquire, type Lock } from "../lock";
import { enqueueOnce } from "../notices";
import { safeMessage } from "../redact";
import { logLine } from "../agent/clients";
import { type RuntimeDeployment, rpcUrl, runtimeDeployment } from "../agent/deployment";
import { s3Evidence } from "../agent/evidence";
import { DynamoSnapshotStore } from "../agent/store";

// The lock outlives the function timeout (set below this in infra), so a pass that dies holding
// it frees the relayer on its own before the next-but-one minute.
export const LOCK_HOLD_SECONDS = 110;
export const RECEIPT_TIMEOUT_MS = 60_000;
// Never read: the evidence goes to S3 through saveEvidence. AgentConfig requires a directory.
const NO_EVIDENCE_DIR = "/tmp/keel-evidence-unused";

export interface AgentPassDeps {
  context(): Promise<RuntimeDeployment>;
  keys(registeredPolicySigner?: Hex): Promise<ServerKeys>;
  chain(relayer: LocalAccount, ctx: RuntimeDeployment): Promise<AgentChain>;
  acquire(relayer: string, holdSeconds: number): Promise<Lock | null>;
  store(safe: string): Promise<AgentStore>;
  saveEvidence(evidence: PdrEvidence): Promise<void>;
  enqueue(notices: readonly { id: string }[]): Promise<number>;
  log(line: Record<string, unknown>): void;
  now(): number;
}

export function defaultDeps(env: Env = process.env): AgentPassDeps {
  return {
    context: () => runtimeDeployment(env),
    keys: (registered) => loadKeys(["relayer", "policySigner"], { env }, registered),
    async chain(relayer, ctx) {
      // Escrow logs are searched from the deployment block: RPC providers cap the range of getLogs
      // The receipt wait stays well inside the function timeout (viem waits 180 s by default): a
      // transaction mined after it is found by the next pass, which re-reads the order
      const chain = rpcChain(await rpcUrl(env), relayer, { receiptTimeoutMs: RECEIPT_TIMEOUT_MS, logRange: logRange(env), ...(ctx.deployBlock > 0n && { fromBlock: ctx.deployBlock }) });
      const id = await chain.chainId();
      if (id !== ctx.chainId) throw new ConfigError(`the RPC serves chain ${id}, not ${ctx.chainId}`);
      return chain;
    },
    acquire: (relayer, hold) => acquire(relayer, hold, env),
    store: (safe) => DynamoSnapshotStore.load(safe, env),
    saveEvidence: (e) => s3Evidence(required(env, "EVIDENCE_BUCKET"))(e),
    enqueue: (notices) => enqueueOnce(notices, env),
    log: logLine,
    now: () => Math.floor(Date.now() / 1000),
  };
}

export type AgentPassResult = { status: "ran"; events: AgentEvent[] } | { status: "skipped"; reason: "SAFE_NOT_DEPLOYED" | "LOCKED" };

export async function runAgentPass(safeAddress: string, deps: AgentPassDeps): Promise<AgentPassResult> {
  const ctx = await deps.context();
  const safe = lower(safeAddress);
  // The gate, Roles and allowance keys of the deployment belong to one Safe: another Safe would
  // be funded through a gate that is not its own. More Safes need one deployment each.
  if (safe !== lower(ctx.safe)) {
    deps.log({ agent: "skipped", reason: "SAFE_NOT_DEPLOYED", safe });
    return { status: "skipped", reason: "SAFE_NOT_DEPLOYED" };
  }
  const keys = await deps.keys(ctx.policySigner);
  if (!keys.relayer || !keys.policySigner) throw new ConfigError("the agent needs the relayer and the policy keys");
  const relayer = keys.relayer;
  const signer: PolicySigner = keys.policySigner;

  // Busy: another pass holds the relayer. Returning (not throwing) leaves no message to retry:
  // the next minute's message runs a full pass anyway, and a retried FIFO message would only hold
  // back the newer ones of the same Safe.
  const lock = await deps.acquire(relayer.address, LOCK_HOLD_SECONDS);
  if (!lock) {
    deps.log({ agent: "skipped", reason: "LOCKED", safe, relayer: relayer.address });
    return { status: "skipped", reason: "LOCKED" };
  }
  try {
    const chain = await deps.chain(relayer, ctx);
    const store = await deps.store(safe);
    // The Agent notifies synchronously; the enqueues are awaited before the pass ends. A notice is
    // never in the payment path: a failure is logged and the pass goes on.
    const pending: Promise<unknown>[] = [];
    const notify = (event: AgentEvent, record?: OrderRecord) => {
      deps.log({ agent: "event", ...event });
      let notices: ReturnType<typeof toNotices>;
      try {
        notices = toNotices(event, record, store, deps.now());
      } catch (e) {
        deps.log({ bot: "skipped", orderId: event.orderId, reason: "DATA_ERROR", detail: safeMessage(e) });
        return;
      }
      if (typeof notices === "string") {
        if (notices !== "NOTHING_TO_NOTIFY") deps.log({ bot: "skipped", orderId: event.orderId, reason: notices });
        return;
      }
      pending.push(deps.enqueue(notices).catch((e: Error) => deps.log({ bot: "enqueue_failed", orderId: event.orderId, error: e.name })));
    };
    const { agent } = await composeAgent({
      chainId: ctx.chainId,
      deployment: ctx.settings,
      escrow: ctx.escrow,
      safe: ctx.safe,
      chain,
      store,
      signer,
      evidenceDir: NO_EVIDENCE_DIR,
      notify,
      saveEvidence: deps.saveEvidence,
    });
    const events = await agent.tick();
    await Promise.all(pending);
    deps.log({ agent: "pass", safe, orders: store.orderIds().length, events: events.length });
    return { status: "ran", events };
  } finally {
    await lock.release();
  }
}

// A malformed message is dropped with a log line: retrying it can never succeed. A failed pass is
// logged (URLs removed: viem puts the RPC URL, with its API key, in its messages) and the message
// is done too, never thrown: the next minute's message runs a full pass anyway, and a failed
// message would hold back every newer one of the same Safe (FIFO group) for the visibility timeout.
// The failure is visible as the `agent: "pass_failed"` log line (metric filter in infra).
export const handler = (event: SQSEvent): Promise<void> => handleMessages(event, defaultDeps());

export async function handleMessages(event: SQSEvent, deps: AgentPassDeps): Promise<void> {
  for (const record of event.Records) {
    let safe: unknown;
    try {
      safe = (JSON.parse(record.body) as { safe?: unknown }).safe;
    } catch {
      safe = undefined;
    }
    if (typeof safe !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(safe)) {
      logLine({ agent: "skipped", reason: "BAD_MESSAGE", messageId: record.messageId });
      continue;
    }
    try {
      await runAgentPass(safe, deps);
    } catch (e) {
      logLine({ agent: "pass_failed", safe, messageId: record.messageId, error: e instanceof Error ? e.name : "Error", detail: safeMessage(e) });
    }
  }
}
