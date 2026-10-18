// Agent service (T2.11): joins ingest, engine, PDR and relayer for one importer Safe.
// Each tick reads every stored order from the escrow and takes at most one step per order.
// The chain is the source of truth and the agent keeps no state besides the notices already
// sent, so a repeated tick never sends twice: the escrow state moved, or the simulation fails.
// The relayer gains no authority here: without a valid PDR or signature the gate and the
// escrow revert, and every call is simulated before it is sent (T2.5). Besides its own steps
// (fund, shipment, release, refund) it relays the signatures people stored for an order: both
// parties' signatures to open it, the importer's BalanceApproval, a cancel of both parties and
// the arbiter's resolution. Those carry the authority; the agent only pays the gas.
import { type EscrowState, type FundIntent, type HoldState, type Hex, keelDomain } from "@keel/schemas";
import { structHash } from "@keel/schemas/hash";
import type { DocumentRuleResult } from "../documents";
import { evaluateFunding, type FundingContext } from "../funding";
import type { RuleResult } from "../index";
import { buildPolicyDecision, issueDocumentPdr, type PdrEvidence, type PolicySigner, type SignedPolicyDecision, saveEvidence, signPolicyDecision } from "../pdr";
import { type TradePolicy, tradePolicyHash } from "../policy";
import {
  approveBalanceCall,
  type Call,
  cancelCall,
  cancelNonceOfCall,
  decodeCancelNonce,
  decodeOrderOf,
  decodeRefundGrace,
  type OrderRecord,
  openCall,
  orderOfCall,
  refundCall,
  refundGraceCall,
  releaseBalanceCall,
  resolveCall,
  submitShipmentCall,
} from "./escrow";
import type { AgentStore, StoredClosing, StoredOrder } from "./store";

// What the agent needs from the chain. The relayer is the sender of every call.
export interface AgentChain {
  // Timestamp of the latest block, seconds
  now(): Promise<bigint>;
  // eth_call; throws CallReverted
  call(call: Call): Promise<Hex>;
  // Sends and waits for the receipt
  send(call: Call): Promise<{ hash: Hex; status: "success" | "reverted" }>;
  // Timestamp of the block with the OrderFunded log of the order, or undefined if none was found.
  // The escrow keeps the funding time private and rejects an on board date before it.
  fundedAt(escrow: Hex, orderId: Hex): Promise<bigint | undefined>;
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

// The last four relay signatures people gave (both parties, the importer, both parties, the
// arbiter): the agent only submits them, the escrow checks them.
export type AgentAction = "fund" | "submitShipment" | "releaseBalance" | "refundAfterDeadline" | "open" | "approveBalance" | "cancel" | "resolve";

// Reason codes for the bot templates (Area 4), never free text.
export type AgentReason =
  | "SENT"
  | "GATE_NOT_DEPLOYED"
  | "FUNDING_BLOCKED"
  | "SUPPLIER_NEW"
  | "COSIGNATURE_NEEDED"
  | "AWAITING_SHIPMENT"
  | "DEADLINE_SOON"
  // The attestation arrived so close to the refund that the shipment could be mined after it
  | "SHIPMENT_CUTOFF"
  // The carrier attested an on board date before the order was funded: it must re-sign
  | "ON_BOARD_BEFORE_FUNDING"
  | "SIMULATION_REVERTED"
  | "DISPUTE_WINDOW"
  | "DOCUMENTS_PENDING"
  | "ATTESTATION_UNKNOWN"
  | "IMPORTER_NOT_REGISTERED"
  | "NOT_DOCUMENT_VERIFIER"
  | "DOCUMENTS_DO_NOT_CONFORM"
  // The importer signed a cancel of an OPEN order and the exporter has not yet: no deposit meanwhile
  | "CANCEL_PENDING"
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
  // Seconds kept between sending a shipment and the first second of the refund, so a shipment
  // simulated just before it is not mined after it and reverts with DeadlinePassed
  shipmentMarginSeconds?: number;
}

export const DEADLINE_REMINDER_DAYS: readonly number[] = [5, 3, 1];
// Covers the wait for inclusion on the closed network; the demo refundGrace is 60 s, production 1 day
export const SHIPMENT_MARGIN_SECONDS = 120;
const DAY = 24n * 60n * 60n;

