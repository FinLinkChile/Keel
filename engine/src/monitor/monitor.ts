// Monitor of use outside the system (T2.8). It watches the deployed FundingGate and TradeEscrow of
// one importer Safe and reacts when something the engine never decided reaches the chain:
//
// * A FundingExecuted whose PDR the engine never issued: the policy key signed outside the engine.
// * A BalanceReleased authorized neither by an engine DocumentDecision nor by the importer's own
//   BalanceApproval: the document verifier key signed outside the engine (in the prototype it is
//   the policy key too).
//
// On an incident it pauses the gate with a key that can only pause (Area 2 decision of Oct 16,
// asked to Area 1 in the PR #57 review) and tells the people. Until that role exists in the gate
// the pause reverts and the monitor only alerts the human cosigner, who pauses from the app.
// Configuration changes (queued suppliers and third parties, signer, rules version, cosigner,
// pauses) are only reported: the owners make them legitimately and the veto is human.
// The monitor holds no authority to move funds: pausing is the only call it ever sends.
import { type Hex, keelDomain } from "@keel/schemas";
import { typedDataDigest } from "@keel/schemas/hash";
import { decodeEventLog, encodeFunctionData, parseAbi } from "viem";
import { CallReverted } from "../agent/agent";
import { errorDetail } from "../agent/detail";
import { loadEvidence } from "../verify";

export const MONITOR_EVENTS_ABI = parseAbi([
  "event FundingExecuted(bytes32 indexed intentHash, bytes32 pdrHash, uint8 tier, bytes32 indexed orderId)",
  "event ChangeQueued(uint256 indexed changeId, uint8 kind, address indexed subject, address payout, uint8 roles, uint64 activatesAt)",
  "event ChangeVetoed(uint256 indexed changeId, address indexed by)",
  "event GatePaused(address indexed by)",
  "event GateUnpaused(address indexed by)",
  "event PolicySignerSet(address signer)",
  "event PolicyHashSet(bytes32 policyHash)",
  "event CosignerSet(address cosigner)",
  "event GuardianSet(address indexed previousGuardian, address indexed guardian)",
  "event BalanceReleased(bytes32 indexed orderId, address indexed to, uint256 amount, bytes32 authorizationDigest)",
]);

export const PAUSE_ABI = parseAbi(["function emergencyPause()"]);

// A log as an RPC node returns it, with where it happened
export interface MonitorLog {
  address: Hex;
  topics: readonly Hex[];
  data: Hex;
  blockNumber: bigint;
  transactionHash: Hex;
  logIndex: number;
}

export interface MonitorChain {
  latestBlock(): Promise<bigint>;
  logs(addresses: readonly Hex[], fromBlock: bigint, toBlock: bigint): Promise<MonitorLog[]>;
  // The attestation the escrow accepted for an order: what the importer's BalanceApproval signs
  attestationHash(escrow: Hex, orderId: Hex): Promise<Hex>;
  // The importer of an order (po.importer): the escrow is shared, so a release is the monitor's
  // concern only when the order is its Safe's
  importerOf(escrow: Hex, orderId: Hex): Promise<Hex>;
}

// Sends the pause. Throws CallReverted when the key may not pause (simulated first, no gas spent).
export interface Pauser {
  address: Hex;
  pause(gate: Hex): Promise<{ hash: Hex; status: "success" | "reverted" }>;
}

export interface MonitorConfig {
  chainId: number;
  gate: Hex;
  escrow: Hex;
  // The importer Safe this monitor watches. The TradeEscrow is shared by every importer, so a
  // BalanceReleased of an order of another Safe is not an incident here and never pauses this gate.
  safe: Hex;
  evidenceDir: string;
  // First block to read; later ticks continue from the last block read
  fromBlock: bigint;
  // Most blocks read in one request, for RPC providers that limit the range
  maxRange?: bigint;
  // Most requests of `maxRange` blocks in one tick (default: no limit). A tick that stops there
  // continues from `cursor` on the next one, so a host with a time limit (Lambda) never starts
  // a run it cannot finish when it is far behind.
  maxRangesPerTick?: number;
  // Whether an earlier run of this monitor already paused the gate (and no GateUnpaused followed).
  // A process that restarts between ticks, such as a Lambda, persists it with `cursor`.
  pausedHere?: boolean;
}

