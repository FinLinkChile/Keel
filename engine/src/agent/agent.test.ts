import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EIP712_TYPES, type Hex, keelDomain, type OrderTerms, type PurchaseOrder, type ShipmentAttestation } from "@keel/schemas";
import { blNumberHash, bytes32Text, docsHash, requiredDocsHash, termsHash } from "@keel/schemas/hash";
import { encodeAbiParameters, encodeFunctionData, erc20Abi, keccak256, parseSignature, toBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DocumentExtractions } from "../documents";
import { tradePolicy, tradePolicyHash } from "../policy";
import { compile, createChain, RevertError } from "../testing/chain";
import { type ChainLog, loadEvidence, verdict, verifyEvidence } from "../verify";
import { Agent, type AgentChain, type AgentConfig, type AgentEvent, CallReverted, type FundingGatePort, SHIPMENT_MARGIN_SECONDS } from "./agent";
import { decodeOrderOf, orderFundedTopics, orderOfCall, submitShipmentCall } from "./escrow";
import { fundingCalldata, fundingGatePort, mockRolesAllowance } from "./gate";
import { FileStore, writeStoreFile } from "./store";

const word = (label: string): Hex => keccak256(toBytes(label));
const address = (n: number): Hex => `0x${n.toString(16).padStart(40, "0")}`;
const DAY = 24n * 3600n;
const T0 = 1_762_000_000n;
const ON_BOARD = T0 + 2n * DAY;
const DEADLINE = T0 + 10n * DAY;
const GRACE = 60n;
const TOTAL = 10_000_000_000n;
const FILES = [word("bl.pdf"), word("invoice.pdf")];

const importerOwner = privateKeyToAccount(word("importer owner"));
const exporter = privateKeyToAccount(word("exporter"));
const carrier = privateKeyToAccount(word("carrier"));
const forger = privateKeyToAccount(word("not the carrier"));
const policySigner = privateKeyToAccount(word("keel policy and document verifier"));
const RELAYER = address(0x7e1a);
const ARBITER = address(0xa4b1);
const PAYOUT = address(0xb3);

const terms: OrderTerms = {
  orderNumber: "PO20260042",
  currency: "USD",
  invoiceAmountMinor: 1_000_000n,
  hsCodes: ["130231"],
  documentHash: word("order.pdf"),
};

const extractions = (over: Partial<DocumentExtractions["invoice"]> = {}): DocumentExtractions => ({
  transport: {
    doc_type: "BILL_OF_LADING",
    document_number: "EGLV123456789",
    on_board_date: Number(ON_BOARD) + 3600,
    port_of_loading: "CNSZX",
    port_of_discharge: "CLVAP",
    hidden_text_detected: false,
  },
  invoice: {
    invoice_number: "INV20261001",
    order_number: "PO20260042",
    amount_minor: 1_000_000,
    currency: "USD",
    incoterm: "CIF",
    importer_tax_id: "76123456K",
    hs_code: "130231",
    mentions_account_change: false,
    hidden_text_detected: false,
    ...over,
  },
});

