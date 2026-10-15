// Agent service (T2.11): joins ingest, engine, PDR and relayer for one importer Safe.
// Each tick reads every stored order from the escrow and takes at most one step per order.
// The chain is the source of truth and the agent keeps no state besides the notices already
// sent, so a repeated tick never sends twice: the escrow state moved, or the simulation fails.
// The relayer gains no authority here: without a valid PDR or signature the gate and the
// escrow revert, and every call is simulated before it is sent (T2.5).
import { type EscrowState, type FundIntent, type HoldState, type Hex, keelDomain } from "@keel/schemas";
import { structHash } from "@keel/schemas/hash";
import type { DocumentRuleResult } from "../documents";
import { evaluateFunding, type FundingContext } from "../funding";
import type { RuleResult } from "../index";
import { buildPolicyDecision, issueDocumentPdr, type PdrEvidence, type PolicySigner, type SignedPolicyDecision, saveEvidence, signPolicyDecision } from "../pdr";
import { type TradePolicy, tradePolicyHash } from "../policy";
import {
  type Call,
  decodeOrderOf,
  decodeRefundGrace,
  type OrderRecord,
  orderOfCall,
  refundCall,
  refundGraceCall,
  releaseBalanceCall,
  submitShipmentCall,
} from "./escrow";
import type { AgentStore } from "./store";

// What the agent needs from the chain. The relayer is the sender of every call.
export interface AgentChain {
  // Timestamp of the latest block, seconds
  now(): Promise<bigint>;
  // eth_call; throws CallReverted
  call(call: Call): Promise<Hex>;
  // Sends and waits for the receipt
  send(call: Call): Promise<{ hash: Hex; status: "success" | "reverted" }>;
}

export class CallReverted extends Error {
  constructor(readonly reason: string) {
    super(`reverted with ${reason}`);
  }
}

// What the agent reads from the Trade gate (FundingGate, Area 1) and the exact call it sends
// (./gate.ts). Without a gate, funding waits with GATE_NOT_DEPLOYED.
export interface FundingGatePort {
  address: Hex;
  // Remaining allowance of the agent role in the current period (Roles Modifier)
  allowance(): Promise<{ token: Hex; remaining: bigint }>;
  // The trust registries of this Safe, which the gate enforces on chain
  isKnownSupplier(exporter: Hex, payout: Hex): Promise<boolean>;
  hasRole(party: Hex, role: "carrier" | "arbiter" | "verifier"): Promise<boolean>;
  // The exact calldata the Safe executes (approve exact, then fund): its hash goes in the PDR
  safeCalldata(intent: FundIntent): Hex;
  executeCall(intent: FundIntent, signed: SignedPolicyDecision): Call;
}

export type AgentAction = "fund" | "submitShipment" | "releaseBalance" | "refundAfterDeadline";

// Reason codes for the bot templates (Area 4), never free text.
export type AgentReason =
  | "SENT"
  | "GATE_NOT_DEPLOYED"
  | "FUNDING_BLOCKED"
  | "SUPPLIER_NEW"
  | "COSIGNATURE_NEEDED"
  | "AWAITING_SHIPMENT"
  | "DEADLINE_SOON"
  | "SIMULATION_REVERTED"
  | "DISPUTE_WINDOW"
  | "DOCUMENTS_PENDING"
  | "ATTESTATION_UNKNOWN"
  | "IMPORTER_NOT_REGISTERED"
  | "NOT_DOCUMENT_VERIFIER"
  | "DOCUMENTS_DO_NOT_CONFORM"
  | "NOTHING_TO_DO"
  | "AGENT_ERROR";

