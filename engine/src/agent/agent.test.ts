import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EIP712_TYPES, type Hex, keelDomain, type OrderTerms, type PurchaseOrder, type ShipmentAttestation } from "@keel/schemas";
import { blNumberHash, bytes32Text, docsHash, requiredDocsHash, termsHash } from "@keel/schemas/hash";
import { encodeAbiParameters, encodeFunctionData, erc20Abi, keccak256, parseSignature, toBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DocumentExtractions } from "../documents";
import { tradePolicy } from "../policy";
import { compile, createChain, RevertError } from "../testing/chain";
import { type ChainLog, loadEvidence, verdict, verifyEvidence } from "../verify";
import { Agent, type AgentChain, type AgentConfig, type AgentEvent, CallReverted, type FundingGatePort } from "./agent";
import { decodeOrderOf, orderOfCall } from "./escrow";
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
    artifacts = compile(["src/TradeEscrow.sol", "test/mocks/Mocks.sol", "test/mocks/TradeMocks.sol"]);
  }, 120_000);

  beforeEach(async () => {
    chain = await createChain(artifacts);
    usdc = await chain.deploy("MockUSDC", [], RELAYER);
    escrow = await chain.deploy("TradeEscrow", [usdc, GRACE], RELAYER);
    safe = await chain.deploy("MockSafe1271", [importerOwner.address], RELAYER);
    dir = mkdtempSync(join(tmpdir(), "keel-agent-"));
    sent = [];
    notices = [];
    writeStoreFile(dir, ["registry.json"], {
      parties: [{ address: safe, taxId: "76123456K" }, { address: exporter.address }, { address: carrier.address }, { address: ARBITER }, { address: policySigner.address }],
      knownSuppliers: [{ exporter: exporter.address, payoutAddress: PAYOUT }],
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
  });

  const agent = (over: Partial<AgentConfig> = {}, gate?: FundingGatePort) =>
    new Agent(
      { chainId: 1, escrow, safe, policy: tradePolicy(word("roles-config-v1")), decisionTtlSeconds: 3600, evidenceDir: join(dir, "evidence"), ...over },
      { chain: agentChain(), store: new FileStore(dir), signer: policySigner, gate, notify: (e) => notices.push(e) },
    );

  const stateOf = async (orderId: Hex) => decodeOrderOf(await chain.simulate(RELAYER, escrow, orderOfCall(escrow, orderId).data)).state;
  const balanceOf = (who: Hex) => chain.read<bigint>("MockUSDC", usdc, "balanceOf", [who]);
  const asSafe = (to: Hex, data: Hex) => chain.send("MockSafe1271", safe, "exec", [to, data], importerOwner.address);

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

  async function storeShipment(order: PurchaseOrder, signer = carrier) {
    const attestation: ShipmentAttestation = {
      orderId: order.orderId,
      blNumberHash: blNumberHash(order.carrier, "EGLV123456789"),
      onBoardDate: ON_BOARD,
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

    chain.setTime(DEADLINE - DAY);
    expect((await keel.tick())[0]).toMatchObject({ outcome: "notice", reason: "DEADLINE_SOON" });
    chain.setTime(DEADLINE + GRACE);
    expect((await keel.tick())[0]).toMatchObject({ outcome: "notice", reason: "DEADLINE_SOON" });
    expect(sent).toHaveLength(0);

    chain.setTime(DEADLINE + GRACE + 1n);
    expect((await keel.tick())[0]).toMatchObject({ outcome: "sent", action: "refundAfterDeadline" });
    expect(await stateOf(order.orderId)).toBe("REFUNDED");
    expect(await balanceOf(safe)).toBe(TOTAL / 2n);
    expect(notices.filter((n) => n.reason === "DEADLINE_SOON")).toHaveLength(1);
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

  describe("funding through a gate port", () => {
    // A stand-in for the gate of Area 1: the agent only needs its reads and its exact call
    const gate = (): FundingGatePort => ({
      address: address(0x6a7e),
      allowance: async () => ({ token: usdc, remaining: 50_000_000_000n }),
      nonce: async () => 1n,
      safeCalldata: (intent) => encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [intent.escrow, intent.amount] }),
      executeCall: () => ({ to: address(0x6a7e), data: "0x" }),
    });

    it("a known supplier within limits gets a signed funding PDR that replays", async () => {
      await openOrder();
      const [funded] = await agent({}, gate()).tick();
      expect(funded).toMatchObject({ outcome: "sent", action: "fund" });
      const evidence = loadEvidence(join(dir, "evidence"), funded!.pdrHash!)!;
      expect(verdict(await verifyEvidence(evidence))).toBe("MATCH");
    });

    it("a new payout address is queued for verification and nothing is sent", async () => {
      writeStoreFile(dir, ["registry.json"], {
        parties: [{ address: safe }, { address: exporter.address }, { address: carrier.address }, { address: ARBITER }, { address: policySigner.address }],
        knownSuppliers: [],
        history: {},
      });
      await openOrder();
      const [held] = await agent({}, gate()).tick();
      expect(held).toMatchObject({ outcome: "held", hold: "cambio_en_cola", reason: "SUPPLIER_NEW" });
      expect(sent).toHaveLength(0);
    });
  });
});