describe("agent service against the real TradeEscrow (T2.11)", () => {
  let artifacts: ReturnType<typeof compile>;
  let chain: Awaited<ReturnType<typeof createChain>>;
  let escrow: Hex;
  let usdc: Hex;
  let safe: Hex;
  let dir: string;
  let sent: { call: { to: Hex; data: Hex }; logs: ChainLog[] }[];
  let notices: AgentEvent[];

  beforeAll(() => {
    artifacts = compile(["src/TradeEscrow.sol", "src/FundingGate.sol", "test/mocks/Mocks.sol", "test/mocks/TradeMocks.sol"]);
  }, 120_000);

  beforeEach(async () => {
    chain = await createChain(artifacts);
    usdc = await chain.deploy("MockUSDC", [], RELAYER);
    escrow = await chain.deploy("TradeEscrow", [usdc, GRACE], RELAYER);
    // A Safe that signs with ERC-1271 and runs modules, so Roles can execute the deposit
    safe = await chain.deploy("MockModuleSafe1271", [importerOwner.address], RELAYER);
    dir = mkdtempSync(join(tmpdir(), "keel-agent-"));
    sent = [];
    notices = [];
    writeStoreFile(dir, ["registry.json"], {
      parties: [{ address: safe, taxId: "76123456K" }, { address: exporter.address }, { address: carrier.address }, { address: ARBITER }, { address: policySigner.address }],
      history: { [exporter.address]: [9_000_000_000n, 11_000_000_000n] },
    });
  });

  const domain = () => keelDomain(1, escrow);

  // The relayer's view of the chain: every call simulated first, every send recorded
  const agentChain = (): AgentChain => ({
    now: async () => chain.time(),
    call: async (c) => {
      try {
        return await chain.simulate(RELAYER, c.to, c.data);
      } catch (e) {
        if (e instanceof RevertError) throw new CallReverted(e.errorName);
        throw e;
      }
    },
    send: async (c) => {
      const hash = word(`tx ${sent.length}`);
      try {
        sent.push({ call: c, logs: await chain.sendRaw(RELAYER, c.to, c.data) });
        return { hash, status: "success" };
      } catch {
        return { hash, status: "reverted" };
      }
    },
    // eth_getLogs of OrderFunded for the order, then the time of its block
    fundedAt: async (to, orderId) => {
      const topics = orderFundedTopics(orderId);
      const log = chain.logs().find((l) => l.address.toLowerCase() === to.toLowerCase() && topics.every((t, i) => l.topics[i] === t));
      return log?.timestamp;
    },
  });

  const agent = (over: Partial<AgentConfig> = {}, gate?: FundingGatePort) =>
    new Agent(
      { chainId: 1, escrow, safe, policy: tradePolicy(word("roles-config-v1")), decisionTtlSeconds: 3600, evidenceDir: join(dir, "evidence"), ...over },
      { chain: agentChain(), store: new FileStore(dir), signer: policySigner, gate, notify: (e) => notices.push(e) },
    );

  const recordOf = async (orderId: Hex) => decodeOrderOf(await chain.simulate(RELAYER, escrow, orderOfCall(escrow, orderId).data));
  const stateOf = async (orderId: Hex) => (await recordOf(orderId)).state;
  const balanceOf = (who: Hex) => chain.read<bigint>("MockUSDC", usdc, "balanceOf", [who]);
  const asSafe = (to: Hex, data: Hex) => chain.send("MockModuleSafe1271", safe, "exec", [to, data], importerOwner.address);

  // Both parties sign and open the order; the Safe signs with ERC-1271
  async function openOrder(over: Partial<PurchaseOrder> = {}): Promise<PurchaseOrder> {
    const nonce = 7n;
    const order: PurchaseOrder = {
      orderId: keccak256(encodeAbiParameters([{ type: "address" }, { type: "address" }, { type: "uint256" }], [safe, exporter.address, nonce])),
      importer: safe,
      exporter: exporter.address,
      payoutAddress: PAYOUT,
      token: usdc,
      totalAmount: TOTAL,
      advanceBps: 5000,
      shipmentDeadline: DEADLINE,
      disputeWindow: 0n,
      carrier: carrier.address,
      arbiter: ARBITER,
      documentVerifier: policySigner.address,
      incoterm: bytes32Text("CIF"),
      termsHash: termsHash(terms),
      requiredDocsHash: requiredDocsHash(["BILL_OF_LADING", "COMMERCIAL_INVOICE"]),
      nonce,
      ...over,
    };
    const typed = { domain: domain(), types: { PurchaseOrder: EIP712_TYPES.PurchaseOrder }, primaryType: "PurchaseOrder" as const, message: order };
    const { r, s, v } = parseSignature(await importerOwner.signTypedData(typed));
    const sigImporter = encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }, { type: "uint8" }], [r, s, Number(v)]);
    await chain.send("TradeEscrow", escrow, "open", [order, sigImporter, await exporter.signTypedData(typed)], RELAYER);
    writeStoreFile(dir, ["orders", order.orderId, "order.json"], { order, terms });
    return order;
  }

  // Stands in for the Trade gate of Area 1: the Safe approves the exact total and funds
  async function fundOrder(order: PurchaseOrder) {
    await chain.send("MockUSDC", usdc, "mint", [safe, TOTAL], RELAYER);
    await asSafe(usdc, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [escrow, TOTAL] }));
    await asSafe(escrow, chain.calldata("TradeEscrow", "fund", [order.orderId]));
  }

  async function storeShipment(order: PurchaseOrder, signer = carrier, onBoardDate = ON_BOARD) {
    const attestation: ShipmentAttestation = {
      orderId: order.orderId,
      blNumberHash: blNumberHash(order.carrier, "EGLV123456789"),
      onBoardDate,
      portOfLoading: bytes32Text("CNSZX"),
      docsHash: docsHash(FILES),
    };
    const sigCarrier = await signer.signTypedData({
      domain: domain(),
      types: { ShipmentAttestation: EIP712_TYPES.ShipmentAttestation },
      primaryType: "ShipmentAttestation",
      message: attestation,
    });
    writeStoreFile(dir, ["orders", order.orderId, "shipment.json"], { attestation, sigCarrier });
    return { attestation, sigCarrier };
  }

  const storeDocuments = (order: PurchaseOrder, docs = extractions()) =>
    writeStoreFile(dir, ["orders", order.orderId, "documents.json"], { extractions: docs, fileHashes: FILES });

  it("takes an order from the shipment to the balance and its PDR verifies against the transaction", async () => {
    const order = await openOrder();
    await fundOrder(order);
    await storeShipment(order);
    chain.setTime(ON_BOARD + DAY);
    const keel = agent();

    const [shipped] = await keel.tick();
    expect(shipped).toMatchObject({ outcome: "sent", action: "submitShipment", status: "success" });
    expect(await stateOf(order.orderId)).toBe("SHIPPED");

    expect((await keel.tick())[0]).toMatchObject({ outcome: "waiting", reason: "DOCUMENTS_PENDING" });

    storeDocuments(order);
    const [released] = await keel.tick();
    expect(released).toMatchObject({ outcome: "sent", action: "releaseBalance", status: "success" });
    expect(await stateOf(order.orderId)).toBe("SETTLED");
    expect(await balanceOf(PAYOUT)).toBe(TOTAL);

    // The evidence the agent saved verifies against the logs of the release
    const evidence = loadEvidence(join(dir, "evidence"), released!.pdrHash!)!;
    const checks = await verifyEvidence(evidence, { chainId: 1, status: "success", logs: sent.at(-1)!.logs });
    expect(verdict(checks)).toBe("MATCH");
    expect(checks.find((c) => c.check === "event order")).toMatchObject({ outcome: "match" });

    // A repeated tick sends nothing: the order is final
    expect((await keel.tick())[0]).toMatchObject({ outcome: "waiting", reason: "NOTHING_TO_DO" });
    expect(sent).toHaveLength(2);
  });

  it("documents that do not match the order hold the balance, notify once and send nothing", async () => {
    const order = await openOrder();
    await fundOrder(order);
    await storeShipment(order);
    chain.setTime(ON_BOARD + DAY);
    const keel = agent();
    await keel.tick();

    storeDocuments(order, extractions({ mentions_account_change: true }));
    const [held] = await keel.tick();
    await keel.tick();
    expect(held).toMatchObject({ outcome: "held", hold: "retenida", reason: "DOCUMENTS_DO_NOT_CONFORM" });
    expect(held!.rules).toEqual([{ rule: "account-change", ok: false, reason: "ACCOUNT_CHANGE_MENTIONED" }]);
    expect(notices.filter((n) => n.reason === "DOCUMENTS_DO_NOT_CONFORM")).toHaveLength(1);
    expect(await stateOf(order.orderId)).toBe("SHIPPED");
    expect(sent).toHaveLength(1);
  });

  it("waits for the dispute window before releasing the balance", async () => {
    const order = await openOrder({ disputeWindow: 120n });
    await fundOrder(order);
    await storeShipment(order);
    storeDocuments(order);
    chain.setTime(ON_BOARD + DAY);
    const keel = agent();
    await keel.tick();

    expect((await keel.tick())[0]).toMatchObject({ outcome: "waiting", reason: "DISPUTE_WINDOW" });
    chain.setTime(ON_BOARD + DAY + 120n);
    expect((await keel.tick())[0]).toMatchObject({ outcome: "sent", action: "releaseBalance" });
  });

  it("a forged attestation is held at simulation and costs no gas", async () => {
    const order = await openOrder();
    await fundOrder(order);
    await storeShipment(order, forger);
    chain.setTime(ON_BOARD + DAY);

    const [held] = await agent().tick();
    expect(held).toMatchObject({ outcome: "held", hold: "bloqueada", reason: "SIMULATION_REVERTED", revert: "BadCarrierSignature" });
    expect(sent).toHaveLength(0);
    expect(await stateOf(order.orderId)).toBe("ADVANCE_PAID");
  });

  it("warns as the deadline nears and refunds the importer once the deadline and the grace pass", async () => {
    const order = await openOrder();
    await fundOrder(order);
    const keel = agent();

    chain.setTime(DEADLINE - 6n * DAY);
    expect((await keel.tick())[0]).toMatchObject({ outcome: "waiting", reason: "AWAITING_SHIPMENT" });
    chain.setTime(DEADLINE - 5n * DAY);
    expect((await keel.tick())[0]).toMatchObject({ outcome: "notice", reason: "DEADLINE_SOON", daysLeft: 5, reminder: 5 });
    chain.setTime(DEADLINE - 4n * DAY);
    await keel.tick();
    // A late tick skips to the nearest reminder
    chain.setTime(DEADLINE - DAY + 1n);
    expect((await keel.tick())[0]).toMatchObject({ outcome: "notice", reason: "DEADLINE_SOON", daysLeft: 1, reminder: 1 });
    chain.setTime(DEADLINE + GRACE);
    expect((await keel.tick())[0]).toMatchObject({ outcome: "notice", reason: "DEADLINE_SOON", daysLeft: 0, reminder: 1 });
    expect(sent).toHaveLength(0);

    chain.setTime(DEADLINE + GRACE + 1n);
    expect((await keel.tick())[0]).toMatchObject({ outcome: "sent", action: "refundAfterDeadline" });
    expect(await stateOf(order.orderId)).toBe("REFUNDED");
    expect(await balanceOf(safe)).toBe(TOTAL / 2n);
    expect(notices.filter((n) => n.reason === "DEADLINE_SOON").map((n) => n.reminder)).toEqual([5, 1]);
  });

  it("does not send a shipment that could be mined after the refund is due, and refunds once it is", async () => {
    const order = await openOrder();
    await fundOrder(order);
    const keel = agent();
    // Before the cutoff the importer is already warned that the attestation is missing
    chain.setTime(DEADLINE - DAY + 1n);
    expect((await keel.tick())[0]).toMatchObject({ outcome: "notice", reason: "DEADLINE_SOON", reminder: 1 });

    // The attestation arrives inside the margin: the escrow would still accept it now, not surely when mined
    await storeShipment(order);
    chain.setTime(DEADLINE + GRACE - BigInt(SHIPMENT_MARGIN_SECONDS) + 1n);
    const [held] = await keel.tick();
    expect(held).toMatchObject({ outcome: "held", hold: "bloqueada", reason: "SHIPMENT_CUTOFF", action: "submitShipment" });
    expect(notices.filter((n) => n.reason === "SHIPMENT_CUTOFF")).toHaveLength(1);
    expect(sent).toHaveLength(0);

    // From the first second of the refund the escrow rejects the shipment and the agent refunds
    chain.setTime(DEADLINE + GRACE + 1n);
    const { attestation, sigCarrier } = await storeShipment(order);
    await expect(chain.simulate(RELAYER, escrow, submitShipmentCall(escrow, attestation, sigCarrier).data)).rejects.toThrow("DeadlinePassed");
    expect((await keel.tick())[0]).toMatchObject({ outcome: "sent", action: "refundAfterDeadline", status: "success" });
    expect(await stateOf(order.orderId)).toBe("REFUNDED");
  });

  it("the shipment margin is inclusive and configurable", async () => {
    const order = await openOrder();
    await fundOrder(order);
    await storeShipment(order);
    chain.setTime(DEADLINE + GRACE - 60n);
    expect((await agent().tick())[0]).toMatchObject({ outcome: "held", reason: "SHIPMENT_CUTOFF" });
    expect((await agent({ shipmentMarginSeconds: 60 }).tick())[0]).toMatchObject({ outcome: "sent", action: "submitShipment", status: "success" });
    expect(await stateOf(order.orderId)).toBe("SHIPPED");
  });

  it("an on board date before the funding time is held with its own reason until the carrier re-signs", async () => {
    const order = await openOrder();
    const fundedAt = ON_BOARD + 3600n;
    chain.setTime(fundedAt);
    await fundOrder(order);
    await storeShipment(order);
    chain.setTime(fundedAt + DAY);

    const [held] = await agent().tick();
    expect(held).toMatchObject({ outcome: "held", hold: "bloqueada", reason: "ON_BOARD_BEFORE_FUNDING", action: "submitShipment" });
    expect(sent).toHaveLength(0);
    // The real escrow agrees: without the pre-check the simulation reverts with InvalidAttestation
    const blind = new Agent(
      { chainId: 1, escrow, safe, policy: tradePolicy(word("roles-config-v1")), decisionTtlSeconds: 3600, evidenceDir: join(dir, "evidence") },
      { chain: { ...agentChain(), fundedAt: async () => undefined }, store: new FileStore(dir), signer: policySigner },
    );
    expect((await blind.tick())[0]).toMatchObject({ outcome: "held", reason: "SIMULATION_REVERTED", revert: "InvalidAttestation" });

    // Re-signed with the funding second as on board date: accepted
    await storeShipment(order, carrier, fundedAt);
    expect((await agent().tick())[0]).toMatchObject({ outcome: "sent", action: "submitShipment", status: "success" });
    expect(await stateOf(order.orderId)).toBe("SHIPPED");
  });

  it("does not fund while the Trade gate does not exist", async () => {
    await openOrder();
    expect((await agent().tick())[0]).toMatchObject({ outcome: "waiting", reason: "GATE_NOT_DEPLOYED" });
  });

  it("ignores orders of another Safe", async () => {
    await openOrder();
    expect(await agent({ safe: address(0x5afe) }).tick()).toEqual([]);
  });

  it("a broken data file fails that order only", async () => {
    const order = await openOrder();
    await fundOrder(order);
    await storeShipment(order);
    chain.setTime(ON_BOARD + DAY);
    const keel = agent();
    await keel.tick();
    writeFileSync(join(dir, "orders", order.orderId, "documents.json"), "{ not json");
    expect((await keel.tick())[0]).toMatchObject({ outcome: "failed", reason: "AGENT_ERROR" });
  });

  describe("funding through the FundingGate of Area 1", () => {
    const AGENT = word("AGENT");
    const AGENT_COSIGNED = word("AGENT_COSIGNED");
    const CONFIG_DELAY = 120n;
    const cosigner = privateKeyToAccount(word("cosigner"));
    let gate: Hex;
    let roles: Hex;

    // The Safe enables Roles, gives the AGENT role to the gate with a weekly allowance and queues
    // its trusted supplier and third parties, which count once the config delay passes
    async function deployGate({ supplier = true, carrierTrusted = true, allowance = 50_000_000_000n } = {}) {
      roles = await chain.deploy("MockTradeRoles", [safe, usdc, escrow], RELAYER);
      const policyHash = tradePolicyHash(tradePolicy(word("roles-config-v1")));
      gate = await chain.deploy(
        "FundingGate",
        [safe, roles, escrow, AGENT, AGENT_COSIGNED, policySigner.address, cosigner.address, policyHash, CONFIG_DELAY],
        RELAYER,
      );
      await chain.send("MockModuleSafe1271", safe, "enableModule", [roles], importerOwner.address);
      await asSafe(roles, chain.calldata("MockTradeRoles", "assignRole", [AGENT, gate, true]));
      await asSafe(roles, chain.calldata("MockTradeRoles", "setAllowance", [AGENT, allowance, 7n * DAY]));
      if (supplier) await asSafe(gate, chain.calldata("FundingGate", "queueSupplier", [exporter.address, PAYOUT]));
      if (carrierTrusted) await asSafe(gate, chain.calldata("FundingGate", "queueThirdParty", [carrier.address, 1]));
      await asSafe(gate, chain.calldata("FundingGate", "queueThirdParty", [ARBITER, 2]));
      await asSafe(gate, chain.calldata("FundingGate", "queueThirdParty", [policySigner.address, 4]));
      await chain.send("MockUSDC", usdc, "mint", [safe, TOTAL], RELAYER);
      chain.setTime(chain.time() + CONFIG_DELAY);
    }

    const port = (): FundingGatePort => fundingGatePort(agentChain(), gate, mockRolesAllowance(agentChain(), roles, AGENT));

    it("takes an order from the deposit to the balance with no manual step, and the deposit PDR verifies", async () => {
      await deployGate();
      const order = await openOrder();
      const keel = agent({}, port());

      const [funded] = await keel.tick();
      expect(funded).toMatchObject({ outcome: "sent", action: "fund", status: "success" });
      expect(await stateOf(order.orderId)).toBe("ADVANCE_PAID");
      expect(await balanceOf(PAYOUT)).toBe(TOTAL / 2n);

      const evidence = loadEvidence(join(dir, "evidence"), funded!.pdrHash!)!;
      expect(verdict(await verifyEvidence(evidence, { chainId: 1, status: "success", logs: sent[0]!.logs }))).toBe("MATCH");
      // One nonce per order version, marked used by the gate: a retry can never fund twice
      const nonce = BigInt((await recordOf(order.orderId)).orderHash);
      expect(evidence.intent).toMatchObject({ nonce });
      expect(await chain.read("FundingGate", gate, "nonceUsed", [nonce])).toBe(true);

      await storeShipment(order);
      chain.setTime(ON_BOARD + DAY);
      expect((await keel.tick())[0]).toMatchObject({ outcome: "sent", action: "submitShipment", status: "success" });
      storeDocuments(order);
      expect((await keel.tick())[0]).toMatchObject({ outcome: "sent", action: "releaseBalance", status: "success" });
      expect(await stateOf(order.orderId)).toBe("SETTLED");
      expect(await balanceOf(PAYOUT)).toBe(TOTAL);
    });

    it("the deposit calldata the PDR binds is the one the gate executes", async () => {
      await deployGate();
      const intent = { orderId: word("order"), orderHash: word("order hash"), escrow, token: usdc, amount: TOTAL, deadline: T0 + 900n, nonce: 1n };
      const [, , hash] = await chain.read<[Hex, Hex, Hex]>("FundingGate", gate, "fundingCalldataOf", [intent]);
      expect(keccak256(fundingCalldata(intent))).toBe(hash);
    });

    it("a payout pair the Safe did not approve is a new supplier: queued, nothing sent", async () => {
      await deployGate({ supplier: false });
      await openOrder();
      expect((await agent({}, port()).tick())[0]).toMatchObject({ outcome: "held", hold: "cambio_en_cola", reason: "SUPPLIER_NEW" });
      expect(sent).toHaveLength(0);
    });

    it("an approved supplier still inside its config delay is not known yet", async () => {
      await deployGate({ supplier: false });
      await asSafe(gate, chain.calldata("FundingGate", "queueSupplier", [exporter.address, PAYOUT]));
      await openOrder();
      expect((await agent({}, port()).tick())[0]).toMatchObject({ outcome: "held", reason: "SUPPLIER_NEW" });
      expect(sent).toHaveLength(0);
      chain.setTime(chain.time() + CONFIG_DELAY);
      expect((await agent({}, port()).tick())[0]).toMatchObject({ outcome: "sent", action: "fund", status: "success" });
    });

    it("a carrier the Safe does not trust blocks the deposit before the gate would revert", async () => {
      await deployGate({ carrierTrusted: false });
      await openOrder();
      const [held] = await agent({}, port()).tick();
      expect(held).toMatchObject({ outcome: "held", hold: "bloqueada", reason: "FUNDING_BLOCKED" });
      expect(held!.rules).toContainEqual({ rule: "known-supplier", tier: 4, reason: "PARTY_NOT_REGISTERED" });
      expect(sent).toHaveLength(0);
    });

    it("an order over the agent allowance waits for the cosigner with its PDR ready", async () => {
      await deployGate({ allowance: TOTAL - 1n });
      await openOrder();
      const [held] = await agent({}, port()).tick();
      expect(held).toMatchObject({ outcome: "held", hold: "en_aprobacion", reason: "COSIGNATURE_NEEDED" });
      expect(loadEvidence(join(dir, "evidence"), held!.cosign!.pdrHash)).not.toBeNull();
      expect(sent).toHaveLength(0);
    });
  });
});

