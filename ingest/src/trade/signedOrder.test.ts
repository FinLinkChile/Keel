// Signed orders from the app (T3.11): both signatures, terms and id are checked before an order is
// registered; then its parties may upload documents and the agent gets its order.json.
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { encodeAbiParameters, hashTypedData } from "viem";
import { describe, expect, it } from "vitest";
import { EIP712_TYPES, keelDomain, type Hex, type OrderTerms, type PurchaseOrder } from "@keel/schemas";
import { bytes32Text, requiredDocsHash, termsHash } from "@keel/schemas/hash";
import { createHandler } from "../server";
import { SettingsStore } from "../settings";
import { IngestStore } from "../store";
import { testAccount } from "../testing/tradeCorpus";
import { staticImporters } from "./proforma";
import { canonicalJson, offlineSignatures, orderIdOf, receiveSignedOrder, withSignedOrders, type SignatureCheck } from "./signedOrder";
import { authorizeUpload, staticOrders, UPLOAD_TYPES, uploadDomain, fileHash } from "./upload";

const CHAIN_ID = 84532;
const ESCROW = "0x00000000000000000000000000000000000e5c20" as Hex;
const importer = testAccount("signed:importer");
const owner = testAccount("signed:safe-owner");
const exporter = testAccount("signed:exporter");
const stranger = testAccount("signed:stranger");
const SAFE = "0x0000000000000000000000000000000000005afe" as Hex;

const TERMS: OrderTerms = { orderNumber: "PO0158", currency: "USD", invoiceAmountMinor: 4_800_000n, hsCodes: ["130231"], documentHash: `0x${"ab".repeat(32)}` };

const orderFor = (imp: Hex, nonce = 0x158n, terms = TERMS): PurchaseOrder => ({
  orderId: orderIdOf(imp, exporter.address, nonce),
  importer: imp,
  exporter: exporter.address,
  payoutAddress: exporter.address,
  token: "0x00000000000000000000000000000000000000c0",
  totalAmount: 48_000_000_000n,
  advanceBps: 3000,
  shipmentDeadline: 1_800_000_000n,
  disputeWindow: 259_200n,
  carrier: "0x00000000000000000000000000000000000000ca",
  arbiter: "0x00000000000000000000000000000000000000a7",
  documentVerifier: "0x00000000000000000000000000000000000000d0",
  incoterm: bytes32Text("FOB"),
  termsHash: termsHash(terms),
  requiredDocsHash: requiredDocsHash(["BILL_OF_LADING", "COMMERCIAL_INVOICE"]),
  nonce,
});

const typed = (order: PurchaseOrder) => ({ domain: keelDomain(CHAIN_ID, ESCROW), types: { PurchaseOrder: EIP712_TYPES.PurchaseOrder }, primaryType: "PurchaseOrder" as const, message: order });

// As the app does it: an owner of the Safe signs the SafeMessage over the order digest
const safeSign = (signer: typeof owner, safe: Hex, order: PurchaseOrder) =>
  signer.signTypedData({
    domain: { chainId: CHAIN_ID, verifyingContract: safe },
    types: { SafeMessage: [{ name: "message", type: "bytes" }] },
    primaryType: "SafeMessage",
    message: { message: encodeAbiParameters([{ type: "bytes32" }], [hashTypedData(typed(order))]) },
  });

// The body the app posts: canonical JSON, bigints as text
const wire = (v: unknown): unknown => JSON.parse(JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x)));

async function body(opts: { imp?: typeof importer; safe?: Hex; terms?: OrderTerms; exporterSigner?: typeof exporter; label?: string; nonce?: bigint } = {}) {
  const imp = opts.safe ?? (opts.imp ?? importer).address;
  const order = orderFor(imp, opts.nonce, opts.terms);
  const sigImporter = opts.safe ? await safeSign(opts.imp ?? owner, opts.safe, order) : await (opts.imp ?? importer).signTypedData(typed(order));
  const sigExporter = await (opts.exporterSigner ?? exporter).signTypedData(typed(order));
  return { order, raw: wire({ order, terms: TERMS, label: opts.label ?? "PO-0158", sigImporter, sigExporter }) };
}

const setup = (over: Partial<Parameters<typeof receiveSignedOrder>[1]> = {}) => ({
  store: new IngestStore(":memory:"),
  chainId: CHAIN_ID,
  escrow: ESCROW,
  importers: staticImporters([importer.address, owner.address, SAFE]),
  signatures: offlineSignatures,
  ...over,
});