export interface AgentDeps {
  chain: AgentChain;
  store: AgentStore;
  // Policy key, in its own process in production (T2.7). Also the document verifier in the
  // prototype: one key signs the funding PDR and the DocumentDecision (prototype risk in
  // docs/arquitectura/servicio-del-agente.md).
  signer: PolicySigner;
  gate?: FundingGatePort;
  // Held operations and notices go to the bot (Area 4). Each one is sent once, with the order
  // as the escrow holds it when it was read (absent when the read failed).
  notify?: (event: AgentEvent, record?: OrderRecord) => void;
  // Where a PDR's evidence is kept. Awaited before the call that carries the PDR is sent, so a
  // PDR never reaches the chain without its evidence (principle 6): if saving fails the order
  // fails this pass and nothing is sent. Default: a file in `evidenceDir` (evidence/pdr/).
  saveEvidence?: (evidence: PdrEvidence) => Promise<void>;
}

const same = (a: Hex, b: Hex) => a.toLowerCase() === b.toLowerCase();

export class Agent {
  private readonly notified = new Set<string>();
  private refundGrace?: bigint;
  // Funding time per order: fixed once the order is funded
  private readonly fundedAt = new Map<Hex, bigint>();

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
        if (record.state === "NONE") {
          // Not on chain yet: the escrow holds no importer, so the stored order says whose it is.
          // Without both signatures someone else opens it (the app, a party): nothing to report.
          const stored = this.openable(orderId);
          if (!stored) continue;
          event = await this.open(orderId, stored);
        } else {
          if (!same(record.po.importer, this.config.safe)) continue;
          event = await this.step(orderId, record, now);
        }
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

  // Signatures people gave after the order was opened come first in each state: they are the
  // parties' (or the arbiter's) explicit decision, and the escrow checks every one of them.
  //   OPEN, ADVANCE_PAID  a cancel both parties signed for the current cancelNonceOf
  //   SHIPPED             the importer's BalanceApproval, before the agent's own release: it waives
  //                       the dispute window and needs no documents, so waiting for them would
  //                       only delay what the importer already authorized
  //   DISPUTED            a cancel of both parties, then the arbiter's resolution
  private async step(orderId: Hex, record: OrderRecord, now: bigint): Promise<AgentEvent> {
    const state = record.state;
    const closing = this.deps.store.order(orderId)?.closing;
    switch (state) {
      case "OPEN":
        return (await this.cancelIfSigned(orderId, record, closing)) ?? this.fund(orderId, record, now);
      case "ADVANCE_PAID":
        return (await this.cancelIfSigned(orderId, record, closing)) ?? this.shipmentOrRefund(orderId, record, now);
      case "SHIPPED": {
        const approval = closing?.balanceApproval;
        // An approval of another attestation can never pass the escrow: the agent's path goes on
        if (approval && same(approval.attestationHash, record.attestationHash)) {
          return this.execute(orderId, state, "approveBalance", approveBalanceCall(this.config.escrow, orderId, approval.sigImporter));
        }
        return this.releaseBalance(orderId, record, now);
      }
      case "DISPUTED": {
        const cancelled = await this.cancelIfSigned(orderId, record, closing);
        if (cancelled) return cancelled;
        const r = closing?.resolution;
        if (r) return this.execute(orderId, state, "resolve", resolveCall(this.config.escrow, orderId, r.toImporter, r.toExporter, r.sigArbiter));
        // Without a signed resolution or cancel, the arbiter or both parties move the funds
        return { orderId, state, outcome: "waiting", reason: "NOTHING_TO_DO" };
      }
      default:
        // Final states
        return { orderId, state, outcome: "waiting", reason: "NOTHING_TO_DO" };
    }
  }

  // A stored order the agent may open: both signatures, and this Safe as the importer
  private openable(orderId: Hex): StoredOrder | null {
    const stored = this.deps.store.order(orderId);
    if (!stored?.sigImporter || !stored.sigExporter) return null;
    if (!same(stored.order.orderId, orderId) || !same(stored.order.importer, this.config.safe)) return null;
    return stored;
  }

  // Step 1: open the order both parties signed. The escrow checks the signatures and the order id.
  private open(orderId: Hex, stored: StoredOrder): Promise<AgentEvent> {
    return this.execute(orderId, "NONE", "open", openCall(this.config.escrow, stored.order, stored.sigImporter!, stored.sigExporter!));
  }

  // The cancel is sent only for the cancelNonceOf the escrow holds now: a cancel signed in an
  // earlier state can never pass, so the order goes on with its normal step and the parties sign
  // again. While only the importer signed an OPEN order, the deposit waits: funding would put the
  // money in an escrow the importer is leaving. After the deposit nothing waits for the exporter's
  // signature: the shipment and the refund protect one party each.
  private async cancelIfSigned(orderId: Hex, record: OrderRecord, closing: StoredClosing | undefined): Promise<AgentEvent | undefined> {
    const cancel = closing?.cancel;
    if (!cancel?.sigImporter) return undefined;
    const current = decodeCancelNonce(await this.deps.chain.call(cancelNonceOfCall(this.config.escrow, orderId)));
    if (cancel.cancelNonce !== current) return undefined;
    if (!cancel.sigExporter) return record.state === "OPEN" ? { orderId, state: record.state, outcome: "waiting", reason: "CANCEL_PENDING" } : undefined;
    return this.execute(orderId, record.state, "cancel", cancelCall(this.config.escrow, orderId, cancel.sigImporter, cancel.sigExporter));
  }