export interface MonitorDeps {
  chain: MonitorChain;
  pauser?: Pauser;
  notify?: (event: MonitorEvent) => void;
  // Whether the engine issued a PDR with this hash, that is, whether its evidence exists.
  // Default: a file in `evidenceDir`. A deployment that keeps evidence elsewhere (S3) reads it here.
  isIssued?: (hash: Hex) => Promise<boolean>;
}

export type IncidentReason = "UNKNOWN_FUNDING_PDR" | "UNKNOWN_DOCUMENT_DECISION";
export type ChangeReason =
  | "SUPPLIER_QUEUED"
  | "THIRD_PARTY_QUEUED"
  | "CHANGE_VETOED"
  | "GATE_PAUSED"
  | "GATE_UNPAUSED"
  | "POLICY_SIGNER_SET"
  | "POLICY_HASH_SET"
  | "COSIGNER_SET"
  // The key that may only pause the gate (#67) was set, rotated or cleared (subject zero)
  | "GUARDIAN_SET";

export interface MonitorEvent {
  kind: "incident" | "change";
  reason: IncidentReason | ChangeReason;
  txHash: Hex;
  blockNumber: bigint;
  orderId?: Hex;
  // The hash that has no engine evidence (pdrHash or authorization digest)
  pdrHash?: Hex;
  changeId?: bigint;
  subject?: Hex;
  activatesAt?: bigint;
  by?: Hex;
  // What the monitor did about an incident
  action?: "paused" | "alerted";
  pauseTx?: Hex;
  // Why the pause did not happen (for example OnlyPauser, a key that is not the gate's guardian)
  pauseRevert?: string;
}

const low = (h: Hex) => h.toLowerCase() as Hex;

export class Monitor {
  private next: bigint;
  private pausedHere = false;

  constructor(
    private readonly config: MonitorConfig,
    private readonly deps: MonitorDeps,
  ) {
    this.next = config.fromBlock;
    this.pausedHere = config.pausedHere ?? false;
  }

  // The next block to read: where a later process resumes (fromBlock of its config)
  get cursor(): bigint {
    return this.next;
  }

  get paused(): boolean {
    return this.pausedHere;
  }

  // Reads every new block once. Never throws for one bad log: it is reported and skipped.
  async tick(): Promise<MonitorEvent[]> {
    const latest = await this.deps.chain.latestBlock();
    const events: MonitorEvent[] = [];
    for (let ranges = 0; this.next <= latest && ranges < (this.config.maxRangesPerTick ?? Infinity); ranges++) {
      const to = latest < this.next + (this.config.maxRange ?? 2000n) - 1n ? latest : this.next + (this.config.maxRange ?? 2000n) - 1n;
      const logs = await this.deps.chain.logs([this.config.gate, this.config.escrow], this.next, to);
      logs.sort((a, b) => (a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1));
      for (const log of logs) {
        const event = await this.inspect(log);
        if (!event) continue;
        events.push(event);
        this.deps.notify?.(event);
      }
      this.next = to + 1n;
    }
    return events;
  }

