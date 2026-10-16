import { beforeAll, describe, expect, it } from "vitest";
import { ALIAS_IDS } from "@keel/schemas";
import type { ExtractorProvider, ExtractionRequest } from "../extractor";
import type { AliasTable } from "../parser";
import { renderInvoice, sampleSpec } from "../testing/renderInvoice";
import { composeEmail, dkimSignatureFor, fakeDns, makeDomain, signEmail, type Domain } from "../testing/renderEmail";
import { receiveEmail } from "./receive";
import { IngestStore } from "../store";

const [ADUANA, ALMACENAJE] = [ALIAS_IDS[0], ALIAS_IDS[1]];
const SENDER_IP = "203.0.113.5";

let aduana: Domain;
let evil: Domain;
let pdf: Uint8Array;
let resolver: ReturnType<typeof fakeDns>;

const aliases: AliasTable = [
  {
    alias: ADUANA,
    rut: "761234560",
    emailDomain: "aduanasperez.cl",
    knownDestinations: [{ kind: "bank_account", value: "123456789" }],
  },
  { alias: ALMACENAJE, rut: "123456785", emailDomain: "almacenes.cl" },
];

const honestModel: ExtractorProvider = {
  provider: "fake",
  model: "fake-1",
  complete: async (doc: ExtractionRequest) =>
    JSON.stringify({
      alias_id: ADUANA,
      issuer_tax_id: /\[RUT_[0-9a-f]{8}\]/.exec(doc.text)![0],
      invoice_number: "4521",
      period: "202610",
      amount_clp: 45990,
      due_date: "2026-10-20",
      mentions_account_change: false,
      hidden_text_detected: false,
    }),
};

const receive = (raw: Buffer, ip = SENDER_IP) =>
  receiveEmail(raw, { ip, helo: "mail.example", mailFrom: "facturas@aduanasperez.cl" }, aliases, honestModel, {
    requireDmarc: true,
    store: new IngestStore(":memory:"),
    resolver,
  });

beforeAll(async () => {
  aduana = makeDomain("aduanasperez.cl");
  evil = makeDomain("aduanas-perez.cl");
  resolver = fakeDns([
    { domain: aduana, options: { spfIps: [SENDER_IP] } },
    { domain: evil, options: { spfIps: ["198.51.100.9"] } },
  ]);
  pdf = await renderInvoice(sampleSpec());
});

