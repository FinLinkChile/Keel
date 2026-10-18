import { type Hex, type PurchaseOrder } from "@keel/schemas";
import { structHash } from "@keel/schemas/hash";
import { type AgentChain, deploymentSettings, ESCROW_ABI, orderOfCall } from "@keel/engine";
import { encodeFunctionResult } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { attestation, documentContext, extractions, order as fixtureOrder, terms, word } from "../../../engine/src/testing/fixtures";
import { setDdb, toItem } from "../db";
import { restrictToPdr } from "../keys";
import { acquire } from "../lock";
import { enqueueOnce, setSqs } from "../notices";
import type { OrderItem } from "../tables";
import { s3Evidence } from "../agent/evidence";
import { DynamoSnapshotStore } from "../agent/store";
import type { RuntimeDeployment } from "../agent/deployment";
import { FakeDynamo, FakeS3, FakeSqs, TEST_ENV } from "../testing/fakes";
import { type AgentPassDeps, runAgentPass } from "./agent";

const low = (a: string) => a.toLowerCase();
const relayer = privateKeyToAccount(word("relayer"));
const policyKey = privateKeyToAccount(word("policy signer"));
const ESCROW = low(word("escrow").slice(0, 42)) as Hex;
// The engine's conforming fixture order, with this test's policy key as its document verifier
const order: PurchaseOrder = { ...fixtureOrder, documentVerifier: policyKey.address, disputeWindow: 0n };
const SAFE = low(order.importer);
const NOW = BigInt(documentContext.now);

describe("agent Lambda pass", () => {
  let db: FakeDynamo;
  let s3: FakeS3;
  let sqs: FakeSqs;
  let state: number;

  // The escrow as the relayer sees it: one SHIPPED order; a sent release settles it
  const chain = (onCall?: () => Promise<void>): AgentChain => ({
    now: async () => NOW,
    call: async (c) => {
      await onCall?.();
      if (c.data.slice(0, 10) !== orderOfCall(ESCROW, order.orderId).data.slice(0, 10)) return "0x";
      return encodeFunctionResult({
        abi: ESCROW_ABI,
        functionName: "orderOf",
        result: {
          po: order,
          state,
          stateVersion: 3n,
          orderHash: structHash("PurchaseOrder", order),
          paidOut: order.totalAmount / 2n,
          attestationHash: structHash("ShipmentAttestation", attestation),
          docsHash: attestation.docsHash,
          shippedAt: NOW - 3600n,
          funded: true,
        },
      } as never);
    },
    send: async () => {
      s3.log.push("send");
      state = 4;
      return { hash: word("release tx"), status: "success" };
    },
    fundedAt: async () => undefined,
  });

  const context = async (): Promise<RuntimeDeployment> => ({
    chainId: 1,
    settings: deploymentSettings(null, { KEEL_ESCROW: ESCROW, KEEL_SAFE: SAFE, KEEL_ROLES_CONFIG_HASH: word("roles-config-v1") }, 1, "test"),
    escrow: ESCROW,
    safe: SAFE as Hex,
    deployBlock: 0n,
  });

  const deps = (over: Partial<AgentPassDeps> = {}): AgentPassDeps => ({
    context,
    keys: async () => ({ relayer, policySigner: restrictToPdr(policyKey) }),
    chain: async () => chain(),
    acquire: (r, hold) => acquire(r, hold, TEST_ENV),
    store: (safe) => DynamoSnapshotStore.load(safe, TEST_ENV),
    saveEvidence: s3Evidence("evidence", s3),
    enqueue: (notices) => enqueueOnce(notices, TEST_ENV),
    log: () => {},
    now: () => Number(NOW),
    ...over,
  });

  beforeEach(() => {
    db = new FakeDynamo();
    s3 = new FakeS3();
    sqs = new FakeSqs();
    state = 3;
    setDdb(db as never);
    setSqs(sqs);
    const item: OrderItem = {
      orderId: low(order.orderId) as Hex,
      safe: SAFE,
      exporter: low(order.exporter),
      ...(toItem({ order, terms, label: "PO-0131" }) as Pick<OrderItem, "order" | "terms" | "label">),
      sigImporter: word("sig importer"),
      sigExporter: word("sig exporter"),
      shipment: toItem({ attestation, sigCarrier: word("sig carrier") }) as OrderItem["shipment"],
      documents: toItem({ extractions, fileHashes: documentContext.fileHashes }) as OrderItem["documents"],
      uploaders: [],
      createdAt: 1,
    };
    db.put("orders", item);
    db.put("parties", { address: SAFE, kind: "importer", taxId: documentContext.importerTaxId, account: "acme-imports" });
    db.put("parties", { address: low(order.exporter), kind: "exporter", account: "lingnan" });
  });
  afterEach(() => {
    setDdb(undefined);
    setSqs(undefined);
  });

  it("writes the PDR evidence to S3 before it sends the release, then notifies once", async () => {
    const result = await runAgentPass(SAFE, deps());
    expect(result.status).toBe("ran");
    const [released] = result.status === "ran" ? result.events : [];
    expect(released).toMatchObject({ outcome: "sent", action: "releaseBalance", status: "success" });
    expect(s3.log).toEqual([`put pdr/${low(released!.pdrHash!)}.json`, "send"]);
    expect(JSON.parse(s3.objects.get(`evidence/pdr/${low(released!.pdrHash!)}.json`)!)).toMatchObject({ pdrHash: released!.pdrHash, mode: "trade" });
    expect(sqs.sent).toHaveLength(1);
    expect(JSON.parse(sqs.sent[0]!.MessageBody)).toMatchObject({ kind: "notices", notices: [{ id: `${order.orderId}:balance_released`, kind: "balance_released" }] });
    // The lock is released: the next pass runs, finds the order settled and sends nothing
    expect((await runAgentPass(SAFE, deps())).status).toBe("ran");
    expect(s3.log).toHaveLength(2);
  });

  it("sends nothing when the evidence cannot be written", async () => {
    const result = await runAgentPass(SAFE, deps({ saveEvidence: async () => Promise.reject(new Error("S3 unavailable")) }));
    expect(result.status === "ran" && result.events[0]).toMatchObject({ outcome: "failed", reason: "AGENT_ERROR", detail: "S3 unavailable" });
    expect(s3.log).toEqual([]);
    expect(state).toBe(3);
  });

  it("a held relayer lock skips the pass: no chain read, no send", async () => {
    const held = await acquire(relayer.address, 110, TEST_ENV);
    let read = false;
    const result = await runAgentPass(SAFE, deps({ chain: async () => ((read = true), chain()) }));
    expect(result).toEqual({ status: "skipped", reason: "LOCKED" });
    expect(read).toBe(false);
    await held!.release();
    expect((await runAgentPass(SAFE, deps())).status).toBe("ran");
  });

  it("two passes at once for the same relayer: one runs, the other is skipped", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow = deps({ chain: async () => chain(() => gate) });
    const first = runAgentPass(SAFE, slow);
    // Let the first pass take the lock before the second asks for it
    await new Promise((r) => setTimeout(r, 10));
    const second = await runAgentPass(SAFE, deps());
    release();
    expect(second).toEqual({ status: "skipped", reason: "LOCKED" });
    expect((await first).status).toBe("ran");
    expect(s3.log.filter((l) => l === "send")).toHaveLength(1);
  });

  it("refuses a Safe the deployment does not serve", async () => {
    expect(await runAgentPass(low(word("other safe").slice(0, 42)), deps())).toEqual({ status: "skipped", reason: "SAFE_NOT_DEPLOYED" });
  });
});
