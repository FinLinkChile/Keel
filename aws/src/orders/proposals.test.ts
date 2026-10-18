import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handler as proposals } from "../handlers/proposals";
import { handler as registrar } from "../handlers/registrar";
import type { FakeDdb } from "./fakeDdb";
import { call, exporter, json, makeOrder, owner, resetChainDeps, setup, signAs, signAsSafe, stranger } from "./testkit";

let ddb: FakeDdb;
beforeEach(async () => {
  ddb = await setup();
});
afterEach(resetChainDeps);

const P = {
  create: "POST /proposals",
  list: "GET /proposals",
  get: "GET /proposals/{orderId}",
  exporter: "POST /proposals/{orderId}/exporter-signature",
  importer: "POST /proposals/{orderId}/importer-signature",
  reject: "POST /proposals/{orderId}/reject",
};

const streamOf = (orderId: string, status = "fully_signed") =>
  ({ Records: [{ eventName: "MODIFY", dynamodb: { Keys: { orderId: { S: orderId } }, NewImage: { status: { S: status } } } }] }) as never;

async function proposed(order = makeOrder()) {
  const r = await call(proposals, owner, P.create, { body: { po: order.po, terms: order.terms, goods: "Coffee beans" } });
  expect(r.status).toBe(201);
  return { ...order, params: { orderId: order.po.orderId } };
}

describe("proposals: happy path", () => {
  it("goes proposal -> exporter -> importer -> fully_signed, and the registrar creates the order once", async () => {
    const { po, params } = await proposed();
    const created = ddb.get("proposals", { orderId: po.orderId.toLowerCase() })!;
    expect(created).toMatchObject({ status: "awaiting_exporter", label: "PO-0131", goods: "Coffee beans", importer: po.importer.toLowerCase() });

    const asExporter = await call(proposals, exporter, P.get, { params });
    expect(asExporter.body).toMatchObject({ status: "awaiting_exporter", you: ["exporter"], differences: [] });

    const sigExporter = await signAs(exporter, "PurchaseOrder", po);
    const e = await call(proposals, exporter, P.exporter, { params, body: { signature: sigExporter } });
    expect(e.status).toBe(200);
    expect(e.body).toMatchObject({ status: "awaiting_importer", sigExporter });

    const sigImporter = await signAsSafe(owner, "PurchaseOrder", po);
    const i = await call(proposals, owner, P.importer, { params, body: { signature: sigImporter } });
    expect(i.status).toBe(200);
    expect(i.body).toMatchObject({ status: "fully_signed", sigImporter, importerSigner: owner.address.toLowerCase(), you: ["importer"] });

    await registrar(streamOf(po.orderId));
    await registrar(streamOf(po.orderId)); // a Stream delivers at least once
    const order = ddb.get("orders", { orderId: po.orderId.toLowerCase() })!;
    expect(order).toMatchObject({
      safe: po.importer.toLowerCase(),
      exporter: po.exporter.toLowerCase(),
      order: json(po),
      label: "PO-0131",
      sigImporter,
      sigExporter,
      uploaders: [
        { address: owner.address.toLowerCase(), party: "importer" },
        { address: exporter.address.toLowerCase(), party: "exporter" },
      ],
    });
    expect(ddb.get("parties", { address: exporter.address.toLowerCase() })).toMatchObject({ kind: "exporter", history: [po.totalAmount.toString()] });
    expect(ddb.get("ingest", { pk: `order#${po.orderId.toLowerCase()}`, sk: "entry" })).toMatchObject({
      orderId: po.orderId.toLowerCase(),
      payoutAddress: po.payoutAddress,
      carrier: po.carrier,
      uploaders: order.uploaders,
    });
  });

  it("the registrar ignores records that are not fully signed and proposals that say otherwise", async () => {
    const { po } = await proposed();
    await registrar(streamOf(po.orderId, "awaiting_importer"));
    // The Stream image claims fully_signed, the table does not: the table wins
    await registrar(streamOf(po.orderId));
    expect(ddb.all("orders")).toEqual([]);
  });

  it("lists proposals for the importer's representative and for the exporter, not for others", async () => {
    await proposed();
    expect((await call(proposals, owner, P.list)).body.proposals).toHaveLength(1);
    expect((await call(proposals, exporter, P.list)).body.proposals).toHaveLength(1);
    expect((await call(proposals, stranger, P.list)).body.proposals).toHaveLength(0);
    expect((await call(proposals, owner, P.list, { query: { status: "rejected" } })).body.proposals).toHaveLength(0);
  });

  it("an exporter counter offer keeps the original as proposed and shows the differences", async () => {
    const { po, terms, params } = await proposed();
    const counter = { ...po, totalAmount: po.totalAmount + 1n };
    const signature = await signAs(exporter, "PurchaseOrder", counter);
    const r = await call(proposals, exporter, P.exporter, { params, body: { signature, po: counter, terms } });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: "awaiting_importer", differences: ["totalAmount"], proposed: { po: json(po) }, po: json(counter) });
    // The importer signs the countered version, which is the one the exporter signed
    const sigImporter = await signAsSafe(owner, "PurchaseOrder", counter);
    expect((await call(proposals, owner, P.importer, { params, body: { signature: sigImporter } })).body.status).toBe("fully_signed");
  });
});

