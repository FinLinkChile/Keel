// The ingest Lambdas end to end with fakes: DynamoDB (FakeDynamo), the documents bucket
// (fakeObjects), the notices queue (a list) and the LLM (an honest double). No AWS account.
import { S3Client } from "@aws-sdk/client-s3";
import type { SSMClient } from "@aws-sdk/client-ssm";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2, SQSEvent } from "aws-lambda";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  fileHash,
  initialSettings,
  MAX_DOCUMENTS_PER_ORDER_PER_DAY,
  SettingsStore,
  staticImporters,
  uploadDomain,
  UPLOAD_TYPES,
  type BotPayload,
  type ExtractionRequest,
  type ExtractorProvider,
  type TradeOrderEntry,
} from "@keel/ingest";
import { renderCommercialInvoice, renderTransport } from "@keel/ingest/testing/renderTrade";
import { LEGIT_SETS, testAccount, type LegitSet } from "@keel/ingest/testing/tradeCorpus";
import { CORPUS_CHAIN_ID, honestModel } from "@keel/ingest/testing/tradeCorpusRunner";
import type { Hex, RequiredDocType } from "@keel/schemas";
import { blNumberHash } from "@keel/schemas/hash";
import { deployment, resetDeploymentCache } from "../config";
import type { NoticeMessage } from "../notices";
import { documentKey, s3Objects, S3_CLIENT_CONFIG } from "../ingest/objects";
import { appendOrderDocument, repoOrders } from "../ingest/orders";
import { DynamoIngestRepo, ingestKey } from "../ingest/repo";
import { llmKeys, settingsLoader, type IngestRuntime } from "../ingest/runtime";
import { dynamoSettingsBackend } from "../ingest/settings";
import { FakeDynamo } from "../testing/fakeDynamo";
import { fakeObjects, type FakeObjects } from "../testing/fakeObjects";
import { createAdminHandler } from "./admin";
import { runDigest } from "./digest";
import { createExtractorHandler } from "./extractor";
import { createInboundHandler } from "./inbound";
import { createProformaHandler } from "./proforma";
import { createUploadHandler } from "./upload";

const [O1] = LEGIT_SETS as [LegitSet];
const ADMIN_TOKEN = "a".repeat(40);
const WEBHOOK_TOKEN = "w".repeat(40);

beforeAll(async () => {
  // api() reads the deployment (chainId) from SSM once per container
  resetDeploymentCache();
  const ssm = {
    send: async () => ({
      Parameters: [
        { Name: "/keel/31337/chain-id", Value: String(CORPUS_CHAIN_ID) },
        { Name: "/keel/31337/escrow", Value: `0x${"e1".repeat(20)}` },
        { Name: "/keel/31337/safe", Value: `0x${"5a".repeat(20)}` },
      ],
    }),
  } as unknown as SSMClient;
  await deployment({ KEEL_CHAIN_ID: "31337" }, ssm);
});

const httpEvent = (routeKey: string, body: string, headers: Record<string, string> = {}) =>
  ({
    routeKey,
    rawPath: routeKey.split(" ")[1],
    body,
    isBase64Encoded: false,
    headers: { "content-type": "application/json", ...headers },
    requestContext: { http: { method: routeKey.split(" ")[0] } },
  }) as unknown as APIGatewayProxyEventV2;

const s3Event = (keys: string[], messageId = "m1") =>
  ({
    Records: [
      {
        messageId,
        body: JSON.stringify({
          Records: keys.map((key) => ({ eventName: "ObjectCreated:Put", s3: { bucket: { name: "docs" }, object: { key, size: 1 } } })),
        }),
      },
    ],
  }) as unknown as SQSEvent;

interface Harness {
  db: FakeDynamo;
  repo: DynamoIngestRepo;
  objects: FakeObjects;
  notices: NoticeMessage[];
  rt: IngestRuntime;
  llmCalls(): number;
  now(): number;
  advance(ms: number): void;
  addOrder(entry: TradeOrderEntry): Promise<void>;
  upload: ReturnType<typeof createUploadHandler>;
  extract: ReturnType<typeof createExtractorHandler>;
}

