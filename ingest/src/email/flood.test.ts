import { beforeAll, describe, expect, it } from "vitest";
import { ALIAS_IDS } from "@keel/schemas";
import type { ExtractorProvider, InvoiceDocument } from "../extractor";
import type { AliasTable } from "../parser";
import { CHANGE_COOLDOWN_DAYS, IngestStore, MAX_EMAILS_PER_SENDER_PER_DAY } from "../store";
import { composeEmail, fakeDns, makeDomain, signEmail, type Domain } from "../testing/renderEmail";
import { renderInvoice, sampleSpec, type InvoiceSpec } from "../testing/renderInvoice";
import { receiveEmail } from "./receive";

const ALIAS = ALIAS_IDS[0];
const IP = "203.0.113.5";
const DAY = 24 * 60 * 60 * 1000;

const aliases: AliasTable = [
  {
    alias: ALIAS,
    rut: "761234560",
    emailDomain: "aduanasperez.cl",
    knownDestinations: [{ kind: "bank_account", value: "123456789" }],
  },
];

let domain: Domain;
let resolver: ReturnType<typeof fakeDns>;

beforeAll(() => {
  domain = makeDomain("aduanasperez.cl");
  resolver = fakeDns([{ domain, options: { spfIps: [IP] } }]);
});

// Counts model calls and answers like an honest model for whatever folio it sees
function countingModel() {
  const model = {
    calls: 0,
    provider: "fake",
    model: "fake-1",
    async complete(doc: InvoiceDocument) {
      model.calls++;
      return JSON.stringify({
        alias_id: ALIAS,
        issuer_tax_id: /\[RUT_[0-9a-f]{8}\]/.exec(doc.text)![0],
        invoice_number: /N° (\d+)/.exec(doc.text)![1],
        period: "202610",
        amount_clp: 45990,
        due_date: "2026-10-20",
        mentions_account_change: false,
        hidden_text_detected: false,
      });
    },
  };
  return model satisfies ExtractorProvider;
}

function setup() {
  let now = Date.UTC(2026, 9, 12, 12);
  const store = new IngestStore(":memory:", () => new Date(now));
  const model = countingModel();
  let n = 0;
  const send = async (spec: Partial<InvoiceSpec> = {}, messageId = `m${n++}`) => {
    const pdf = await renderInvoice({ ...sampleSpec(), ...spec });
    const raw = await signEmail(composeEmail({ from: "facturas@aduanasperez.cl", pdfs: [pdf], messageId }), domain);
    return { raw, outcome: await receiveEmail(raw, { ip: IP }, aliases, model, { requireDmarc: true, store, resolver }) };
  };
  const resend = (raw: Buffer) => receiveEmail(raw, { ip: IP }, aliases, model, { requireDmarc: true, store, resolver });
  return { store, model, send, resend, advance: (ms: number) => (now += ms) };
}

const newAccount = { bankLines: ["Banco Estado Cuenta Corriente N° 987654321"] };

describe("duplicates", () => {
  it("discards the same message received twice", async () => {
    const t = setup();
    const { raw, outcome } = await t.send();
    expect(outcome.status).toBe("ready");
    expect(await t.resend(raw)).toMatchObject({ status: "duplicate" });
    expect(t.model.calls).toBe(1);
  });

  it("discards the same invoice in a new message without calling the model", async () => {
    const t = setup();
    const first = await t.send();
    const second = await t.send();
    expect(second.outcome).toMatchObject({ status: "duplicate", invoiceKey: (first.outcome as { invoiceKey: string }).invoiceKey });
    expect(t.model.calls).toBe(1);
  });
});

describe("sender rate limit", () => {
  it(`quarantines mail beyond ${MAX_EMAILS_PER_SENDER_PER_DAY} per day per domain, and recovers after a day`, async () => {
    const t = setup();
    for (let i = 0; i < MAX_EMAILS_PER_SENDER_PER_DAY; i++) {
      expect((await t.send({ folio: String(1000 + i) })).outcome.status).not.toBe("quarantined");
    }
    expect((await t.send({ folio: "2000" })).outcome).toMatchObject({ status: "quarantined", reason: "rate_limited" });
    t.advance(DAY + 1);
    expect((await t.send({ folio: "2001" })).outcome.status).toBe("ready");
  });
});

describe("change requests", () => {
  it("keeps at most one pending request per alias", async () => {
    const t = setup();
    const first = await t.send({ ...newAccount, folio: "1" });
    expect(first.outcome.status).toBe("change_requested");
    expect((await t.send({ ...newAccount, folio: "2" })).outcome).toMatchObject({
      status: "quarantined",
      reason: "change_pending",
    });
  });

  it(`pauses new requests for ${CHANGE_COOLDOWN_DAYS} days after a rejection or veto`, async () => {
    const t = setup();
    const first = await t.send({ ...newAccount, folio: "1" });
    if (first.outcome.status !== "change_requested") throw new Error("expected a change request");
    expect(t.store.resolveChange(first.outcome.changeRequest.id, "vetoed")).toBe(true);

    expect((await t.send({ ...newAccount, folio: "2" })).outcome).toMatchObject({
      status: "quarantined",
      reason: "change_cooldown",
    });
    t.advance(CHANGE_COOLDOWN_DAYS * DAY + 1);
    expect((await t.send({ ...newAccount, folio: "3" })).outcome.status).toBe("change_requested");
  });

  it("allows a new request right after an approval", async () => {
    const t = setup();
    const first = await t.send({ ...newAccount, folio: "1" });
    if (first.outcome.status !== "change_requested") throw new Error("expected a change request");
    t.store.resolveChange(first.outcome.changeRequest.id, "approved");
    expect((await t.send({ bankLines: ["Banco Chile Cuenta Corriente N° 555555555"], folio: "2" })).outcome.status).toBe(
      "change_requested",
    );
  });

  it("groups the day's requests into one digest", async () => {
    const t = setup();
    const since = new Date(Date.UTC(2026, 9, 12));
    await t.send({ ...newAccount, folio: "1" });
    const digest = t.store.changeDigest(since);
    expect(digest).toHaveLength(1);
    expect(digest[0]).toMatchObject({ aliasId: ALIAS, status: "pending", proposed: [{ value: "987654321" }] });
  });
});

describe("IngestStore", () => {
  it("enforces one pending request per alias in the database itself", () => {
    const store = new IngestStore(":memory:");
    const request = {
      aliasId: ALIAS,
      previous: [],
      proposed: [],
      triggers: ["announced_in_document" as const],
      source: { fromDomain: "a.cl", auth: { spf: "pass", dkim: "pass", dmarc: "pass" } },
      documentHash: "d",
      messageHash: "m",
      createdAt: new Date().toISOString(),
    };
    expect(store.addChangeRequest(request)).toBeDefined();
    expect(store.addChangeRequest(request)).toBeUndefined();
    expect(store.resolveChange(999, "approved")).toBe(false);
  });
});