export interface AgentEvent {
  orderId: Hex;
  state: EscrowState;
  outcome: "sent" | "held" | "notice" | "waiting" | "failed";
  reason: AgentReason;
  action?: AgentAction;
  // Off-chain hold state that goes with the escrow state (T2.6)
  hold?: HoldState;
  txHash?: Hex;
  status?: "success" | "reverted";
  pdrHash?: Hex;
  // Revert name of a failed simulation
  revert?: string;
  // Rules that held the operation
  rules?: readonly (RuleResult | DocumentRuleResult)[];
  // Tier 3: what the cosigner signs (Area 4)
  cosign?: { pdrHash: Hex };
  // DEADLINE_SOON: whole days left to the shipment deadline, and the reminder it belongs to
  daysLeft?: number;
  reminder?: number;
  detail?: string;
}

export interface AgentConfig {
  chainId: number;
  escrow: Hex;
  // The importer Safe this agent works for: it only acts on its orders
  safe: Hex;
  policy: TradePolicy;
  decisionTtlSeconds: number;
  evidenceDir: string;
  // Days before the shipment deadline when the importer is reminded, once each (T2.6)
  deadlineReminderDays?: readonly number[];
}

export const DEADLINE_REMINDER_DAYS: readonly number[] = [5, 3, 1];
const DAY = 24n * 60n * 60n;

export interface AgentDeps {
  chain: AgentChain;
  store: AgentStore;
  // Policy key, in its own process in production (T2.7). Also the document verifier in the prototype.
  signer: PolicySigner;
  gate?: FundingGatePort;
  // Held operations and notices go to the bot (Area 4). Each one is sent once, with the order
  // as the escrow holds it when it was read (absent when the read failed).
  notify?: (event: AgentEvent, record?: OrderRecord) => void;
}

const same = (a: Hex, b: Hex) => a.toLowerCase() === b.toLowerCase();

export class Agent {
  private readonly notified = new Set<string>();
  private refundGrace?: bigint;

  constructor(
    private readonly config: AgentConfig,
    private readonly deps: AgentDeps,
  ) {}

  // One pass over every stored order. Never throws: a failing order does not stop the others.
  async tick(): Promise<AgentEvent[]> {
    const events: AgentEvent[] = [];
    const now = await this.deps.chain.now();
    for (const orderId of this.deps.store.orderIds()) {
      let event: AgentEvent;
      let record: OrderRecord | undefined;
      try {
        record = decodeOrderOf(await this.deps.chain.call(orderOfCall(this.config.escrow, orderId)));
        if (record.state === "NONE" || !same(record.po.importer, this.config.safe)) continue;
        event = await this.step(orderId, record, now);
      } catch (e) {
        event = { orderId, state: record?.state ?? "NONE", outcome: "failed", reason: "AGENT_ERROR", detail: (e as Error).message };
      }
      events.push(event);
      this.report(event, record);
    }
    return events;
  }

  private report(event: AgentEvent, record?: OrderRecord) {
    if (!this.deps.notify || event.outcome === "waiting") return;
    if (event.outcome === "held" || event.outcome === "notice") {
      const key = `${event.orderId}:${event.state}:${event.reason}:${event.revert ?? ""}:${event.reminder ?? ""}`;
      if (this.notified.has(key)) return;
      this.notified.add(key);
    }
    this.deps.notify(event, record);
  }

  private step(orderId: Hex, record: OrderRecord, now: bigint): Promise<AgentEvent> {
    switch (record.state) {
      case "OPEN":
        return this.fund(orderId, record, now);
      case "ADVANCE_PAID":
        return this.shipmentOrRefund(orderId, record, now);
      case "SHIPPED":
        return this.releaseBalance(orderId, record, now);
      default:
        // Final states, and disputes: the arbiter or both parties move the funds, not the agent
        return Promise.resolve({ orderId, state: record.state, outcome: "waiting", reason: "NOTHING_TO_DO" });
    }
  }