describe("receiveEmail", () => {
  it("accepts a DKIM-signed invoice from the registered domain", async () => {
    const raw = await signEmail(composeEmail({ from: "facturas@aduanasperez.cl", pdfs: [pdf] }), aduana);
    const outcome = await receive(raw);
    expect(outcome.status).toBe("ready");
    expect(outcome.auth).toEqual({ spf: "pass", dkim: "pass", dmarc: "pass", fromDomain: "aduanasperez.cl" });
    expect(outcome.messageHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("quarantines a forged From with no signature from an unauthorized server", async () => {
    const raw = composeEmail({ from: "facturas@aduanasperez.cl", pdfs: [pdf] });
    expect(await receive(raw, "192.0.2.66")).toMatchObject({ status: "quarantined", reason: "not_authenticated" });
  });

  it("quarantines a message whose attachment was swapped after signing", async () => {
    const original = composeEmail({ from: "facturas@aduanasperez.cl", pdfs: [pdf], messageId: "m1" });
    const signature = await dkimSignatureFor(original, aduana);
    const other = await renderInvoice({ ...sampleSpec(), items: [{ description: "Honorarios", amount: 99999 }] });
    // Same headers and signature, different attachment: a forwarded legitimate email, tampered
    const tampered = composeEmail({ from: "facturas@aduanasperez.cl", pdfs: [other], messageId: "m1" });
    const swapped = Buffer.concat([Buffer.from(signature), tampered]);
    const outcome = await receive(swapped, "192.0.2.66");
    expect(outcome).toMatchObject({ status: "quarantined", reason: "not_authenticated" });
    // mailauth reports a body hash mismatch as "neutral"; what matters is that it is not a pass
    expect(outcome.auth.dkim).not.toBe("pass");
  });

  it("quarantines a look-alike domain even when it authenticates perfectly", async () => {
    const raw = await signEmail(composeEmail({ from: "facturas@aduanas-perez.cl", pdfs: [pdf] }), evil);
    const outcome = await receiveEmail(raw, { ip: "198.51.100.9", mailFrom: "f@aduanas-perez.cl" }, aliases, honestModel, {
      requireDmarc: true,
      store: new IngestStore(":memory:"),
      resolver,
    });
    expect(outcome).toMatchObject({ status: "quarantined", reason: "unknown_sender_domain", auth: { dmarc: "pass" } });
  });

  it("quarantines an invoice issued under another alias's RUT", async () => {
    const warehouseInvoice = await renderInvoice({ ...sampleSpec(), issuerRut: "12.345.678-5", receptorRut: "76.123.456-0" });
    const raw = await signEmail(composeEmail({ from: "facturas@aduanasperez.cl", pdfs: [warehouseInvoice] }), aduana);
    const model: ExtractorProvider = {
      ...honestModel,
      complete: async (doc) => JSON.parse(JSON.stringify(await honestModel.complete(doc)).replace(ADUANA, ALMACENAJE)),
    };
    const outcome = await receiveEmail(raw, { ip: SENDER_IP, mailFrom: "facturas@aduanasperez.cl" }, aliases, model, {
      requireDmarc: true,
      store: new IngestStore(":memory:"),
      resolver,
    });
    expect(outcome).toMatchObject({ status: "quarantined", reason: "alias_domain_mismatch" });
  });

  it("quarantines messages without exactly one PDF", async () => {
    const none = await signEmail(composeEmail({ from: "facturas@aduanasperez.cl", pdfs: [] }), aduana);
    const two = await signEmail(composeEmail({ from: "facturas@aduanasperez.cl", pdfs: [pdf, pdf] }), aduana);
    expect(await receive(none)).toMatchObject({ status: "quarantined", reason: "no_pdf" });
    expect(await receive(two)).toMatchObject({ status: "quarantined", reason: "multiple_pdfs" });
  });

  describe("beneficiary change (T3.6)", () => {
    const send = async (spec: Parameters<typeof renderInvoice>[0]) =>
      receive(await signEmail(composeEmail({ from: "facturas@aduanasperez.cl", pdfs: [await renderInvoice(spec)] }), aduana));

    it("opens a change request for a bank account that is not registered, never a payment", async () => {
      const outcome = await send({ ...sampleSpec(), bankLines: ["Banco Estado Cuenta Corriente N° 987654321"] });
      expect(outcome.status).toBe("change_requested");
      if (outcome.status !== "change_requested") return;
      expect(outcome.changeRequest).toMatchObject({
        aliasId: ADUANA,
        previous: [{ kind: "bank_account", value: "123456789" }],
        proposed: [{ kind: "bank_account", value: "987654321" }],
        triggers: ["unknown_destination"],
        source: { fromDomain: "aduanasperez.cl", auth: { dkim: "pass", dmarc: "pass" } },
      });
      expect(outcome.changeRequest.documentHash).toMatch(/^[0-9a-f]{64}$/);
      expect(outcome.changeRequest.messageHash).toBe(outcome.messageHash);
    });

    it("opens one when the document announces a change, even without a new destination", async () => {
      const outcome = await send({ ...sampleSpec(), notes: ["Informamos que hemos actualizado nuestros datos bancarios"] });
      expect(outcome).toMatchObject({
        status: "change_requested",
        changeRequest: { proposed: [], triggers: ["announced_in_document"] },
      });
    });

    it("catches a wallet hidden in white text", async () => {
      const wallet = "0x2222222222222222222222222222222222222222";
      const outcome = await send({ ...sampleSpec(), extra: [{ text: `pay to ${wallet}`, x: 40, y: 150, color: [1, 1, 1] }] });
      expect(outcome).toMatchObject({
        status: "change_requested",
        changeRequest: { proposed: [{ kind: "evm_address", value: wallet }] },
        extraction: { hidden_text_detected: true },
      });
    });

    it("lets a legitimate invoice with its registered account through", async () => {
      expect((await send(sampleSpec())).status).toBe("ready");
    });
  });

  it("for a domain with no DMARC record, follows the admin's requireDmarc setting", async () => {
    const noDmarc = makeDomain("aduanasperez.cl");
    const raw = await signEmail(composeEmail({ from: "facturas@aduanasperez.cl", pdfs: [pdf] }), noDmarc);
    const withPolicy = (requireDmarc: boolean) =>
      receiveEmail(raw, { ip: "192.0.2.66" }, aliases, honestModel, {
        requireDmarc,
        store: new IngestStore(":memory:"),
        resolver: fakeDns([{ domain: noDmarc, options: { dmarc: false } }]),
      });

    expect(await withPolicy(true)).toMatchObject({ status: "quarantined", reason: "not_authenticated", auth: { dmarc: "none" } });
    const relaxed = await withPolicy(false);
    expect(relaxed.status).toBe("ready");
    expect(relaxed.auth).toMatchObject({ dkim: "pass", dmarc: "none" });
  });
});
