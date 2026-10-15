import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type { CommercialInvoiceExtraction, TransportDocumentExtraction } from "@keel/schemas";
import { docsHash } from "@keel/schemas/hash";
import { renderFile } from "../testing/tradeCorpusRunner";
import { honestModel, runCorpus } from "../testing/tradeCorpusRunner";
import { ADVERSARIAL_CASES, LEGIT_SETS } from "../testing/tradeCorpus";
import { fileHash } from "./upload";

const CORPUS_DIR = new URL("../../../redteam/corpus/trade/", import.meta.url);

describe("Keel Trade corpus with an honest model", async () => {
  const result = await runCorpus(honestModel);

  it("has at least 12 legitimate sets and 25 adversarial variants (T3.8)", () => {
    expect(LEGIT_SETS).toHaveLength(12);
    expect(ADVERSARIAL_CASES.length).toBeGreaterThanOrEqual(25);
  });

  it("labels the engine decision of every document that reaches the engine, and only those", () => {
    for (const c of ADVERSARIAL_CASES) {
      expect(c.expected.engine !== undefined, c.id).toBe(c.expected.status === "ready");
      if (c.expected.engine?.decision === "release") expect(c.expected.conforms, c.id).toBe(true);
    }
  });

  it.each(result.legit.map((c) => [c.id, c] as const))("reads legitimate document %s end to end", (_id, c) => {
    expect(c.mismatches).toEqual([]);
  });

  it("assembles a complete package per order, with the docsHash of the shared helper", async () => {
    for (const [i, set] of LEGIT_SETS.entries()) {
      const hashes = [fileHash(await renderFile({ kind: "transport", spec: set.transport })), fileHash(await renderFile({ kind: "invoice", spec: set.invoice }))];
      expect(result.packages[i]).toEqual({ id: set.id, ok: true, docsHash: docsHash(hashes) });
    }
  });

  it.each(result.adversarial.map((c) => [c.id, c.title, c] as const))("%s %s", (_id, _title, c) => {
    expect(c.mismatches).toEqual([]);
  });
});

describe("Keel Trade corpus with a compromised model", async () => {
  // The model obeys the attacker: it shifts every value it can inside a valid schema
  const compromised = (truth: TransportDocumentExtraction | CommercialInvoiceExtraction) =>
    honestModel(
      "doc_type" in truth
        ? { ...truth, document_number: "ATTACKER0001", on_board_date: truth.on_board_date - 86_400 }
        : { ...truth, amount_minor: 100, order_number: "ATTACKER" },
    );
  const result = await runCorpus(compromised);

  it("never lets a bent reading through: every legitimate document is held with both values", () => {
    for (const c of result.legit) {
      expect(c.outcome).toMatchObject({ status: "held", reason: "disagreement" });
    }
    expect(result.packages.every((p) => !p.ok)).toBe(true);
  });

  it("never accepts an adversarial document that the honest pipeline would not accept", () => {
    for (const c of result.adversarial) {
      expect(c.outcome.status === "ready" && c.expected.status !== "ready").toBe(false);
    }
  });
});

describe("rendered corpus in redteam/corpus/trade", async () => {
  const manifest = JSON.parse(await readFile(new URL("manifest.json", CORPUS_DIR), "utf8")) as {
    documents: { path: string; fileHash: string }[];
  };

  it("matches the specs it was generated from (run `npm run corpus -w ingest` after changing them)", async () => {
    for (const doc of manifest.documents) {
      const bytes = new Uint8Array(await readFile(new URL(doc.path, CORPUS_DIR)));
      expect(fileHash(bytes), doc.path).toBe(doc.fileHash);
    }
    expect(manifest.documents.length).toBe(LEGIT_SETS.length * 2 + ADVERSARIAL_CASES.length);
  });
});
