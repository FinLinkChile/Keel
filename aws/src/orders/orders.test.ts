import type { Hex } from "@keel/schemas";
import { docsHash, structHash } from "@keel/schemas/hash";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handler as attest } from "../handlers/attest";
import { handler as directory } from "../handlers/directory";
import { handler as orders } from "../handlers/orders";
import { handler as proposals } from "../handlers/proposals";
import { handler as registrar } from "../handlers/registrar";
import { handler as signatures } from "../handlers/signatures";
import { autoAttest } from "./autoAttest";
import { ctxOf } from "./context";
import type { FakeDdb } from "./fakeDdb";
import {
  arbiter,
  attestation,
  call,
  carrier,
  chainState,
  ESCROW,
  exporter,
  GATE,
  makeOrder,
  now,
  owner,
  payout,
  resetChainDeps,
  SAFE,
  setup,
  signAs,
  signAsSafe,
  stranger,
  TOKEN,
} from "./testkit";

vi.mock("../secrets", () => ({ secret: async (name: string) => (name === "directory_admin_token" ? "operator-token" : "unused") }));

let ddb: FakeDdb;
beforeEach(async () => {
  ddb = await setup();
});
afterEach(resetChainDeps);

// A fully signed order, registered: what the agent would open and fund
async function signedOrder() {
  const { po, terms } = makeOrder();
  const params = { orderId: po.orderId };
  await call(proposals, owner, "POST /proposals", { body: { po, terms } });
  await call(proposals, exporter, "POST /proposals/{orderId}/exporter-signature", { params, body: { signature: await signAs(exporter, "PurchaseOrder", po) } });
  await call(proposals, owner, "POST /proposals/{orderId}/importer-signature", { params, body: { signature: await signAsSafe(owner, "PurchaseOrder", po) } });
  await registrar({ Records: [{ eventName: "MODIFY", dynamodb: { Keys: { orderId: { S: po.orderId } }, NewImage: { status: { S: "fully_signed" } } } }] } as never);
  return { po, terms, params };
}

// What the indexer would write after reading the chain
function mirror(orderId: string, state: string) {
  const key = { orderId: orderId.toLowerCase() };
  ddb.put("orders", { ...ddb.get("orders", key)!, chain: { state, updatedBlock: "123" } });
}

describe("orders: visibility", () => {
  it("each party sees the order with its role; a stranger gets the same 404 as an unknown id", async () => {
    const { params } = await signedOrder();
    expect((await call(orders, owner, "GET /orders/{orderId}", { params })).body).toMatchObject({ you: ["importer"], state: "NONE", locked: "0" });
    expect((await call(orders, exporter, "GET /orders/{orderId}", { params })).body.you).toEqual(["exporter"]);
    expect((await call(orders, carrier, "GET /orders/{orderId}", { params })).body.you).toEqual(["carrier"]);
    expect((await call(orders, stranger, "GET /orders/{orderId}", { params })).status).toBe(404);
    expect((await call(orders, stranger, "GET /orders/{orderId}", { params: { orderId: `0x${"00".repeat(32)}` } })).status).toBe(404);
  });

  it("lists orders for the importer's representative and the exporter only", async () => {
    await signedOrder();
    expect((await call(orders, owner, "GET /orders")).body.orders).toHaveLength(1);
    expect((await call(orders, exporter, "GET /orders")).body.orders).toHaveLength(1);
    expect((await call(orders, stranger, "GET /orders")).body.orders).toHaveLength(0);
    expect((await call(orders, owner, "GET /orders", { query: { state: "SHIPPED" } })).body.orders).toHaveLength(0);
  });

  it("the wallet sums what the escrow holds per state, from the mirror", async () => {
    const { po } = await signedOrder();
    let w = (await call(orders, owner, "GET /wallet")).body.wallets;
    expect(w).toEqual([expect.objectContaining({ safe: SAFE.toLowerCase(), byState: { NONE: 1 }, locked: "0", pendingFunding: po.totalAmount.toString() })]);
    mirror(po.orderId, "ADVANCE_PAID");
    w = (await call(orders, owner, "GET /wallet")).body.wallets;
    expect(w[0]).toMatchObject({ byState: { ADVANCE_PAID: 1 }, locked: "7000000000", pendingFunding: "0" });
    expect((await call(orders, exporter, "GET /wallet")).body.wallets).toEqual([]);
    expect((await call(orders, exporter, "GET /wallet", { query: { safe: SAFE } })).status).toBe(403);
  });

  it("the wallet shows the exporter the balance of its payout address", async () => {
    await signedOrder();
    chainState.balance = 300_000n;
    expect((await call(orders, exporter, "GET /wallet")).body.payouts).toEqual([{ address: payout.address.toLowerCase(), available: "300000" }]);
    expect((await call(orders, owner, "GET /wallet")).body.payouts).toEqual([]);
    chainState.balance = undefined;
    expect((await call(orders, exporter, "GET /wallet")).body.payouts).toEqual([{ address: payout.address.toLowerCase() }]);
  });

  it("the wallet shows the Safe's token balance on chain, and still answers when the RPC does not", async () => {
    chainState.balance = 35_000_000n;
    expect((await call(orders, owner, "GET /wallet")).body.wallets[0]).toMatchObject({ safe: SAFE.toLowerCase(), available: "35000000" });
    chainState.balance = undefined;
    const r = await call(orders, owner, "GET /wallet");
    expect(r.status).toBe(200);
    expect(r.body.wallets[0]).not.toHaveProperty("available");
  });
});

