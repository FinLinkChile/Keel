// The contract of IngestRepo (../repo.ts), run against every implementation: IngestStore here
// (../repo.test.ts) and the DynamoDB repo in aws/src/ingest/repo.test.ts. A guarantee that only
// one implementation keeps is not a guarantee, so every rule the pipeline relies on is here.
import { describe, expect, it } from "vitest";
import type { Hex } from "@keel/schemas";
import { docsHash } from "@keel/schemas/hash";
import type { ChangeRequest } from "../beneficiaryChange";
import {
  CHANGE_COOLDOWN_DAYS,
  DAY_MS,
  MAX_DOCUMENTS_PER_ORDER_PER_DAY,
  MAX_EMAILS_PER_SENDER_PER_DAY,
  READ_EXTRACTOR_FAILED,
  type IngestRepo,
  type UploadEntry,
} from "../repo";
import type { AccountAlert } from "../trade/accountAlert";

export interface RepoHarness {
  repo: IngestRepo;
  advance(ms: number): void;
}

// `make` receives the clock the repo must use
export type RepoFactory = (now: () => Date) => IngestRepo | Promise<IngestRepo>;

const word = (n: number): Hex => `0x${n.toString(16).padStart(64, "0")}`;
const addr = (n: number): Hex => `0x${n.toString(16).padStart(40, "0")}`;

// Mixed case on purpose: an order id is the same order whatever its case
const ORDER_A = `0x${"Ab".repeat(32)}` as Hex;
const ORDER_B = `0x${"cd".repeat(32)}` as Hex;

const entry = (orderId: Hex, n: number, over: Partial<UploadEntry> = {}): UploadEntry => ({
  orderId,
  fileHash: word(n),
  docType: "COMMERCIAL_INVOICE",
  uploader: addr(7),
  party: "exporter",
  ...over,
});

const changeRequest = (aliasId: ChangeRequest["aliasId"], messageHash = "m"): ChangeRequest => ({
  aliasId,
  previous: [],
  proposed: [{ kind: "bank_account", value: "987654321" }],
  triggers: ["announced_in_document"],
  source: { fromDomain: "a.cl", auth: { spf: "pass", dkim: "pass", dmarc: "pass" } },
  documentHash: "d",
  messageHash,
  createdAt: "2026-10-12T12:00:00.000Z",
});

const alert = (orderId: Hex, n: number): AccountAlert => ({
  orderId,
  docType: "COMMERCIAL_INVOICE",
  triggers: ["announced_in_document"],
  found: [],
  source: { channel: "app", uploader: addr(7), party: "exporter" },
  documentHash: word(n),
  reminder: "payout_changes_only_with_new_signed_order",
  createdAt: "2026-10-12T12:00:00.000Z",
});

