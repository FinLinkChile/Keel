import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EIP712_TYPES, type FundIntent, type Hex, keelDomain, type PurchaseOrder, type ShipmentAttestation } from "@keel/schemas";
import { blNumberHash, bytes32Text, docsHash, requiredDocsHash, structHash } from "@keel/schemas/hash";
import { encodeAbiParameters, keccak256, parseSignature, toBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CallReverted } from "../agent/agent";
import { fundingCalldata } from "../agent/gate";
import { buildPolicyDecision, type PdrEvidence, saveEvidence, signPolicyDecision } from "../pdr";
import { tradePolicy, tradePolicyHash } from "../policy";
import { compile, createChain, RevertError } from "../testing/chain";
import { Monitor, type MonitorChain, type MonitorEvent, type MonitorLog, pauserOn } from "./monitor";

const word = (label: string): Hex => keccak256(toBytes(label));
const address = (n: number): Hex => `0x${n.toString(16).padStart(40, "0")}`;
const DAY = 24n * 3600n;
const T0 = 1_762_000_000n;
const DEADLINE = T0 + 10n * DAY;
const TOTAL = 10_000_000_000n;
const CONFIG_DELAY = 120n;
const AGENT = word("AGENT");
const AGENT_COSIGNED = word("AGENT_COSIGNED");
const FILES = [word("bl.pdf"), word("invoice.pdf")];

const importerOwner = privateKeyToAccount(word("importer owner"));
const exporter = privateKeyToAccount(word("exporter"));
const carrier = privateKeyToAccount(word("carrier"));
const policySigner = privateKeyToAccount(word("keel policy and document verifier"));
const cosigner = privateKeyToAccount(word("cosigner"));
const outsider = privateKeyToAccount(word("a key with no role in the gate"));
// The monitor's own key: the gate's guardian, which can only call emergencyPause
const guardian = privateKeyToAccount(word("monitor guardian"));
const ATTACKER = address(0xbad);
const RELAYER = address(0x7e1a);
const ARBITER = address(0xa4b1);
const PAYOUT = address(0xb3);
const policy = tradePolicy(word("roles-config-v1"));

