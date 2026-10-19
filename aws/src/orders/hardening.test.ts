// Review findings on the orders API: amount-history poisoning, replay of a signed request, a dead
// cancel nonce in the needs list, and the operator route that registers importer Safes.
import { structHash } from "@keel/schemas/hash";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handler as attest } from "../handlers/attest";
import { handler as directory } from "../handlers/directory";
import { handler as orders } from "../handlers/orders";
import { handler as proposals } from "../handlers/proposals";
import { handler as registrar } from "../handlers/registrar";
import { handler as signatures } from "../handlers/signatures";
import type { FakeDdb } from "./fakeDdb";
import { orderIdOf } from "./rules";
import { attestation, call, carrier, chainState, exporter, makeOrder, owner, resetChainDeps, SAFE, send, setup, signAs, signAsSafe, signedEvent, stranger } from "./testkit";

vi.mock("../secrets", () => ({ secret: async (name: string) => (name === "directory_admin_token" ? "operator-token" : "unused") }));

let ddb: FakeDdb;
beforeEach(async () => {
  ddb = await setup();
});
afterEach(resetChainDeps);

const stream = (orderId: string) =>
  ({ Records: [{ eventName: "MODIFY", dynamodb: { Keys: { orderId: { S: orderId } }, NewImage: { status: { S: "fully_signed" } } } }] }) as never;
const orderKey = (id: string) => ({ orderId: id.toLowerCase() });
const history = () => ddb.get("parties", { address: exporter.address.toLowerCase() })?.history;

async function signedByAll(order: ReturnType<typeof makeOrder>, importerAccount: typeof owner, asSafe: boolean) {
  const { po, terms } = order;
  const params = { orderId: po.orderId };
  expect((await call(proposals, importerAccount, "POST /proposals", { body: { po, terms } })).status).toBe(201);
  await call(proposals, exporter, "POST /proposals/{orderId}/exporter-signature", { params, body: { signature: await signAs(exporter, "PurchaseOrder", po) } });
  const sig = asSafe ? await signAsSafe(importerAccount, "PurchaseOrder", po) : await signAs(importerAccount, "PurchaseOrder", po);
  const r = await call(proposals, importerAccount, "POST /proposals/{orderId}/importer-signature", { params, body: { signature: sig } });
  expect(r.body.status).toBe("fully_signed");
  await registrar(stream(po.orderId));
  return { po, params };
}

describe("finding 1: amount history only from registered importer Safes", () => {
  it("an order whose importer is an EOA of the exporter's own adds no history; a registered Safe's does", async () => {
    // The exporter's second key proposes as its own importer
    const nonce = 7n;
    const self = makeOrder({ importer: stranger.address, nonce, orderId: orderIdOf(stranger.address, exporter.address, nonce), totalAmount: 90_000_000_000n });
    const { po } = await signedByAll(self, stranger, false);
    // Stored for the API...
    expect(ddb.get("orders", orderKey(po.orderId))).toBeDefined();
    // ...but nothing counts as history
    expect(history()).toBeUndefined();

    const real = makeOrder();
    await signedByAll(real, owner, true);
    expect(history()).toEqual([real.po.totalAmount.toString()]);
    // A repeated Stream record still counts the order once
    await registrar(stream(real.po.orderId));
    expect(history()).toEqual([real.po.totalAmount.toString()]);
  });
});

describe("finding 3: a replayed signed request has no second effect", () => {
  it("POST /proposals replayed: 409 proposal_exists and the stored proposal is untouched", async () => {
    const { po, terms } = makeOrder();
    const event = await signedEvent(owner, "POST /proposals", { body: { po, terms } });
    expect((await send(proposals, event)).status).toBe(201);
    const stored = JSON.stringify(ddb.get("proposals", orderKey(po.orderId)));
    const again = await send(proposals, event);
    expect(again).toEqual({ status: 409, body: { error: "proposal_exists" } });
    expect(JSON.stringify(ddb.get("proposals", orderKey(po.orderId)))).toBe(stored);
  });

  it("POST /orders/{id}/approve-balance and POST /shipments replayed: same result, `rev` and the order do not move", async () => {
    const { po, params } = await signedByAll(makeOrder(), owner, true);
    const att = attestation(po.orderId);
    const shipEvent = await signedEvent(carrier, "POST /shipments", { body: { attestation: att, sigCarrier: await signAs(carrier, "ShipmentAttestation", att) } });
    const first = await send(attest, shipEvent);
    expect(first.status).toBe(200);
    const revAfterShipment = ddb.get("orders", orderKey(po.orderId))!.rev;
    expect(await send(attest, shipEvent)).toEqual(first);
    expect(ddb.get("orders", orderKey(po.orderId))!.rev).toBe(revAfterShipment);

    ddb.put("orders", { ...ddb.get("orders", orderKey(po.orderId))!, chain: { state: "SHIPPED", updatedBlock: "1" } });
    const attestationHash = structHash("ShipmentAttestation", att);
    const signature = await signAsSafe(owner, "BalanceApproval", { orderId: po.orderId, attestationHash });
    const approveEvent = await signedEvent(owner, "POST /orders/{orderId}/approve-balance", { params, body: { attestationHash, signature } });
    const approved = await send(signatures, approveEvent);
    expect(approved.status).toBe(200);
    const stored = JSON.stringify(ddb.get("orders", orderKey(po.orderId)));
    const replayed = await send(signatures, approveEvent);
    expect(replayed).toEqual(approved);
    expect(JSON.stringify(ddb.get("orders", orderKey(po.orderId)))).toBe(stored);
  });
});