export function describeIngestRepo(name: string, make: RepoFactory): void {
  const setup = async (): Promise<RepoHarness> => {
    // Noon UTC, so the tests that stay within "a day" never cross midnight
    let now = Date.UTC(2026, 9, 12, 12);
    const repo = await make(() => new Date(now));
    return { repo, advance: (ms) => (now += ms) };
  };

  describe(`IngestRepo contract: ${name}`, () => {
    describe("email", () => {
      it("records a message once and counts the sender's messages of the day", async () => {
        const { repo, advance } = await setup();
        expect(await repo.recordEmail("h1", "a.cl")).toBe(true);
        expect(await repo.recordEmail("h1", "a.cl")).toBe(false);
        expect(await repo.recordEmail("h2", "a.cl")).toBe(true);
        expect(await repo.recordEmail("h3", "b.cl")).toBe(true);
        expect(await repo.emailsFromSender("a.cl")).toBe(2);
        expect(await repo.emailsFromSender("c.cl")).toBe(0);
        advance(DAY_MS + 1);
        expect(await repo.emailsFromSender("a.cl")).toBe(0);
        // A message stays a duplicate forever, not only for a day
        expect(await repo.recordEmail("h1", "a.cl")).toBe(false);
      });

      it(`counts past ${MAX_EMAILS_PER_SENDER_PER_DAY} so the caller can quarantine`, async () => {
        const { repo } = await setup();
        for (let i = 0; i <= MAX_EMAILS_PER_SENDER_PER_DAY; i++) await repo.recordEmail(`m${i}`, "a.cl");
        expect(await repo.emailsFromSender("a.cl")).toBe(MAX_EMAILS_PER_SENDER_PER_DAY + 1);
      });

      it("remembers invoices", async () => {
        const { repo } = await setup();
        expect(await repo.hasInvoice("k1")).toBe(false);
        await repo.recordInvoice("k1", "h1");
        await repo.recordInvoice("k1", "h2");
        expect(await repo.hasInvoice("k1")).toBe(true);
      });
    });

    describe("beneficiary change requests", () => {
      it("keeps at most one pending request per alias", async () => {
        const { repo } = await setup();
        const first = await repo.addChangeRequest(changeRequest("LUZ"));
        expect(first).toMatchObject({ aliasId: "LUZ", status: "pending" });
        expect(await repo.addChangeRequest(changeRequest("LUZ", "m2"))).toBeUndefined();
        expect(await repo.addChangeRequest(changeRequest("INTERNET"))).toMatchObject({ aliasId: "INTERNET" });
        expect(await repo.pendingChange("LUZ")).toEqual(first);
        expect(await repo.pendingChange("ARRIENDO")).toBeUndefined();
      });

      it("resolves a pending request once, and frees the alias", async () => {
        const { repo } = await setup();
        const first = (await repo.addChangeRequest(changeRequest("LUZ")))!;
        expect(await repo.resolveChange(first.id, "approved")).toBe(true);
        expect(await repo.resolveChange(first.id, "rejected")).toBe(false);
        expect(await repo.resolveChange(999_999, "approved")).toBe(false);
        expect(await repo.pendingChange("LUZ")).toBeUndefined();
        expect(await repo.inCooldown("LUZ")).toBe(false);
        const second = await repo.addChangeRequest(changeRequest("LUZ", "m2"));
        expect(second?.id).not.toBe(first.id);
      });

      it(`pauses the alias for ${CHANGE_COOLDOWN_DAYS} days after a rejection or a veto`, async () => {
        const { repo, advance } = await setup();
        for (const resolution of ["rejected", "vetoed"] as const) {
          const alias = resolution === "rejected" ? "LUZ" : "INTERNET";
          const r = (await repo.addChangeRequest(changeRequest(alias)))!;
          expect(await repo.inCooldown(alias)).toBe(false);
          expect(await repo.resolveChange(r.id, resolution)).toBe(true);
          expect(await repo.inCooldown(alias)).toBe(true);
        }
        advance(CHANGE_COOLDOWN_DAYS * DAY_MS + 1);
        expect(await repo.inCooldown("LUZ")).toBe(false);
        expect(await repo.inCooldown("INTERNET")).toBe(false);
      });

      it("lists the requests created since a moment, oldest first, with their current status", async () => {
        const { repo, advance } = await setup();
        const old = (await repo.addChangeRequest(changeRequest("LUZ")))!;
        advance(DAY_MS);
        const since = new Date(Date.UTC(2026, 9, 13, 12));
        const a = (await repo.addChangeRequest(changeRequest("INTERNET")))!;
        advance(1000);
        const b = (await repo.addChangeRequest(changeRequest("ARRIENDO")))!;
        await repo.resolveChange(a.id, "vetoed");
        const digest = await repo.changeDigest(since);
        expect(digest.map((r) => r.id)).toEqual([a.id, b.id]);
        expect(digest[0]).toMatchObject({ aliasId: "INTERNET", status: "vetoed", proposed: [{ value: "987654321" }] });
        expect(digest[0]!.resolvedAt).toBe(new Date(Date.UTC(2026, 9, 13, 12, 0, 1)).toISOString());
        expect(digest[1]).toMatchObject({ aliasId: "ARRIENDO", status: "pending" });
        expect((await repo.changeDigest(new Date(0))).map((r) => r.id)).toEqual([old.id, a.id, b.id]);
      });
    });

    describe("trade uploads", () => {
      it("admits a file once per order", async () => {
        const { repo } = await setup();
        expect(await repo.admitUpload(entry(ORDER_A, 1))).toBe("admitted");
        expect(await repo.admitUpload(entry(ORDER_A, 1))).toBe("duplicate");
        expect(await repo.admitUpload(entry(ORDER_A.toLowerCase() as Hex, 1))).toBe("duplicate");
        expect(await repo.admitUpload(entry(ORDER_B, 1))).toBe("admitted");
        expect(await repo.upload(ORDER_A, word(1))).toMatchObject({
          orderId: ORDER_A.toLowerCase(),
          fileHash: word(1),
          docType: "COMMERCIAL_INVOICE",
          uploader: addr(7),
          party: "exporter",
          receivedAt: new Date(Date.UTC(2026, 9, 12, 12)).toISOString(),
        });
        expect(await repo.upload(ORDER_A, word(2))).toBeUndefined();
      });

      it("counts the daily limit per party: one party cannot exhaust the other's uploads", async () => {
        const { repo, advance } = await setup();
        for (let i = 0; i < MAX_DOCUMENTS_PER_ORDER_PER_DAY; i++) {
          expect(await repo.admitUpload(entry(ORDER_A, i, { party: "importer", uploader: addr(8) }))).toBe("admitted");
        }
        expect(await repo.admitUpload(entry(ORDER_A, 100, { party: "importer", uploader: addr(8) }))).toBe("rate_limited");
        expect(await repo.admitUpload(entry(ORDER_A, 101, { party: "exporter" }))).toBe("admitted");
        expect(await repo.uploadsForOrder(ORDER_A, "importer")).toBe(MAX_DOCUMENTS_PER_ORDER_PER_DAY);
        expect(await repo.uploadsForOrder(ORDER_A, "exporter")).toBe(1);
        expect(await repo.uploadsForOrder(ORDER_A)).toBe(MAX_DOCUMENTS_PER_ORDER_PER_DAY + 1);
        advance(DAY_MS + 1);
        expect(await repo.admitUpload(entry(ORDER_A, 102, { party: "importer", uploader: addr(8) }))).toBe("admitted");
      });

      it(`refuses the upload after ${MAX_DOCUMENTS_PER_ORDER_PER_DAY} in a day, records nothing, and lets other orders through`, async () => {
        const { repo, advance } = await setup();
        for (let i = 0; i < MAX_DOCUMENTS_PER_ORDER_PER_DAY; i++) expect(await repo.admitUpload(entry(ORDER_A, i))).toBe("admitted");
        expect(await repo.uploadsForOrder(ORDER_A)).toBe(MAX_DOCUMENTS_PER_ORDER_PER_DAY);
        expect(await repo.admitUpload(entry(ORDER_A, 100))).toBe("rate_limited");
        expect(await repo.upload(ORDER_A, word(100))).toBeUndefined();
        expect(await repo.uploadsForOrder(ORDER_A)).toBe(MAX_DOCUMENTS_PER_ORDER_PER_DAY);
        // A duplicate stays a duplicate even over the limit
        expect(await repo.admitUpload(entry(ORDER_A, 0))).toBe("duplicate");
        expect(await repo.admitUpload(entry(ORDER_B, 100))).toBe("admitted");
        advance(DAY_MS + 1);
        expect(await repo.admitUpload(entry(ORDER_A, 100))).toBe("admitted");
      });

      it("takes the limit atomically: concurrent uploads never exceed it", async () => {
        const { repo } = await setup();
        const results = await Promise.all(Array.from({ length: 15 }, (_, i) => repo.admitUpload(entry(ORDER_A, i))));
        expect(results.filter((r) => r === "admitted")).toHaveLength(MAX_DOCUMENTS_PER_ORDER_PER_DAY);
        expect(results.filter((r) => r === "rate_limited")).toHaveLength(15 - MAX_DOCUMENTS_PER_ORDER_PER_DAY);
      });

      it("lets one reader claim an admitted upload, again only when the claim is stale, never once finished", async () => {
        const { repo, advance } = await setup();
        expect(await repo.claimReading(ORDER_A, word(1), 60_000)).toBe(false);
        await repo.admitUpload(entry(ORDER_A, 1));
        expect(await repo.claimReading(ORDER_A, word(1), 60_000)).toBe(true);
        expect(await repo.claimReading(ORDER_A, word(1), 60_000)).toBe(false);
        advance(60_001);
        expect(await repo.claimReading(ORDER_A.toLowerCase() as Hex, word(1), 60_000)).toBe(true);
        await repo.finishReading(ORDER_A, word(1), "ready");
        advance(120_000);
        expect(await repo.claimReading(ORDER_A, word(1), 60_000)).toBe(false);
        expect(await repo.upload(ORDER_A, word(1))).toMatchObject({ readStatus: "ready" });
      });
    });

    describe("giving a reading back", () => {
      it("drops the claim of an unfinished reading so the next reader takes it at once", async () => {
        const { repo } = await setup();
        expect(await repo.releaseReading(ORDER_A, word(1))).toBe(false);
        await repo.admitUpload(entry(ORDER_A, 1));
        expect(await repo.claimReading(ORDER_A, word(1), 60_000)).toBe(true);
        expect(await repo.claimReading(ORDER_A, word(1), 60_000)).toBe(false);
        expect(await repo.releaseReading(ORDER_A.toLowerCase() as Hex, word(1))).toBe(true);
        expect(await repo.upload(ORDER_A, word(1))).not.toHaveProperty("readClaimedAt");
        expect(await repo.claimReading(ORDER_A, word(1), 60_000)).toBe(true);
      });

      it("reopens a reading that ended as extractor_failed, and never one that ended otherwise", async () => {
        const { repo } = await setup();
        await repo.admitUpload(entry(ORDER_A, 1));
        await repo.admitUpload(entry(ORDER_A, 2));
        await repo.claimReading(ORDER_A, word(1), 60_000);
        await repo.finishReading(ORDER_A, word(1), READ_EXTRACTOR_FAILED);
        await repo.claimReading(ORDER_A, word(2), 60_000);
        await repo.finishReading(ORDER_A, word(2), "ready");
        expect(await repo.claimReading(ORDER_A, word(1), 0)).toBe(false);
        expect(await repo.releaseReading(ORDER_A, word(2))).toBe(false);
        expect(await repo.upload(ORDER_A, word(2))).toMatchObject({ readStatus: "ready" });
        expect(await repo.releaseReading(ORDER_A, word(1))).toBe(true);
        const reopened = await repo.upload(ORDER_A, word(1));
        expect(reopened).not.toHaveProperty("readStatus");
        expect(reopened).not.toHaveProperty("readClaimedAt");
        expect(await repo.claimReading(ORDER_A, word(1), 60_000)).toBe(true);
      });
    });

    describe("accepted documents and the package", () => {
      const BL = word(0xb1);

      it("returns the accepted record of a file, for a reading that is retried", async () => {
        const { repo } = await setup();
        expect(await repo.acceptedDocument(ORDER_A, word(1))).toBeUndefined();
        await repo.acceptDocument({ orderId: ORDER_A, fileHash: word(1), docType: "BILL_OF_LADING", blHash: BL, extraction: { n: 1 } });
        await repo.acceptDocument({ orderId: ORDER_A, fileHash: word(2), docType: "COMMERCIAL_INVOICE", extraction: { n: 2 } });
        expect(await repo.acceptedDocument(ORDER_A.toLowerCase() as Hex, word(1))).toEqual({ docType: "BILL_OF_LADING", blHash: BL, extraction: { n: 1 } });
        expect(await repo.acceptedDocument(ORDER_A, word(2))).toEqual({ docType: "COMMERCIAL_INVOICE", extraction: { n: 2 } });
        expect(await repo.acceptedDocument(ORDER_B, word(1))).toBeUndefined();
      });

      it("accepts a bill of lading for one order only", async () => {
        const { repo } = await setup();
        const doc = { orderId: ORDER_A, fileHash: word(1), docType: "BILL_OF_LADING" as const, blHash: BL, extraction: { n: 1 } };
        expect(await repo.orderForBl(BL)).toBeUndefined();
        expect(await repo.acceptDocument(doc)).toBe(true);
        expect(await repo.orderForBl(BL)).toBe(ORDER_A.toLowerCase());
        // The same file again (a redelivered reading) is still accepted
        expect(await repo.acceptDocument(doc)).toBe(true);
        expect(await repo.acceptDocument({ ...doc, orderId: ORDER_B, fileHash: word(2) })).toBe(false);
        expect(await repo.acceptDocument({ ...doc, fileHash: word(3) })).toBe(false);
        expect(await repo.orderForBl(BL)).toBe(ORDER_A.toLowerCase());
        expect(await repo.tradePackage(ORDER_B, ["BILL_OF_LADING"])).toEqual({ status: "incomplete", missing: ["BILL_OF_LADING"] });
      });

      it("returns the package once complete, and ambiguous with two documents of a type", async () => {
        const { repo, advance } = await setup();
        const required = ["BILL_OF_LADING", "COMMERCIAL_INVOICE"] as const;
        await repo.acceptDocument({ orderId: ORDER_A, fileHash: word(2), docType: "COMMERCIAL_INVOICE", extraction: { inv: 1 } });
        expect(await repo.tradePackage(ORDER_A, required)).toEqual({ status: "incomplete", missing: ["BILL_OF_LADING"] });
        advance(1000);
        await repo.acceptDocument({ orderId: ORDER_A, fileHash: word(1), docType: "BILL_OF_LADING", blHash: BL, extraction: { bl: 1 } });
        expect(await repo.tradePackage(ORDER_A.toLowerCase() as Hex, required)).toEqual({
          status: "complete",
          docsHash: docsHash([word(1), word(2)]),
          blNumberHash: BL,
          documents: [
            { docType: "BILL_OF_LADING", fileHash: word(1), extraction: { bl: 1 } },
            { docType: "COMMERCIAL_INVOICE", fileHash: word(2), extraction: { inv: 1 } },
          ],
        });
        await repo.acceptDocument({ orderId: ORDER_A, fileHash: word(3), docType: "COMMERCIAL_INVOICE", extraction: { inv: 2 } });
        expect(await repo.tradePackage(ORDER_A, required)).toEqual({ status: "ambiguous", docType: "COMMERCIAL_INVOICE" });
      });

      it("numbers alerts and lists them since a moment", async () => {
        const { repo, advance } = await setup();
        const a = await repo.addAlert(alert(ORDER_A, 1));
        advance(DAY_MS);
        const since = new Date(Date.UTC(2026, 9, 13, 12));
        const b = await repo.addAlert(alert(ORDER_A, 2));
        const c = await repo.addAlert(alert(ORDER_B, 3));
        expect(new Set([a, b, c]).size).toBe(3);
        expect(await repo.alertDigest(since)).toEqual([
          { ...alert(ORDER_A, 2), id: b },
          { ...alert(ORDER_B, 3), id: c },
        ]);
        expect(await repo.alertDigest(new Date(0))).toHaveLength(3);
      });
    });

    describe("proformas", () => {
      it("counts an importer's uploads of the day and keeps each reading", async () => {
        const { repo, advance } = await setup();
        const importer = `0x${"Ef".repeat(20)}` as Hex;
        await repo.recordProformaUpload(importer, word(1));
        await repo.recordProformaUpload(importer.toLowerCase() as Hex, word(1));
        expect(await repo.proformaUploadsToday(importer)).toBe(2);
        expect(await repo.proformaUploadsToday(addr(1))).toBe(0);
        expect(await repo.proformaReading(importer, word(1))).toBeUndefined();
        await repo.saveProformaReading(importer, word(1), { input: "text", proforma: { total: 1 } });
        expect(await repo.proformaReading(importer.toLowerCase() as Hex, word(1))).toEqual({ input: "text", proforma: { total: 1 } });
        advance(DAY_MS + 1);
        expect(await repo.proformaUploadsToday(importer)).toBe(0);
      });
    });
  });
}