  // Simulate, then send. A call that would revert is held with its revert name and no gas is spent.
  private async execute(orderId: Hex, state: EscrowState, action: AgentAction, call: Call, before?: () => void): Promise<AgentEvent> {
    try {
      await this.deps.chain.call(call);
    } catch (e) {
      if (!(e instanceof CallReverted)) throw e;
      return { orderId, state, outcome: "held", hold: "retenida", reason: "SIMULATION_REVERTED", action, revert: e.reason };
    }
    before?.();
    const { hash, status } = await this.deps.chain.send(call);
    return { orderId, state, outcome: "sent", reason: "SENT", action, txHash: hash, status };
  }

  // Step 2: deposit through the Trade gate, with a funding PDR.
  private async fund(orderId: Hex, record: OrderRecord, now: bigint): Promise<AgentEvent> {
    const state = record.state;
    const gate = this.deps.gate;
    if (!gate) return { orderId, state, outcome: "waiting", reason: "GATE_NOT_DEPLOYED" };

    const { po } = record;
    // The registries are read from the gate, which enforces them: the engine never approves a
    // supplier or a third party the gate would reject. The exporter is listed so that one without
    // an active payout pair is a new supplier (tier 2), not an unknown party.
    const [known, ...thirds] = await Promise.all([
      gate.isKnownSupplier(po.exporter, po.payoutAddress),
      gate.hasRole(po.carrier, "carrier"),
      gate.hasRole(po.arbiter, "arbiter"),
      gate.hasRole(po.documentVerifier, "verifier"),
    ]);
    const trusted = [po.carrier, po.arbiter, po.documentVerifier].filter((_, i) => thirds[i]);
    const context: FundingContext = {
      now: Number(now),
      safe: this.config.safe,
      escrow: this.config.escrow,
      escrowOrder: { state, orderHash: record.orderHash },
      registeredParties: [po.importer, po.exporter, ...trusted],
      knownSuppliers: known ? [{ exporter: po.exporter, payoutAddress: po.payoutAddress }] : [],
      allowance: await gate.allowance(),
      history: this.deps.store.registry().history[po.exporter.toLowerCase()] ?? [],
      // One nonce per order version: a retry after a crash can never fund twice (the gate marks it used)
      nonce: BigInt(record.orderHash),
    };
    const out = evaluateFunding(po, context, this.config.policy.funding);
    const failing = out.rules.filter((r) => r.tier === out.tier);
    if (out.tier === 4 || !out.intent) return { orderId, state, outcome: "held", hold: "bloqueada", reason: "FUNDING_BLOCKED", rules: failing };
    // A new supplier goes through out of band verification and the Delay first (T4.1)
    if (out.tier === 2) return { orderId, state, outcome: "held", hold: "cambio_en_cola", reason: "SUPPLIER_NEW", rules: failing };

    const intent = out.intent;
    const decision = buildPolicyDecision({
      intentHash: structHash("FundIntent", intent),
      calldata: gate.safeCalldata(intent),
      policyHash: tradePolicyHash(this.config.policy),
      inputsHash: out.inputsHash,
      tier: out.tier as 1 | 3,
      expiresAt: intent.deadline,
    });
    const signed = await signPolicyDecision(decision, keelDomain(this.config.chainId, gate.address), this.deps.signer);
    const evidence: PdrEvidence = {
      mode: "trade",
      issuedAt: Number(now),
      ...signed,
      intent,
      calldata: gate.safeCalldata(intent),
      rules: out.rules,
      replay: { kind: "funding", policy: this.config.policy, order: po, context },
    };
    if (out.tier === 3) {
      saveEvidence(this.config.evidenceDir, evidence);
      return { orderId, state, outcome: "held", hold: "en_aprobacion", reason: "COSIGNATURE_NEEDED", rules: failing, pdrHash: signed.pdrHash, cosign: { pdrHash: signed.pdrHash } };
    }
    const event = await this.execute(orderId, state, "fund", gate.executeCall(intent, signed), () => saveEvidence(this.config.evidenceDir, evidence));
    return { ...event, pdrHash: signed.pdrHash };
  }