function harness(set: LegitSet = O1): Harness {
  let now = Date.UTC(2026, 9, 18, 12);
  let calls = 0;
  const db = new FakeDynamo({ ingest: { pk: "pk", sk: "sk" }, orders: { pk: "orderId" } });
  const repo = new DynamoIngestRepo("ingest", { client: db, now: () => new Date(now) });
  const objects = fakeObjects(() => now);
  const notices: NoticeMessage[] = [];
  // Reads correctly whichever document it is given
  const model: ExtractorProvider = {
    provider: "honest-double",
    model: "truth",
    complete: async (r: ExtractionRequest) => {
      calls++;
      return honestModel(r.schemaName === "transport_document_extraction" ? set.truth.transport : set.truth.invoice).complete(r);
    },
  };
  const rt: IngestRuntime = {
    repo,
    objects,
    settings: settingsLoader(repo, async () => ({ anthropic: "test-key" }), {}),
    extractor: async () => model,
    orders: repoOrders(repo),
    importers: staticImporters([testAccount(`${set.id}:importer`).address]),
    notify: async (m) => (notices.push(m), true),
    appendOrderDocument: (doc) => appendOrderDocument("orders", doc, db),
    now: () => new Date(now),
  };
  return {
    db,
    repo,
    objects,
    notices,
    rt,
    llmCalls: () => calls,
    now: () => now,
    advance: (ms) => (now += ms),
    async addOrder(entry) {
      await db.send(new PutCommand({ TableName: "ingest", Item: { ...ingestKey.orderEntry(entry.orderId), ...entry } }));
      await db.send(new PutCommand({ TableName: "orders", Item: { orderId: entry.orderId.toLowerCase(), createdAt: 1 } }));
    },
    upload: createUploadHandler(() => rt),
    extract: createExtractorHandler(() => rt),
  };
}

async function signedUpload(h: Harness, orderId: Hex, docType: RequiredDocType, hash: Hex, signer = testAccount(`${O1.id}:exporter`)) {
  const issuedAt = Math.floor(h.now() / 1000);
  const signature = await signer.signTypedData({
    domain: uploadDomain(CORPUS_CHAIN_ID),
    types: UPLOAD_TYPES,
    primaryType: "DocumentUpload",
    message: { orderId, docType, fileHash: hash, issuedAt: BigInt(issuedAt) },
  });
  return { orderId, docType, fileHash: hash, issuedAt, signature };
}

async function presign(h: Harness, body: object) {
  const res = (await h.upload(httpEvent("POST /trade/uploads", JSON.stringify(body)))) as APIGatewayProxyStructuredResultV2;
  return { status: res.statusCode, body: JSON.parse(res.body!) as Record<string, unknown> };
}

// Presign, PUT and deliver the S3 notification: what the app and AWS do together
async function uploadAndRead(h: Harness, orderId: Hex, docType: RequiredDocType, bytes: Uint8Array) {
  const r = await presign(h, { ...(await signedUpload(h, orderId, docType, fileHash(bytes))), size: bytes.byteLength });
  expect(r.status).toBe(200);
  const key = h.objects.clientPut(r.body.uploadUrl as string, bytes);
  expect(key).toBe(r.body.key);
  return h.extract(s3Event([key]));
}

const outcomes = (h: Harness) =>
  h.notices.map((n) => (n.kind === "ingest_outcome" ? (n.payload as BotPayload) : undefined)).filter((p) => p?.source === "trade_upload");