describe("needs-you", () => {
  it("tells each side what it has to do", async () => {
    const { po, terms } = makeOrder();
    await call(proposals, owner, "POST /proposals", { body: { po, terms } });
    expect((await call(orders, exporter, "GET /needs-you")).body.needs).toEqual([{ action: "sign_as_exporter", orderId: po.orderId.toLowerCase(), label: "PO-0131", as: "exporter" }]);
    expect((await call(orders, owner, "GET /needs-you")).body.needs).toEqual([]);
    await call(proposals, exporter, "POST /proposals/{orderId}/exporter-signature", { params: { orderId: po.orderId }, body: { signature: await signAs(exporter, "PurchaseOrder", po) } });
    expect((await call(orders, owner, "GET /needs-you")).body.needs.map((n: { action: string }) => n.action)).toEqual(["sign_as_importer"]);
  });

  it("asks the uploaders for documents after the advance, and the importer to approve after shipment", async () => {
    const { po } = await signedOrder();
    mirror(po.orderId, "ADVANCE_PAID");
    expect((await call(orders, exporter, "GET /needs-you")).body.needs).toEqual([expect.objectContaining({ action: "upload_documents", as: "exporter" })]);
    const att = attestation(po.orderId);
    await call(attest, carrier, "POST /shipments", { body: { attestation: att, sigCarrier: await signAs(carrier, "ShipmentAttestation", att) } });
    mirror(po.orderId, "SHIPPED");
    expect((await call(orders, owner, "GET /needs-you")).body.needs).toEqual([
      expect.objectContaining({ action: "approve_balance", as: "importer", attestationHash: structHash("ShipmentAttestation", att) }),
    ]);
  });
});