describe("finding 4: sign_cancel is offered only while the cancel nonce is still current", () => {
  it("drops the stored pair once the mirror moved to another state", async () => {
    const { po, params } = await signedByAll(makeOrder(), owner, true);
    const mirror = (state: string) => ddb.put("orders", { ...ddb.get("orders", orderKey(po.orderId))!, chain: { state, updatedBlock: "9" } });
    mirror("OPEN");
    chainState.cancelNonce = (1n << 8n) | 1n;
    const sig = await signAs(exporter, "CancelOrder", { orderId: po.orderId, nonce: chainState.cancelNonce });
    await call(signatures, exporter, "POST /orders/{orderId}/cancel-signature", { params, body: { nonce: chainState.cancelNonce.toString(), signature: sig } });
    expect(ddb.get("orders", orderKey(po.orderId))!.closing).toMatchObject({ cancel: { state: "OPEN", cancelNonce: "257" } });
    expect((await call(orders, owner, "GET /needs-you")).body.needs).toEqual([expect.objectContaining({ action: "sign_cancel", cancelNonce: "257" })]);

    // The escrow moved on (the nonce changed with the state): the old pair is dead
    mirror("ADVANCE_PAID");
    const after = (await call(orders, owner, "GET /needs-you")).body.needs as { action: string }[];
    expect(after.map((n) => n.action)).toEqual(["upload_documents"]);
  });
});

describe("finding 2: operator routes for importer Safes", () => {
  const op = { authorization: "Bearer operator-token" };
  const SAFE2 = "0x5afe00000000000000000000000000000000beef";

  it("needs the operator bearer", async () => {
    const body = { safe: SAFE2, representatives: [owner.address] };
    expect((await call(directory, null, "POST /importers", { body })).status).toBe(401);
    expect((await call(directory, null, "POST /importers", { body, headers: { authorization: "Bearer nope" } })).status).toBe(401);
    expect((await call(directory, null, "GET /importers/{safe}", { params: { safe: SAFE } })).status).toBe(401);
  });

  it("registers a Safe on a fresh deployment, so its representative passes the importer routes", async () => {
    // fresh deployment: nothing registered
    ddb.del("parties", { address: SAFE.toLowerCase() });
    ddb.del("parties", { address: owner.address.toLowerCase() });
    const { po, terms } = makeOrder();
    expect((await call(proposals, owner, "POST /proposals", { body: { po, terms } })).body.error).toBe("not_importer");

    const r = await call(directory, null, "POST /importers", { body: { safe: SAFE, representatives: [owner.address], name: "Importadora Sur", account: "importer-co" }, headers: op });
    expect(r).toEqual({
      status: 201,
      body: { safe: SAFE.toLowerCase(), representatives: [owner.address.toLowerCase()], name: "Importadora Sur", account: "importer-co" },
    });
    expect(ddb.get("parties", { address: owner.address.toLowerCase() })).toMatchObject({ kind: "representative", safe: SAFE.toLowerCase() });
    expect((await call(directory, null, "GET /importers/{safe}", { params: { safe: SAFE }, headers: op })).body).toEqual(r.body);
    expect((await call(proposals, owner, "POST /proposals", { body: { po, terms } })).status).toBe(201);
  });

  it("replaces the representatives, refuses one already pointing at another Safe (409), and 404s an unknown Safe", async () => {
    const other = stranger.address;
    await call(directory, null, "POST /importers", { body: { safe: SAFE2, representatives: [other] }, headers: op });
    const conflict = await call(directory, null, "POST /importers", { body: { safe: SAFE, representatives: [owner.address, other] }, headers: op });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error).toBe("representative_of_another_safe");
    // Nothing was written by the refused request
    expect(ddb.get("parties", { address: SAFE.toLowerCase() })!.representatives).toEqual([owner.address.toLowerCase()]);

    const extra = carrier.address;
    await call(directory, null, "POST /importers", { body: { safe: SAFE, representatives: [owner.address, extra] }, headers: op });
    await call(directory, null, "POST /importers", { body: { safe: SAFE, representatives: [owner.address] }, headers: op });
    expect(ddb.get("parties", { address: extra.toLowerCase() })).toBeUndefined();
    expect((await call(directory, null, "GET /importers/{safe}", { params: { safe: SAFE }, headers: op })).body.representatives).toEqual([owner.address.toLowerCase()]);
    expect((await call(directory, null, "GET /importers/{safe}", { params: { safe: exporter.address }, headers: op })).status).toBe(404);
    // An exporter address is not turned into a representative
    await call(directory, null, "POST /suppliers", { body: { exporter: exporter.address, payoutAddress: exporter.address }, headers: op });
    expect((await call(directory, null, "POST /importers", { body: { safe: SAFE, representatives: [exporter.address] }, headers: op })).body.error).toBe("kind_conflict");
  });
});