  private async persist(evidence: PdrEvidence): Promise<void> {
    if (this.deps.saveEvidence) await this.deps.saveEvidence(evidence);
    else saveEvidence(this.config.evidenceDir, evidence);
  }

  // Simulate, then send. A call that would revert is held with its revert name and no gas is spent.
  // `before` runs between the two and is awaited: what it keeps (the evidence) exists before the send.
  private async execute(orderId: Hex, state: EscrowState, action: AgentAction, call: Call, before?: () => Promise<void>): Promise<AgentEvent> {
    try {
      await this.deps.chain.call(call);
    } catch (e) {
      if (!(e instanceof CallReverted)) throw e;
      return { orderId, state, outcome: "held", hold: "retenida", reason: "SIMULATION_REVERTED", action, revert: e.reason };
    }
    await before?.();
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
    // A new supplier waits for out of band verification and for the Safe to queue it in the gate
    // registries (queueSupplier), where it counts after configDelay unless vetoed (T4.1)
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
      await this.persist(evidence);
      return { orderId, state, outcome: "held", hold: "en_aprobacion", reason: "COSIGNATURE_NEEDED", rules: failing, pdrHash: signed.pdrHash, cosign: { pdrHash: signed.pdrHash } };
    }
    const event = await this.execute(orderId, state, "fund", gate.executeCall(intent, signed), () => this.persist(evidence));
    return { ...event, pdrHash: signed.pdrHash };
  }

  // Steps 4 and 6: present the carrier attestation, or refund once the deadline and grace passed.
  private async shipmentOrRefund(orderId: Hex, record: OrderRecord, now: bigint): Promise<AgentEvent> {
    const state = record.state;
    this.refundGrace ??= decodeRefundGrace(await this.deps.chain.call(refundGraceCall(this.config.escrow)));
    // The comparison of the escrow: from this second on, submitShipment reverts and the refund is due
    const refundFrom = record.po.shipmentDeadline + this.refundGrace;
    if (now > refundFrom) {
      return this.execute(orderId, state, "refundAfterDeadline", refundCall(this.config.escrow, orderId));
    }
    const shipment = this.deps.store.shipment(orderId);
    if (shipment) {
      const margin = BigInt(this.config.shipmentMarginSeconds ?? SHIPMENT_MARGIN_SECONDS);
      // Too close to the refund: the transaction could be mined after it. The refund runs once due.
      if (now + margin > refundFrom) return { orderId, state, outcome: "held", hold: "bloqueada", reason: "SHIPMENT_CUTOFF", action: "submitShipment" };
      // The escrow rejects an on board date before the funding time (InvalidAttestation): name the cause
      const fundedAt = await this.fundingTime(orderId);
      if (fundedAt !== undefined && shipment.attestation.onBoardDate < fundedAt) {
        return { orderId, state, outcome: "held", hold: "bloqueada", reason: "ON_BOARD_BEFORE_FUNDING", action: "submitShipment" };
      }
      const event = await this.execute(orderId, state, "submitShipment", submitShipmentCall(this.config.escrow, shipment.attestation, shipment.sigCarrier));
      return event.outcome === "sent" ? event : { ...event, hold: "bloqueada" };
    }
    // One reminder per threshold: a tick that runs late skips to the nearest one, never repeats
    const left = record.po.shipmentDeadline > now ? (record.po.shipmentDeadline - now + DAY - 1n) / DAY : 0n;
    const daysLeft = Number(left);
    const reminder = [...(this.config.deadlineReminderDays ?? DEADLINE_REMINDER_DAYS)].sort((a, b) => a - b).find((d) => daysLeft <= d);
    if (reminder !== undefined) return { orderId, state, outcome: "notice", reason: "DEADLINE_SOON", daysLeft, reminder };
    return { orderId, state, outcome: "waiting", reason: "AWAITING_SHIPMENT" };
  }

  private async fundingTime(orderId: Hex): Promise<bigint | undefined> {
    const cached = this.fundedAt.get(orderId);
    if (cached !== undefined) return cached;
    const at = await this.deps.chain.fundedAt(this.config.escrow, orderId);
    if (at !== undefined) this.fundedAt.set(orderId, at);
    return at;
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
    const event = await this.execute(orderId, state, "releaseBalance", call, () => this.persist(evidence));
    return { ...event, pdrHash: evidence.pdrHash };
  }
}