  private async inspect(log: MonitorLog): Promise<MonitorEvent | null> {
    let decoded: { eventName: string; args: Record<string, unknown> };
    try {
      decoded = decodeEventLog({ abi: MONITOR_EVENTS_ABI, topics: log.topics as [Hex, ...Hex[]], data: log.data }) as never;
    } catch {
      return null;
    }
    const at = { txHash: log.transactionHash, blockNumber: log.blockNumber };
    const fromGate = low(log.address) === low(this.config.gate);
    const fromEscrow = low(log.address) === low(this.config.escrow);
    const a = decoded.args;

    switch (decoded.eventName) {
      case "FundingExecuted": {
        if (!fromGate) return null;
        const pdrHash = a.pdrHash as Hex;
        if (await this.issuedByEngine(pdrHash)) return null;
        return this.incident({ ...at, kind: "incident", reason: "UNKNOWN_FUNDING_PDR", orderId: a.orderId as Hex, pdrHash });
      }
      case "BalanceReleased": {
        if (!fromEscrow) return null;
        const digest = a.authorizationDigest as Hex;
        const orderId = a.orderId as Hex;
        // Another importer's order on the shared escrow is none of this monitor's business
        let importer: Hex;
        try {
          importer = await this.deps.chain.importerOf(this.config.escrow, orderId);
        } catch (e) {
          // Whose order it is cannot be told: alert the people, but never pause on a guess
          return { ...at, kind: "incident", reason: "UNKNOWN_DOCUMENT_DECISION", orderId, pdrHash: digest, action: "alerted", pauseRevert: `ORDER_READ_FAILED: ${errorDetail(e)}` };
        }
        if (low(importer) !== low(this.config.safe)) return null;
        if ((await this.issuedByEngine(digest)) || (await this.importerApproved(orderId, digest))) return null;
        return this.incident({ ...at, kind: "incident", reason: "UNKNOWN_DOCUMENT_DECISION", orderId, pdrHash: digest });
      }
      case "ChangeQueued":
        if (!fromGate) return null;
        return {
          ...at,
          kind: "change",
          reason: Number(a.kind) === 1 ? "SUPPLIER_QUEUED" : "THIRD_PARTY_QUEUED",
          changeId: a.changeId as bigint,
          subject: a.subject as Hex,
          activatesAt: a.activatesAt as bigint,
        };
      case "ChangeVetoed":
        return fromGate ? { ...at, kind: "change", reason: "CHANGE_VETOED", changeId: a.changeId as bigint, by: a.by as Hex } : null;
      case "GatePaused":
        return fromGate ? { ...at, kind: "change", reason: "GATE_PAUSED", by: a.by as Hex } : null;
      case "GateUnpaused":
        if (!fromGate) return null;
        this.pausedHere = false;
        return { ...at, kind: "change", reason: "GATE_UNPAUSED", by: a.by as Hex };
      case "PolicySignerSet":
        return fromGate ? { ...at, kind: "change", reason: "POLICY_SIGNER_SET", subject: a.signer as Hex } : null;
      case "PolicyHashSet":
        return fromGate ? { ...at, kind: "change", reason: "POLICY_HASH_SET" } : null;
      case "CosignerSet":
        return fromGate ? { ...at, kind: "change", reason: "COSIGNER_SET", subject: a.cosigner as Hex } : null;
      case "GuardianSet":
        return fromGate ? { ...at, kind: "change", reason: "GUARDIAN_SET", subject: a.guardian as Hex } : null;
      default:
        return null;
    }
  }

  // The engine keeps every PDR it issues in evidence/pdr/, by hash (T2.4)
  private async issuedByEngine(hash: Hex): Promise<boolean> {
    if (this.deps.isIssued) return this.deps.isIssued(hash);
    return loadEvidence(this.config.evidenceDir, hash) !== null;
  }

  // A balance the importer released by hand carries the digest of its BalanceApproval
  private async importerApproved(orderId: Hex, digest: Hex): Promise<boolean> {
    const attestationHash = await this.deps.chain.attestationHash(this.config.escrow, orderId);
    const approval = typedDataDigest(keelDomain(this.config.chainId, this.config.escrow), "BalanceApproval", { orderId, attestationHash });
    return low(approval) === low(digest);
  }

  // Pause once, then alert. A failed pause is an alert, never an exception.
  private async incident(event: MonitorEvent): Promise<MonitorEvent> {
    if (!this.deps.pauser) return { ...event, action: "alerted" };
    if (this.pausedHere) return { ...event, action: "paused" };
    try {
      const { hash, status } = await this.deps.pauser.pause(this.config.gate);
      if (status !== "success") return { ...event, action: "alerted", pauseTx: hash, pauseRevert: "REVERTED" };
      this.pausedHere = true;
      return { ...event, action: "paused", pauseTx: hash };
    } catch (e) {
      if (e instanceof CallReverted) return { ...event, action: "alerted", pauseRevert: e.reason };
      return { ...event, action: "alerted", pauseRevert: errorDetail(e) };
    }
  }
}

// The pause call: simulated first through `call`, then sent through `send`.
export function pauserOn(
  chain: { call(c: { to: Hex; data: Hex }): Promise<Hex>; send(c: { to: Hex; data: Hex }): Promise<{ hash: Hex; status: "success" | "reverted" }> },
  address: Hex,
): Pauser {
  return {
    address,
    async pause(gate) {
      const call = { to: gate, data: encodeFunctionData({ abi: PAUSE_ABI, functionName: "emergencyPause" }) };
      await chain.call(call);
      return chain.send(call);
    },
  };
}