describe("presigned upload, end to end", () => {
  let h: Harness;
  beforeEach(async () => {
    h = harness();
    await h.addOrder(O1.order.entry);
  });

  it("presigns, reads the document when it lands, notifies, and hands the package to the agent", async () => {
    const invoice = await renderCommercialInvoice(O1.invoice);
    const body = { ...(await signedUpload(h, O1.order.orderId, "COMMERCIAL_INVOICE", fileHash(invoice))), size: invoice.byteLength };
    const r = await presign(h, body);
    expect(r).toEqual({
      status: 200,
      body: { uploadUrl: expect.stringContaining("https://"), key: documentKey(O1.order.orderId, fileHash(invoice)), expiresIn: 300 },
    });
    // A file of another length is refused by the URL itself
    expect(() => h.objects.clientPut(r.body.uploadUrl as string, new Uint8Array(10))).toThrow(/content-length/);
    h.objects.clientPut(r.body.uploadUrl as string, invoice);
    expect(await h.extract(s3Event([r.body.key as string]))).toEqual({ batchItemFailures: [] });

    expect(outcomes(h)).toMatchObject([{ source: "trade_upload", outcome: { status: "ready", fileHash: fileHash(invoice), docType: "COMMERCIAL_INVOICE" } }]);
    expect(await h.repo.upload(O1.order.orderId, fileHash(invoice))).toMatchObject({ readStatus: "ready" });
    expect(h.db.get("orders", { orderId: O1.order.orderId })).toMatchObject({
      documents: { extractions: { invoice: O1.truth.invoice }, fileHashes: [fileHash(invoice)] },
    });

    const bl = await renderTransport(O1.transport);
    expect(await uploadAndRead(h, O1.order.orderId, O1.order.requiredDocs[0]!, bl)).toEqual({ batchItemFailures: [] });
    expect(h.db.get("orders", { orderId: O1.order.orderId })).toMatchObject({
      documents: { extractions: { invoice: O1.truth.invoice, transport: O1.truth.transport }, fileHashes: [fileHash(invoice), fileHash(bl)] },
    });
    expect(await h.repo.tradePackage(O1.order.orderId, O1.order.requiredDocs)).toMatchObject({
      status: "complete",
      blNumberHash: blNumberHash(O1.order.entry.carrier, O1.truth.transport.document_number),
    });
  });

  it("is idempotent on SQS redelivery: one reading, one notice, one entry in the order", async () => {
    const invoice = await renderCommercialInvoice(O1.invoice);
    await uploadAndRead(h, O1.order.orderId, "COMMERCIAL_INVOICE", invoice);
    const calls = h.llmCalls();
    const key = documentKey(O1.order.orderId, fileHash(invoice));
    expect(await h.extract(s3Event([key], "m2"))).toEqual({ batchItemFailures: [] });
    expect(await h.extract(s3Event([key, key], "m3"))).toEqual({ batchItemFailures: [] });
    expect(h.llmCalls()).toBe(calls);
    expect(outcomes(h)).toHaveLength(1);
    expect(h.db.get("orders", { orderId: O1.order.orderId })!.documents).toMatchObject({ fileHashes: [fileHash(invoice)] });
  });

  it("retries a message whose upload another reader holds, and takes it over once the claim is stale", async () => {
    const invoice = await renderCommercialInvoice(O1.invoice);
    const r = await presign(h, { ...(await signedUpload(h, O1.order.orderId, "COMMERCIAL_INVOICE", fileHash(invoice))), size: invoice.byteLength });
    const key = h.objects.clientPut(r.body.uploadUrl as string, invoice);
    // A reader that crashed after claiming
    expect(await h.repo.claimReading(O1.order.orderId, fileHash(invoice), 1)).toBe(true);
    expect(await h.extract(s3Event([key], "busy"))).toEqual({ batchItemFailures: [{ itemIdentifier: "busy" }] });
    expect(outcomes(h)).toHaveLength(0);
    h.advance(16 * 60 * 1000);
    expect(await h.extract(s3Event([key], "later"))).toEqual({ batchItemFailures: [] });
    expect(outcomes(h)).toMatchObject([{ outcome: { status: "ready" } }]);
  });

  it("refuses a file whose keccak256 is not the hash the uploader signed, before the model", async () => {
    const signed = await renderCommercialInvoice(O1.invoice);
    // Same length, one byte changed after signing
    const swapped = signed.slice();
    swapped[swapped.length - 2] = swapped[swapped.length - 2]! ^ 0x01;
    const r = await presign(h, { ...(await signedUpload(h, O1.order.orderId, "COMMERCIAL_INVOICE", fileHash(signed))), size: signed.byteLength });
    const key = h.objects.clientPut(r.body.uploadUrl as string, swapped);
    expect(await h.extract(s3Event([key]))).toEqual({ batchItemFailures: [] });
    expect(h.objects.objects.has(key)).toBe(false);
    expect(h.llmCalls()).toBe(0);
    expect(outcomes(h)).toHaveLength(0);
    expect(await h.repo.upload(O1.order.orderId, fileHash(signed))).not.toHaveProperty("readStatus");
    expect(h.db.get("orders", { orderId: O1.order.orderId })!.documents).toBeUndefined();
    // The uploader can still PUT the file it signed with the same URL
    h.objects.clientPut(r.body.uploadUrl as string, signed);
    await h.extract(s3Event([key]));
    expect(outcomes(h)).toMatchObject([{ outcome: { status: "ready", fileHash: fileHash(signed) } }]);
  });

  it(`refuses the upload after ${MAX_DOCUMENTS_PER_ORDER_PER_DAY} in a day, and re-presigns a file not read yet without spending one`, async () => {
    const hash = (i: number) => `0x${(i + 1).toString(16).padStart(64, "0")}` as Hex;
    for (let i = 0; i < MAX_DOCUMENTS_PER_ORDER_PER_DAY; i++) {
      expect((await presign(h, { ...(await signedUpload(h, O1.order.orderId, "COMMERCIAL_INVOICE", hash(i))), size: 1000 })).status).toBe(200);
    }
    const again = await presign(h, { ...(await signedUpload(h, O1.order.orderId, "COMMERCIAL_INVOICE", hash(0))), size: 1000 });
    expect(again.status).toBe(200);
    const over = await presign(h, { ...(await signedUpload(h, O1.order.orderId, "COMMERCIAL_INVOICE", hash(99))), size: 1000 });
    expect(over).toEqual({ status: 429, body: expect.objectContaining({ status: "quarantined", reason: "rate_limited" }) });
    expect(await h.repo.uploadsForOrder(O1.order.orderId)).toBe(MAX_DOCUMENTS_PER_ORDER_PER_DAY);
    // Another party re-uploading a file already admitted is a duplicate, not a new URL
    const importer = testAccount(`${O1.id}:importer`);
    const dup = await presign(h, { ...(await signedUpload(h, O1.order.orderId, "COMMERCIAL_INVOICE", hash(0), importer)), size: 1000 });
    expect(dup).toEqual({ status: 409, body: expect.objectContaining({ status: "duplicate", reason: "same_file" }) });
  });

  it("rejects what is not signed by a party of the order, or not for this order", async () => {
    const hash = `0x${"77".repeat(32)}` as Hex;
    const outsider = await presign(h, { ...(await signedUpload(h, O1.order.orderId, "COMMERCIAL_INVOICE", hash, testAccount("outsider"))), size: 10 });
    expect(outsider).toEqual({ status: 403, body: { status: "rejected", reason: "not_a_party" } });
    const unknown = await presign(h, { ...(await signedUpload(h, `0x${"99".repeat(32)}`, "COMMERCIAL_INVOICE", hash)), size: 10 });
    expect(unknown).toEqual({ status: 404, body: { status: "rejected", reason: "unknown_order" } });
    const tooBig = await presign(h, { ...(await signedUpload(h, O1.order.orderId, "COMMERCIAL_INVOICE", hash)), size: 11 * 1024 * 1024 });
    expect(tooBig.status).toBe(400);
    expect(await h.repo.uploadsForOrder(O1.order.orderId)).toBe(0);
  });

  it("never reads an object nobody was authorized to upload", async () => {
    const bytes = await renderCommercialInvoice(O1.invoice);
    const key = documentKey(O1.order.orderId, fileHash(bytes));
    await h.objects.put(key, bytes, "application/pdf");
    expect(await h.extract(s3Event([key]))).toEqual({ batchItemFailures: [] });
    expect(h.objects.objects.has(key)).toBe(false);
    expect(h.llmCalls()).toBe(0);
    expect(outcomes(h)).toHaveLength(0);
  });

  it("refuses a bill of lading already accepted for another order of the same carrier, without calling the model", async () => {
    const other: TradeOrderEntry = { ...O1.order.entry, orderId: `0x${"0e".repeat(32)}` };
    await h.addOrder(other);
    const bl = await renderTransport(O1.transport);
    await uploadAndRead(h, O1.order.orderId, O1.order.requiredDocs[0]!, bl);
    const calls = h.llmCalls();
    // The same bill of lading, rendered again (another file), for the other order
    const again = await renderTransport({ ...O1.transport, seed: "copy" });
    expect(fileHash(again)).not.toBe(fileHash(bl));
    await uploadAndRead(h, other.orderId, O1.order.requiredDocs[0]!, again);
    expect(outcomes(h).at(-1)).toMatchObject({
      outcome: { status: "held", reason: "bl_used_by_other_order", orderId: other.orderId, blNumberHash: blNumberHash(O1.order.entry.carrier, O1.truth.transport.document_number) },
    });
    expect(h.llmCalls()).toBe(calls);
    expect(h.db.get("orders", { orderId: other.orderId })!.documents).toBeUndefined();
    expect(await h.repo.orderForBl(blNumberHash(O1.order.entry.carrier, O1.truth.transport.document_number))).toBe(O1.order.orderId.toLowerCase());
  });

  it("keeps POST /trade/documents: same authorization, the file in the body, read the same way", async () => {
    const invoice = await renderCommercialInvoice(O1.invoice);
    const { fileHash: _h, ...signed } = await signedUpload(h, O1.order.orderId, "COMMERCIAL_INVOICE", fileHash(invoice));
    const body = JSON.stringify({ ...signed, file: Buffer.from(invoice).toString("base64") });
    const res = (await h.upload(httpEvent("POST /trade/documents", body))) as APIGatewayProxyStructuredResultV2;
    expect(res.statusCode).toBe(202);
    expect(JSON.parse(res.body!)).toEqual({ status: "accepted_for_reading", orderId: O1.order.orderId, fileHash: fileHash(invoice) });
    await h.extract(s3Event([documentKey(O1.order.orderId, fileHash(invoice))]));
    expect(outcomes(h)).toMatchObject([{ outcome: { status: "ready" } }]);
    const again = (await h.upload(httpEvent("POST /trade/documents", body))) as APIGatewayProxyStructuredResultV2;
    expect(JSON.parse(again.body!)).toMatchObject({ status: "duplicate", reason: "same_file" });
  });
});