describe("monitor of use outside the system (T2.8)", () => {
  let artifacts: ReturnType<typeof compile>;
  let chain: Awaited<ReturnType<typeof createChain>>;
  let usdc: Hex;
  let escrow: Hex;
  let safe: Hex;
  let gate: Hex;
  let evidenceDir: string;
  // Every transaction of the test, as a node would return its logs
  let recorded: MonitorLog[];
  let block: bigint;

  beforeAll(() => {
    artifacts = compile(["src/TradeEscrow.sol", "src/FundingGate.sol", "test/mocks/Mocks.sol", "test/mocks/TradeMocks.sol"]);
  }, 120_000);

  // One transaction per block, its logs kept with their block and hash
  async function send(name: string, to: Hex, fn: string, args: unknown[], from: Hex = RELAYER) {
    const logs = await chain.send(name, to, fn, args, from);
    block += 1n;
    const transactionHash = word(`tx ${block}`);
    logs.forEach((l, logIndex) => recorded.push({ ...l, blockNumber: block, transactionHash, logIndex }));
    return transactionHash;
  }
  const asSafe = (to: Hex, data: Hex) => send("MockModuleSafe1271", safe, "exec", [to, data], importerOwner.address);

  const monitorChain = (): MonitorChain => ({
    latestBlock: async () => block,
    logs: async (addresses, from, to) =>
      recorded.filter((l) => l.blockNumber >= from && l.blockNumber <= to && addresses.some((a) => a.toLowerCase() === l.address.toLowerCase())),
    attestationHash: async (e, orderId) => (await chain.read<{ attestationHash: Hex }>("TradeEscrow", e, "orderOf", [orderId])).attestationHash,
  });

  // The pause, simulated then sent by `who`, as rpcChain does it
  const pauserFor = (who: Hex) =>
    pauserOn(
      {
        call: async (c) => {
          try {
            return await chain.simulate(who, c.to, c.data);
          } catch (e) {
            if (e instanceof RevertError) throw new CallReverted(e.errorName);
            throw e;
          }
        },
        send: async (c) => ({ hash: await send("FundingGate", c.to, "emergencyPause", [], who), status: "success" as const }),
      },
      who,
    );

  const watch = (pauser?: ReturnType<typeof pauserFor>) =>
    new Monitor({ chainId: 1, gate, escrow, evidenceDir, fromBlock: block + 1n }, { chain: monitorChain(), pauser });

  beforeEach(async () => {
    chain = await createChain(artifacts);
    recorded = [];
    block = 0n;
    evidenceDir = mkdtempSync(join(tmpdir(), "keel-monitor-"));
    usdc = await chain.deploy("MockUSDC", [], RELAYER);
    escrow = await chain.deploy("TradeEscrow", [usdc, 60n], RELAYER);
    safe = await chain.deploy("MockModuleSafe1271", [importerOwner.address], RELAYER);
    const roles = await chain.deploy("MockTradeRoles", [safe, usdc, escrow], RELAYER);
    gate = await chain.deploy(
      "FundingGate",
      [safe, roles, escrow, AGENT, AGENT_COSIGNED, policySigner.address, cosigner.address, tradePolicyHash(policy), CONFIG_DELAY],
      RELAYER,
    );
    await send("MockModuleSafe1271", safe, "enableModule", [roles], importerOwner.address);
    await asSafe(roles, chain.calldata("MockTradeRoles", "assignRole", [AGENT, gate, true]));
    await asSafe(roles, chain.calldata("MockTradeRoles", "setAllowance", [AGENT, 100n * TOTAL, 7n * DAY]));
    await asSafe(gate, chain.calldata("FundingGate", "setGuardian", [guardian.address]));
    await asSafe(gate, chain.calldata("FundingGate", "queueSupplier", [exporter.address, PAYOUT]));
    await asSafe(gate, chain.calldata("FundingGate", "queueThirdParty", [carrier.address, 1]));
    await asSafe(gate, chain.calldata("FundingGate", "queueThirdParty", [ARBITER, 2]));
    await asSafe(gate, chain.calldata("FundingGate", "queueThirdParty", [policySigner.address, 4]));
    await send("MockUSDC", usdc, "mint", [safe, 10n * TOTAL]);
    chain.setTime(T0 + CONFIG_DELAY);
  });

  async function openOrder(nonce: bigint): Promise<PurchaseOrder> {
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
      termsHash: word("terms"),
      requiredDocsHash: requiredDocsHash(["BILL_OF_LADING", "COMMERCIAL_INVOICE"]),
      nonce,
    };
    const typed = { domain: keelDomain(1, escrow), types: { PurchaseOrder: EIP712_TYPES.PurchaseOrder }, primaryType: "PurchaseOrder" as const, message: order };
    const { r, s, v } = parseSignature(await importerOwner.signTypedData(typed));
    const sigImporter = encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }, { type: "uint8" }], [r, s, Number(v)]);
    await send("TradeEscrow", escrow, "open", [order, sigImporter, await exporter.signTypedData(typed)]);
    return order;
  }

  // A deposit signed with the policy key. `inEvidence` is whether the engine issued it: the
  // attack is the same signature made outside the engine, so no evidence file exists.
  async function fund(order: PurchaseOrder, inEvidence: boolean, from: Hex = RELAYER) {
    const intent: FundIntent = {
      orderId: order.orderId,
      orderHash: structHash("PurchaseOrder", order),
      escrow,
      token: usdc,
      amount: TOTAL,
      deadline: chain.time() + 900n,
      nonce: BigInt(structHash("PurchaseOrder", order)),
    };
    const calldata = fundingCalldata(intent);
    const decision = buildPolicyDecision({
      intentHash: structHash("FundIntent", intent),
      calldata,
      policyHash: tradePolicyHash(policy),
      inputsHash: word("inputs"),
      tier: 1,
      expiresAt: intent.deadline,
    });
    const signed = await signPolicyDecision(decision, keelDomain(1, gate), policySigner);
    if (inEvidence) saveEvidence(evidenceDir, { mode: "trade", issuedAt: Number(chain.time()), ...signed, intent, calldata, rules: [] } as PdrEvidence);
    return send("FundingGate", gate, "execute", [intent, signed.decision, signed.signature, "0x"], from);
  }

  async function ship(order: PurchaseOrder): Promise<ShipmentAttestation> {
    const attestation: ShipmentAttestation = {
      orderId: order.orderId,
      blNumberHash: blNumberHash(carrier.address, `EGLV${order.nonce}000000`),
      onBoardDate: chain.time(),
      portOfLoading: bytes32Text("CNSZX"),
      docsHash: docsHash(FILES),
    };
    const sigCarrier = await carrier.signTypedData({
      domain: keelDomain(1, escrow),
      types: { ShipmentAttestation: EIP712_TYPES.ShipmentAttestation },
      primaryType: "ShipmentAttestation",
      message: attestation,
    });
    await send("TradeEscrow", escrow, "submitShipment", [order.orderId, attestation, sigCarrier]);
    return attestation;
  }

  const reasons = (events: readonly MonitorEvent[]) => events.map((e) => e.reason);
  const paused = () => chain.read<boolean>("FundingGate", gate, "paused");

  it("a deposit the engine issued is not an incident", async () => {
    const order = await openOrder(1n);
    const monitor = watch(pauserFor(guardian.address));
    await fund(order, true);
    expect(await monitor.tick()).toEqual([]);
    expect(await paused()).toBe(false);
  });

  it("a deposit signed outside the engine pauses the gate, and the next one reverts", async () => {
    const [first, second] = [await openOrder(1n), await openOrder(2n)];
    const monitor = watch(pauserFor(guardian.address));
    const tx = await fund(first, false, ATTACKER);

    const [incident] = await monitor.tick();
    expect(incident).toMatchObject({ kind: "incident", reason: "UNKNOWN_FUNDING_PDR", txHash: tx, orderId: first.orderId, action: "paused" });
    expect(await paused()).toBe(true);
    await expect(fund(second, false, ATTACKER)).rejects.toThrow("GateIsPaused");
    // The pause itself is seen on the next read, as a change
    expect(reasons(await monitor.tick())).toEqual(["GATE_PAUSED"]);
  });

  it("a key that may not pause only alerts: the pause is simulated, reverts and spends no gas", async () => {
    const order = await openOrder(1n);
    const monitor = watch(pauserFor(outsider.address));
    await fund(order, false, ATTACKER);
    const [incident] = await monitor.tick();
    expect(incident).toMatchObject({ reason: "UNKNOWN_FUNDING_PDR", action: "alerted", pauseRevert: "OnlyPauser" });
    expect(await paused()).toBe(false);
    expect(reasons(await monitor.tick())).toEqual([]);
  });

  it("without a pause key it alerts the human cosigner", async () => {
    const order = await openOrder(1n);
    const monitor = watch();
    await fund(order, false, ATTACKER);
    expect(await monitor.tick()).toMatchObject([{ reason: "UNKNOWN_FUNDING_PDR", action: "alerted" }]);
  });

  it("a balance released by the importer's own approval is legitimate", async () => {
    const order = await openOrder(1n);
    await fund(order, true);
    const attestation = await ship(order);
    const monitor = watch(pauserFor(guardian.address));
    const approval = await importerOwner.signTypedData({
      domain: keelDomain(1, escrow),
      types: { BalanceApproval: EIP712_TYPES.BalanceApproval },
      primaryType: "BalanceApproval",
      message: { orderId: order.orderId, attestationHash: structHash("ShipmentAttestation", attestation) },
    });
    const { r, s, v } = parseSignature(approval);
    await send("TradeEscrow", escrow, "approveBalance", [order.orderId, encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }, { type: "uint8" }], [r, s, Number(v)])]);
    expect(await monitor.tick()).toEqual([]);
  });

  it("a balance released by a document decision the engine never issued is an incident", async () => {
    const order = await openOrder(1n);
    await fund(order, true);
    const attestation = await ship(order);
    const monitor = watch(pauserFor(guardian.address));
    const decision = {
      orderId: order.orderId,
      attestationHash: structHash("ShipmentAttestation", attestation),
      docsHash: docsHash(FILES),
      policyHash: tradePolicyHash(policy),
      inputsHash: word("forged inputs"),
      expiresAt: chain.time() + 3600n,
    };
    const sig = await policySigner.signTypedData({
      domain: keelDomain(1, escrow),
      types: { DocumentDecision: EIP712_TYPES.DocumentDecision },
      primaryType: "DocumentDecision",
      message: decision,
    });
    await send("TradeEscrow", escrow, "releaseBalance", [order.orderId, decision, sig], ATTACKER);
    const [incident] = await monitor.tick();
    expect(incident).toMatchObject({ reason: "UNKNOWN_DOCUMENT_DECISION", orderId: order.orderId, action: "paused" });
  });

  it("reports configuration changes without acting on them", async () => {
    const monitor = watch(pauserFor(guardian.address));
    await asSafe(gate, chain.calldata("FundingGate", "queueSupplier", [exporter.address, address(0xbeef)]));
    await send("FundingGate", gate, "vetoPending", [5n], cosigner.address);
    await asSafe(gate, chain.calldata("FundingGate", "setPolicyHash", [word("other rules")]));
    await asSafe(gate, chain.calldata("FundingGate", "setGuardian", [address(0)]));
    const events = await monitor.tick();
    expect(reasons(events)).toEqual(["SUPPLIER_QUEUED", "CHANGE_VETOED", "POLICY_HASH_SET", "GUARDIAN_SET"]);
    expect(events[3]).toMatchObject({ kind: "change", subject: address(0) });
    expect(events[0]).toMatchObject({ kind: "change", changeId: 5n, subject: exporter.address, activatesAt: chain.time() + CONFIG_DELAY });
    expect(await paused()).toBe(false);
  });

  it("reads each block once and in chunks", async () => {
    const monitor = new Monitor({ chainId: 1, gate, escrow, evidenceDir, fromBlock: 1n, maxRange: 2n }, { chain: monitorChain() });
    // The setup set the guardian, then queued one supplier and three third parties
    expect(reasons(await monitor.tick())).toEqual(["GUARDIAN_SET", "SUPPLIER_QUEUED", "THIRD_PARTY_QUEUED", "THIRD_PARTY_QUEUED", "THIRD_PARTY_QUEUED"]);
    expect(await monitor.tick()).toEqual([]);
  });
});