describe("shipments", () => {
  it("stores the attestation of the order's carrier", async () => {
    const { po } = await signedOrder();
    const att = attestation(po.orderId);
    const sigCarrier = await signAs(carrier, "ShipmentAttestation", att);
    const r = await call(attest, carrier, "POST /shipments", { body: { attestation: att, sigCarrier } });
    expect(r.status).toBe(200);
    expect(r.body.attestationHash).toBe(structHash("ShipmentAttestation", att));
    expect(ddb.get("orders", { orderId: po.orderId.toLowerCase() })!.shipment).toMatchObject({ sigCarrier, attestation: { onBoardDate: att.onBoardDate.toString() } });
  });

  it("refuses an attestation not signed by the carrier, a request not from the carrier, and an unknown order", async () => {
    const { po } = await signedOrder();
    const att = attestation(po.orderId);
    const byStranger = await signAs(stranger, "ShipmentAttestation", att);
    expect((await call(attest, carrier, "POST /shipments", { body: { attestation: att, sigCarrier: byStranger } })).body.error).toBe("bad_carrier_signature");
    const good = await signAs(carrier, "ShipmentAttestation", att);
    expect((await call(attest, stranger, "POST /shipments", { body: { attestation: att, sigCarrier: good } })).body.error).toBe("not_carrier");
    const unknown = attestation(`0x${"11".repeat(32)}`);
    const r = await call(attest, carrier, "POST /shipments", { body: { attestation: unknown, sigCarrier: await signAs(carrier, "ShipmentAttestation", unknown) } });
    expect(r).toEqual({ status: 404, body: { error: "not_found" } });
    expect(ddb.get("orders", { orderId: po.orderId.toLowerCase() })!.shipment).toBeUndefined();
  });

  it("refuses an on board date in the future, and any change once the escrow accepted a shipment", async () => {
    const { po } = await signedOrder();
    const future = attestation(po.orderId, { onBoardDate: BigInt(now() + 86400) });
    expect((await call(attest, carrier, "POST /shipments", { body: { attestation: future, sigCarrier: await signAs(carrier, "ShipmentAttestation", future) } })).body.error).toBe("invalid_attestation");
    mirror(po.orderId, "SHIPPED");
    const att = attestation(po.orderId);
    expect((await call(attest, carrier, "POST /shipments", { body: { attestation: att, sigCarrier: await signAs(carrier, "ShipmentAttestation", att) } })).status).toBe(409);
  });
});