describe("proposals: refused", () => {
  it("refuses a proposal from someone who does not represent po.importer", async () => {
    const { po, terms } = makeOrder();
    const r = await call(proposals, stranger, P.create, { body: { po, terms } });
    expect(r).toMatchObject({ status: 403, body: { error: "not_importer" } });
  });

  it("refuses tampered terms: the termsHash no longer matches", async () => {
    const { po, terms } = makeOrder();
    const r = await call(proposals, owner, P.create, { body: { po, terms: { ...terms, invoiceAmountMinor: 2_000_000n } } });
    expect(r).toMatchObject({ status: 422, body: { error: "invalid_order", problems: ["terms_hash"] } });
  });

  it("refuses an order id that is not keccak256(importer, exporter, nonce), and a wrong token", async () => {
    const { po, terms } = makeOrder({ token: stranger.address });
    const r = await call(proposals, owner, P.create, { body: { po: { ...po, nonce: 2n }, terms } });
    expect(r.body.problems).toEqual(expect.arrayContaining(["bad_order_id", "token_not_allowed"]));
  });

  it("refuses the same orderId twice and unknown fields", async () => {
    const { po, terms } = await proposed();
    expect((await call(proposals, owner, P.create, { body: { po, terms } })).body.error).toBe("proposal_exists");
    expect((await call(proposals, owner, P.create, { body: { po, terms, extra: 1 } })).body.error).toBe("bad_request");
  });

  it("only the exporter signs as exporter, with its own key, over this order", async () => {
    const { po, terms, params } = await proposed();
    const good = await signAs(exporter, "PurchaseOrder", po);
    expect((await call(proposals, owner, P.exporter, { params, body: { signature: good } })).body.error).toBe("not_exporter");
    const otherKey = await signAs(stranger, "PurchaseOrder", po);
    expect((await call(proposals, exporter, P.exporter, { params, body: { signature: otherKey } })).body.error).toBe("bad_exporter_signature");
    // A signature over different terms than the stored ones
    const tampered = await signAs(exporter, "PurchaseOrder", { ...po, payoutAddress: stranger.address });
    expect((await call(proposals, exporter, P.exporter, { params, body: { signature: tampered } })).body.error).toBe("bad_exporter_signature");
    // A counter offer whose terms do not match its termsHash
    const r = await call(proposals, exporter, P.exporter, { params, body: { signature: good, po, terms: { ...terms, hsCodes: ["090112"] } } });
    expect(r.body).toMatchObject({ error: "invalid_order", problems: ["terms_hash"] });
  });

  it("the importer cannot sign before the exporter, nor with a key that does not own the Safe", async () => {
    const { po, params } = await proposed();
    const sigImporter = await signAsSafe(owner, "PurchaseOrder", po);
    expect((await call(proposals, owner, P.importer, { params, body: { signature: sigImporter } })).body).toEqual({ error: "wrong_status", status: "awaiting_exporter" });
    await call(proposals, exporter, P.exporter, { params, body: { signature: await signAs(exporter, "PurchaseOrder", po) } });
    expect((await call(proposals, exporter, P.importer, { params, body: { signature: sigImporter } })).body.error).toBe("not_importer");
    const notOwner = await signAsSafe(stranger, "PurchaseOrder", po);
    expect((await call(proposals, owner, P.importer, { params, body: { signature: notOwner } })).body.error).toBe("bad_importer_signature");
  });

  it("two importer signatures at the same time: one wins, the other gets 409", async () => {
    const { po, params } = await proposed();
    await call(proposals, exporter, P.exporter, { params, body: { signature: await signAs(exporter, "PurchaseOrder", po) } });
    const sig = await signAsSafe(owner, "PurchaseOrder", po);
    const results = await Promise.all([1, 2].map(() => call(proposals, owner, P.importer, { params, body: { signature: sig } })));
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  });

  it("either side rejects while waiting; a fully signed proposal cannot be rejected; strangers see nothing", async () => {
    const { params } = await proposed();
    expect((await call(proposals, stranger, P.get, { params })).status).toBe(404);
    expect((await call(proposals, stranger, P.reject, { params })).status).toBe(404);
    const r = await call(proposals, exporter, P.reject, { params });
    expect(r.body).toMatchObject({ status: "rejected", rejectedBy: exporter.address.toLowerCase() });
    expect((await call(proposals, owner, P.reject, { params })).body).toEqual({ error: "wrong_status", status: "rejected" });
  });

  it("an unsigned request is refused before any route runs", async () => {
    expect((await call(proposals, null, P.list)).status).toBe(401);
  });
});