describe("signed orders from the app (T3.11)", () => {
  it("registers an order signed by both, lets its exporter upload documents and writes the agent's order.json", async () => {
    const agentDir = await mkdtemp(join(tmpdir(), "keel-agent-"));
    const opts = setup({ agentDir });
    const { order, raw } = await body();
    expect(await receiveSignedOrder(raw, opts)).toEqual({ status: "registered", orderId: order.orderId, already: false });

    const file = await readFile(join(agentDir, "orders", order.orderId.toLowerCase(), "order.json"), "utf8");
    expect(file).toBe(canonicalJson(raw));
    expect(JSON.parse(file)).toMatchObject({ label: "PO-0158", order: { totalAmount: "48000000000", nonce: "344" } });

    // The document upload now knows the order, and accepts its exporter
    const orders = withSignedOrders(staticOrders([]), opts.store);
    expect(orders.get(order.orderId)?.uploaders).toEqual([
      { address: importer.address, party: "importer" },
      { address: exporter.address, party: "exporter" },
    ]);
    const pdf = new TextEncoder().encode("%PDF-1.7 bill of lading");
    const issuedAt = Math.floor(Date.now() / 1000);
    const signature = await exporter.signTypedData({
      domain: uploadDomain(CHAIN_ID),
      types: UPLOAD_TYPES,
      primaryType: "DocumentUpload",
      message: { orderId: order.orderId, docType: "BILL_OF_LADING", fileHash: fileHash(pdf), issuedAt: BigInt(issuedAt) },
    });
    const auth = await authorizeUpload({ orderId: order.orderId, docType: "BILL_OF_LADING", issuedAt, signature, file: pdf }, orders, CHAIN_ID);
    expect(auth).toMatchObject({ status: "authorized", party: "exporter" });
  });

  it("answers the same order again as registered, and refuses another one under the same id", async () => {
    const opts = setup();
    const { raw } = await body();
    await receiveSignedOrder(raw, opts);
    expect(await receiveSignedOrder(raw, opts)).toMatchObject({ status: "registered", already: true });
    expect(await receiveSignedOrder((await body({ label: "PO-9999" })).raw, opts)).toEqual({ status: "rejected", reason: "conflict" });
  });

  it("refuses terms that are not the signed ones, a foreign id, an unknown importer and a forged signature", async () => {
    const opts = setup();
    const { raw } = await body();
    const r = raw as { order: Record<string, unknown>; terms: Record<string, unknown> };
    expect(await receiveSignedOrder({ ...r, terms: { ...r.terms, hsCodes: ["999999"] } }, opts)).toEqual({ status: "rejected", reason: "terms_mismatch" });
    expect(await receiveSignedOrder({ ...r, order: { ...r.order, nonce: "1" } }, opts)).toEqual({ status: "rejected", reason: "bad_order_id" });
    expect(await receiveSignedOrder((await body({ imp: stranger })).raw, opts)).toEqual({ status: "rejected", reason: "unknown_importer" });
    expect(await receiveSignedOrder((await body({ exporterSigner: stranger })).raw, opts)).toEqual({ status: "rejected", reason: "bad_exporter_signature" });
    expect(await receiveSignedOrder({ ...r, extra: 1 }, opts)).toEqual({ status: "rejected", reason: "invalid_request" });
    expect(await receiveSignedOrder({ ...r, order: { ...r.order, payoutAddress: stranger.address } }, opts)).toEqual({ status: "rejected", reason: "bad_exporter_signature" });
  });

  it("accepts the importer's Safe signature from a registered owner key, and registers that key", async () => {
    const opts = setup();
    const { order, raw } = await body({ safe: SAFE });
    expect(await receiveSignedOrder(raw, opts)).toMatchObject({ status: "registered" });
    expect(opts.store.signedOrder(order.orderId)?.entry.uploaders[0]).toEqual({ address: owner.address, party: "importer" });
    // Without the chain, a key that is not registered cannot sign for the Safe
    const other = await body({ safe: SAFE, imp: stranger, nonce: 0x159n });
    expect(await receiveSignedOrder(other.raw, opts)).toEqual({ status: "rejected", reason: "bad_importer_signature" });
  });

  it("with the chain, lets the Safe decide whether the key may sign for it", async () => {
    const asked: Hex[] = [];
    const chain: SignatureCheck = {
      onChain: true,
      isValid: async (addr, td, sig) => {
        asked.push(addr);
        return addr.toLowerCase() === SAFE.toLowerCase() || offlineSignatures.isValid(addr, td, sig);
      },
    };
    const opts = setup({ signatures: chain, importers: staticImporters([SAFE]) });
    const { raw } = await body({ safe: SAFE, imp: stranger });
    expect(await receiveSignedOrder(raw, opts)).toMatchObject({ status: "registered" });
    expect(asked.map((a) => a.toLowerCase())).toContain(SAFE.toLowerCase());
  });
});

describe("POST /trade/orders", () => {
  it("exists only with the escrow, and answers 201, then 200 for the same order", async () => {
    const settings = await SettingsStore.open({ fallback: { provider: "anthropic", model: "claude-opus-5-5", requireDmarc: true }, keys: { anthropic: "ka" }, urls: {}, audit: () => {} });
    const serve = async (signed: boolean) => {
      const store = new IngestStore(":memory:");
      const handler = createHandler({
        webhookToken: "w".repeat(40),
        aliases: [],
        settings,
        store,
        trade: {
          orders: withSignedOrders(staticOrders([]), store),
          chainId: CHAIN_ID,
          importers: staticImporters([importer.address]),
          ...(signed && { signed: { escrow: ESCROW, signatures: offlineSignatures } }),
        },
        log: () => {},
      });
      const server = createServer(handler);
      await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
      return { server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/trade/orders` };
    };
    const { raw } = await body();
    const post = (url: string) => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(raw) });
    const on = await serve(true);
    const off = await serve(false);
    try {
      expect((await post(on.url)).status).toBe(201);
      expect((await post(on.url)).status).toBe(200);
      expect((await post(off.url)).status).toBe(404);
    } finally {
      await new Promise<void>((r) => on.server.close(() => r()));
      await new Promise<void>((r) => off.server.close(() => r()));
    }
  });
});