describe("closing signatures", () => {
  it("approve-balance: the importer Safe's signature over the stored attestation", async () => {
    const { po, params } = await signedOrder();
    const att = attestation(po.orderId);
    await call(attest, carrier, "POST /shipments", { body: { attestation: att, sigCarrier: await signAs(carrier, "ShipmentAttestation", att) } });
    mirror(po.orderId, "SHIPPED");
    const attestationHash = structHash("ShipmentAttestation", att);
    const wrongHash = `0x${"99".repeat(32)}`;
    expect((await call(signatures, owner, "POST /orders/{orderId}/approve-balance", { params, body: { attestationHash: wrongHash, signature: "0x00" } })).body).toEqual({
      error: "attestation_mismatch",
      attestationHash,
    });
    const notOwner = await signAsSafe(stranger, "BalanceApproval", { orderId: po.orderId, attestationHash });
    expect((await call(signatures, owner, "POST /orders/{orderId}/approve-balance", { params, body: { attestationHash, signature: notOwner } })).body.error).toBe("bad_importer_signature");
    expect((await call(signatures, exporter, "POST /orders/{orderId}/approve-balance", { params, body: { attestationHash, signature: notOwner } })).body.error).toBe("not_importer");
    const signature = await signAsSafe(owner, "BalanceApproval", { orderId: po.orderId, attestationHash });
    const r = await call(signatures, owner, "POST /orders/{orderId}/approve-balance", { params, body: { attestationHash, signature } });
    expect(r.body.closing).toEqual({ balanceApproval: { sigImporter: signature, attestationHash } });
  });

  it("cancel-signature: refuses a stale nonce, pairs both sides on the current one, drops a pair of an older one", async () => {
    const { po, params } = await signedOrder();
    mirror(po.orderId, "OPEN");
    chainState.cancelNonce = (1n << 8n) | 1n;
    const stale = await signAs(exporter, "CancelOrder", { orderId: po.orderId, nonce: 1n });
    expect((await call(signatures, exporter, "POST /orders/{orderId}/cancel-signature", { params, body: { nonce: "1", signature: stale } })).body).toEqual({
      error: "stale_cancel_nonce",
      cancelNonce: "257",
    });
    // The right nonce, signed by another key
    const wrongKey = await signAs(stranger, "CancelOrder", { orderId: po.orderId, nonce: 257n });
    expect((await call(signatures, exporter, "POST /orders/{orderId}/cancel-signature", { params, body: { nonce: "257", signature: wrongKey } })).body.error).toBe("bad_exporter_signature");
    expect((await call(signatures, stranger, "POST /orders/{orderId}/cancel-signature", { params, body: { nonce: "257", signature: wrongKey } })).body.error).toBe("not_a_party");

    const sigExporter = await signAs(exporter, "CancelOrder", { orderId: po.orderId, nonce: 257n });
    let r = await call(signatures, exporter, "POST /orders/{orderId}/cancel-signature", { params, body: { nonce: "257", signature: sigExporter } });
    expect(r.body).toMatchObject({ complete: false, closing: { cancel: { cancelNonce: "257", sigExporter } } });
    expect((await call(orders, owner, "GET /needs-you")).body.needs).toEqual([expect.objectContaining({ action: "sign_cancel", as: "importer", cancelNonce: "257" })]);
    const sigImporter = await signAsSafe(owner, "CancelOrder", { orderId: po.orderId, nonce: 257n });
    r = await call(signatures, owner, "POST /orders/{orderId}/cancel-signature", { params, body: { nonce: "257", signature: sigImporter } });
    expect(r.body).toMatchObject({ complete: true, closing: { cancel: { cancelNonce: "257", sigExporter, sigImporter } } });

    // The order moved on: the next signature replaces the old pair
    mirror(po.orderId, "ADVANCE_PAID");
    chainState.cancelNonce = (2n << 8n) | 2n;
    const next = await signAs(exporter, "CancelOrder", { orderId: po.orderId, nonce: 514n });
    r = await call(signatures, exporter, "POST /orders/{orderId}/cancel-signature", { params, body: { nonce: "514", signature: next } });
    expect(r.body.closing.cancel).toEqual({ cancelNonce: "514", state: "ADVANCE_PAID", sigExporter: next });
  });

  it("resolution: only the arbiter, splitting exactly the remaining balance", async () => {
    const { po, params } = await signedOrder();
    mirror(po.orderId, "DISPUTED");
    const remaining = po.totalAmount - (po.totalAmount * 3000n) / 10_000n;
    const split = { toImporter: (remaining / 2n).toString(), toExporter: (remaining - remaining / 2n).toString() };
    const msg = { orderId: po.orderId, toImporter: BigInt(split.toImporter), toExporter: BigInt(split.toExporter) };
    const signature = await signAs(arbiter, "DisputeResolution", msg);
    expect((await call(signatures, owner, "POST /disputes/{orderId}/resolution", { params, body: { ...split, signature } })).body.error).toBe("not_arbiter");
    expect((await call(signatures, arbiter, "POST /disputes/{orderId}/resolution", { params, body: { ...split, toImporter: "1", signature } })).body.error).toBe("bad_resolution");
    expect((await call(signatures, arbiter, "POST /disputes/{orderId}/resolution", { params, body: { ...split, toImporter: 5, signature } })).body.error).toBe("bad_request");
    const r = await call(signatures, arbiter, "POST /disputes/{orderId}/resolution", { params, body: { ...split, signature } });
    expect(r.body.closing).toEqual({ resolution: { ...split, sigArbiter: signature } });
    mirror(po.orderId, "RESOLVED");
    expect((await call(signatures, arbiter, "POST /disputes/{orderId}/resolution", { params, body: { ...split, signature } })).body.error).toBe("invalid_state");
  });
});