describe("the real presigned URL", () => {
  it("signs the content length and carries no checksum of an empty body", async () => {
    const s3 = new S3Client({ ...S3_CLIENT_CONFIG, region: "us-east-1", credentials: { accessKeyId: "AKIDEXAMPLE", secretAccessKey: "secret" } });
    const url = new URL(await s3Objects("keel-docs", s3).presignPut("orders/0xab/0xcd", 1234, 300));
    expect(url.pathname).toContain("orders/0xab/0xcd");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
    expect(url.searchParams.get("X-Amz-SignedHeaders")?.split(";")).toContain("content-length");
    expect([...url.searchParams.keys()].some((k) => /checksum/i.test(k))).toBe(false);
  });
});

describe("proforma, inbound and admin routes", () => {
  it("rejects a proforma not signed by a registered importer", async () => {
    const h = harness();
    const handler = createProformaHandler(() => h.rt);
    const pdf = await renderCommercialInvoice(O1.invoice);
    const issuedAt = Math.floor(h.now() / 1000);
    const signature = await testAccount("outsider").signTypedData({
      domain: uploadDomain(CORPUS_CHAIN_ID),
      types: { ProformaUpload: [{ name: "fileHash", type: "bytes32" }, { name: "issuedAt", type: "uint64" }] },
      primaryType: "ProformaUpload",
      message: { fileHash: fileHash(pdf), issuedAt: BigInt(issuedAt) },
    });
    const res = (await handler(
      httpEvent("POST /trade/proforma", JSON.stringify({ issuedAt, signature, file: Buffer.from(pdf).toString("base64") })),
    )) as APIGatewayProxyStructuredResultV2;
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body!)).toEqual({ status: "rejected", reason: "not_an_importer" });
    expect(h.llmCalls()).toBe(0);
  });

  it("refuses an inbound email without the webhook token, before storing anything", async () => {
    const h = harness();
    const handler = createInboundHandler(() => h.rt, async () => WEBHOOK_TOKEN);
    const res = (await handler(httpEvent("POST /inbound", "From: x@y.cl\r\n\r\nhi", { authorization: `Bearer ${ADMIN_TOKEN}` }))) as APIGatewayProxyStructuredResultV2;
    expect(res.statusCode).toBe(401);
    expect(h.objects.objects.size).toBe(0);
  });

  it("shares the settings between instances and audits who changed what", async () => {
    const h = harness();
    const instanceA = createAdminHandler(() => h.rt, async () => ADMIN_TOKEN);
    // Another Lambda instance: its own settings cache, the same table
    const rtB: IngestRuntime = { ...h.rt, settings: settingsLoader(h.repo, async () => ({ anthropic: "test-key" }), {}) };
    const instanceB = createAdminHandler(() => rtB, async () => ADMIN_TOKEN);
    const auth = { authorization: `Bearer ${ADMIN_TOKEN}` };
    const read = async (handler: typeof instanceA) =>
      JSON.parse(((await handler(httpEvent("GET /admin/settings", "", auth))) as APIGatewayProxyStructuredResultV2).body!);

    expect((await read(instanceB)).settings.requireDmarc).toBe(true);
    expect(((await instanceA(httpEvent("GET /admin/settings", "", { authorization: "Bearer nope" }))) as APIGatewayProxyStructuredResultV2).statusCode).toBe(401);
    const missingActor = (await instanceA(httpEvent("PUT /admin/settings", '{"requireDmarc":false}', auth))) as APIGatewayProxyStructuredResultV2;
    expect(missingActor.statusCode).toBe(400);

    const put = (await instanceA(
      httpEvent("PUT /admin/settings", '{"requireDmarc":false}', { ...auth, "x-admin-actor": "dani" }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(put.statusCode).toBe(200);
    expect(await read(instanceB)).toMatchObject({ settings: { requireDmarc: false }, updatedBy: "dani", availableProviders: ["anthropic"] });
    expect(h.db.items("ingest").filter((i) => String(i.pk).startsWith("audit#"))).toMatchObject([
      { type: "settings_changed", actor: "dani", changes: { requireDmarc: { from: true, to: false } } },
    ]);
    // A key is never accepted over the API
    const key = (await instanceA(httpEvent("PUT /admin/settings", '{"apiKey":"sk-x"}', { ...auth, "x-admin-actor": "dani" }))) as APIGatewayProxyStructuredResultV2;
    expect(key.statusCode).toBe(400);
  });

  it("refuses a change computed from settings another instance replaced", async () => {
    const h = harness();
    const keys = { anthropic: "test-key" };
    const a = await SettingsStore.open({ fallback: initialSettings({}), keys, backend: dynamoSettingsBackend("ingest", h.db) });
    const b = await SettingsStore.open({ fallback: initialSettings({}), keys, backend: dynamoSettingsBackend("ingest", h.db) });
    await a.update({ requireDmarc: false }, "ana");
    await expect(b.update({ model: "claude-other" }, "beto")).rejects.toThrow(/concurrently/);
    expect(b.get()).toMatchObject({ settings: { requireDmarc: false }, updatedBy: "ana" });
    await b.update({ model: "claude-other" }, "beto");
    await a.refresh();
    expect(a.get()).toMatchObject({ settings: { requireDmarc: false, model: "claude-other" }, updatedBy: "beto" });
  });
});

describe("daily digest", () => {
  it("sends the change requests since the last run once, and moves its cursors", async () => {
    const h = harness();
    await h.repo.addChangeRequest({
      aliasId: "LUZ",
      previous: [],
      proposed: [{ kind: "bank_account", value: "987654321" }],
      triggers: ["announced_in_document"],
      source: { fromDomain: "a.cl", auth: { spf: "pass", dkim: "pass", dmarc: "pass" } },
      documentHash: "d",
      messageHash: "m",
      createdAt: new Date(h.now()).toISOString(),
    });
    await h.repo.recordTransfers([{ destino: "anthropic", finalidad: "extraccion_documento_comercio" }]);
    h.advance(60_000);
    expect(await runDigest(h.rt)).toEqual({ changes: 1, transfers: 1 });
    expect(h.notices).toMatchObject([{ kind: "ingest_outcome", payload: { source: "change_digest", requests: [{ aliasId: "LUZ", status: "pending" }] } }]);
    h.advance(24 * 3600 * 1000);
    expect(await runDigest(h.rt)).toEqual({ changes: 0, transfers: 0 });
    expect(h.notices).toHaveLength(1);
    expect(await h.repo.digestCursor()).toEqual({ changes: new Date(h.now()).toISOString(), transfers: new Date(h.now()).toISOString() });
  });

  it("keeps the change cursor when the notice could not be queued", async () => {
    const h = harness();
    const rt = { ...h.rt, notify: async () => false };
    const created = await h.repo.addChangeRequest({
      aliasId: "LUZ",
      previous: [],
      proposed: [],
      triggers: ["announced_in_document"],
      source: { fromDomain: "a.cl", auth: { spf: "pass", dkim: "pass", dmarc: "pass" } },
      documentHash: "d",
      messageHash: "m",
      createdAt: new Date(h.now()).toISOString(),
    });
    expect(created).toBeDefined();
    h.advance(60_000);
    await runDigest(rt);
    h.advance(60_000);
    expect(await runDigest(h.rt)).toMatchObject({ changes: 1 });
  });
});

describe("llm_keys secret", () => {
  it("maps the secret's names to the providers, and ignores placeholders", () => {
    expect(llmKeys('{"anthropic":"ka","compat":"kc","gemini":"CAMBIAR","other":"x"}')).toEqual({ anthropic: "ka", "openai-compatible": "kc" });
    expect(() => llmKeys("not json")).toThrow(/llm_keys/);
  });
});