  // Steps 4 and 6: present the carrier attestation, or refund once the deadline and grace passed.
  private async shipmentOrRefund(orderId: Hex, record: OrderRecord, now: bigint): Promise<AgentEvent> {
    const state = record.state;
    const shipment = this.deps.store.shipment(orderId);
    let held: AgentEvent | undefined;
    if (shipment) {
      const event = await this.execute(orderId, state, "submitShipment", submitShipmentCall(this.config.escrow, shipment.attestation, shipment.sigCarrier));
      if (event.outcome === "sent") return event;
      held = { ...event, hold: "bloqueada" };
    }
    this.refundGrace ??= decodeRefundGrace(await this.deps.chain.call(refundGraceCall(this.config.escrow)));
    if (now > record.po.shipmentDeadline + this.refundGrace) {
      return this.execute(orderId, state, "refundAfterDeadline", refundCall(this.config.escrow, orderId));
    }
    if (held) return held;
    // One reminder per threshold: a tick that runs late skips to the nearest one, never repeats
    const left = record.po.shipmentDeadline > now ? (record.po.shipmentDeadline - now + DAY - 1n) / DAY : 0n;
    const daysLeft = Number(left);
    const reminder = [...(this.config.deadlineReminderDays ?? DEADLINE_REMINDER_DAYS)].sort((a, b) => a - b).find((d) => daysLeft <= d);
    if (reminder !== undefined) return { orderId, state, outcome: "notice", reason: "DEADLINE_SOON", daysLeft, reminder };
    return { orderId, state, outcome: "waiting", reason: "AWAITING_SHIPMENT" };
  }

  // Step 5: check the documents against the order and the attestation, then release the balance.
  private async releaseBalance(orderId: Hex, record: OrderRecord, now: bigint): Promise<AgentEvent> {
    const state = record.state;
    const { po } = record;
    if (!same(po.documentVerifier, this.deps.signer.address)) return { orderId, state, outcome: "waiting", reason: "NOT_DOCUMENT_VERIFIER" };
    if (now < record.shippedAt + po.disputeWindow) return { orderId, state, outcome: "waiting", reason: "DISPUTE_WINDOW" };

    const documents = this.deps.store.documents(orderId);
    const stored = this.deps.store.order(orderId);
    if (!documents || !stored) return { orderId, state, outcome: "waiting", reason: "DOCUMENTS_PENDING" };
    // The escrow keeps only the attestation hash: the attestation itself must be the one it accepted
    const shipment = this.deps.store.shipment(orderId);
    if (!shipment || structHash("ShipmentAttestation", shipment.attestation) !== record.attestationHash) {
      return { orderId, state, outcome: "held", hold: "retenida", reason: "ATTESTATION_UNKNOWN" };
    }
    const importerTaxId = this.deps.store.registry().parties.find((p) => same(p.address, po.importer))?.taxId;
    if (!importerTaxId) return { orderId, state, outcome: "held", hold: "retenida", reason: "IMPORTER_NOT_REGISTERED" };

    const { evaluation, evidence } = await issueDocumentPdr({
      order: po,
      attestation: shipment.attestation,
      extractions: documents.extractions,
      context: { now: Number(now), fileHashes: documents.fileHashes, terms: stored.terms, importerTaxId, decisionTtlSeconds: this.config.decisionTtlSeconds },
      policy: this.config.policy,
      domain: keelDomain(this.config.chainId, this.config.escrow),
      signer: this.deps.signer,
    });
    if (!evidence) {
      // The importer can still release by hand (BalanceApproval) or open a dispute
      return { orderId, state, outcome: "held", hold: "retenida", reason: "DOCUMENTS_DO_NOT_CONFORM", rules: evaluation.rules.filter((r) => !r.ok) };
    }
    const call = releaseBalanceCall(this.config.escrow, evidence.decision as never, evidence.signature);
    const event = await this.execute(orderId, state, "releaseBalance", call, () => saveEvidence(this.config.evidenceDir, evidence));
    return { ...event, pdrHash: evidence.pdrHash };
  }
}