describe("directory", () => {
  it("trade-setup is public", async () => {
    const r = await call(directory, null, "GET /trade-setup");
    expect(r.body).toEqual({ chainId: 84532, escrow: ESCROW, safe: SAFE, fundingGate: GATE, token: TOKEN, deployBlock: "100" });
  });

  it("only the operator registers suppliers; representatives of the Safe read them", async () => {
    const body = { exporter: exporter.address, payoutAddress: payout.address, name: "Shenzhen Agar Co", account: "shenzhen-agar" };
    expect((await call(directory, null, "POST /suppliers", { body })).status).toBe(401);
    expect((await call(directory, null, "POST /suppliers", { body, headers: { authorization: "Bearer nope" } })).status).toBe(401);
    const r = await call(directory, null, "POST /suppliers", { body, headers: { authorization: "Bearer operator-token" } });
    expect(r).toMatchObject({ status: 201, body: { safe: SAFE.toLowerCase(), exporter: exporter.address.toLowerCase(), payoutAddresses: [payout.address.toLowerCase()] } });
    // A representative cannot be turned into a supplier
    const conflict = await call(directory, null, "POST /suppliers", { body: { ...body, exporter: owner.address }, headers: { authorization: "Bearer operator-token" } });
    expect(conflict.body.error).toBe("kind_conflict");

    const list = await call(directory, owner, "GET /suppliers");
    expect(list.body.safes).toEqual([{ safe: SAFE.toLowerCase(), suppliers: [expect.objectContaining({ name: "Shenzhen Agar Co", payoutAddresses: [payout.address.toLowerCase()] })] }]);
    expect((await call(directory, stranger, "GET /suppliers")).body.error).toBe("not_representative");
  });
});

describe("demo auto-attestation (off by default)", () => {
  const CARRIER_KEY = `0x${(0xca44).toString(16).padStart(64, "0")}`;
  const deps = (on: boolean, key = CARRIER_KEY) => ({
    env: { ...process.env, KEEL_DEMO_AUTO_ATTEST: on ? "1" : undefined },
    carrierKey: async () => key,
    context: () => ctxOf(),
  });
  const BL = "0x" + "11".repeat(32);
  const INVOICE = "0x" + "22".repeat(32);
  function withDocuments(orderId: string, invoice = true) {
    const key = { orderId: orderId.toLowerCase() };
    const extractions: Record<string, object> = {
      transport: { doc_type: "BILL_OF_LADING", document_number: "HLIN26100142", on_board_date: String(now() - 3600), port_of_loading: "HKHKG" },
    };
    if (invoice) extractions.invoice = { order_number: "PO0001" };
    ddb.put("orders", { ...ddb.get("orders", key)!, documents: { extractions, fileHashes: invoice ? [BL, INVOICE] : [BL] } });
  }

  it("stays off without the switch, and waits for the deposit and both documents", async () => {
    const { po } = await signedOrder();
    withDocuments(po.orderId);
    expect(await autoAttest(po.orderId, deps(false))).toBe("off");
    expect(await autoAttest(po.orderId, deps(true))).toBe("not_funded");
    mirror(po.orderId, "ADVANCE_PAID");
    withDocuments(po.orderId, false);
    expect(await autoAttest(po.orderId, deps(true))).toBe("waiting_documents");
  });

  it("signs with the order's carrier and stores what POST /shipments would, once", async () => {
    const { po, params } = await signedOrder();
    mirror(po.orderId, "ADVANCE_PAID");
    withDocuments(po.orderId);
    expect(await autoAttest(po.orderId, deps(true, `0x${"bad".padStart(64, "0")}`))).toBe("carrier_mismatch");
    expect(await autoAttest(po.orderId, deps(true))).toBe("attested");
    const view = (await call(orders, owner, "GET /orders/{orderId}", { params })).body;
    expect(view.shipment.attestation).toMatchObject({ orderId: po.orderId.toLowerCase(), docsHash: docsHash([BL, INVOICE] as Hex[]) });
    expect(await autoAttest(po.orderId, deps(true))).toBe("already_attested");
  });
});
