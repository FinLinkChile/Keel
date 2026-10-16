import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { keccak256 } from "viem";
import type { InvoiceExtraction } from "@keel/schemas";
import { renderInvoice } from "./testing/renderInvoice";
import { honestInvoiceModel, PERSONAL_CASES, PERSONAL_LEGIT, renderCase, runPersonalCorpus } from "./testing/personalCorpus";

const CORPUS_DIR = new URL("../../redteam/corpus/personal/", import.meta.url);

describe("Keel Personal corpus with an honest model", async () => {
  const result = await runPersonalCorpus(honestInvoiceModel);

  it("has at least 12 legitimate bills over 3 periods and 25 adversarial variants (T3.8)", () => {
    expect(PERSONAL_LEGIT).toHaveLength(12);
    expect(new Set(PERSONAL_LEGIT.map((l) => l.truth.period)).size).toBe(3);
    expect(PERSONAL_CASES.length).toBeGreaterThanOrEqual(25);
  });

  it.each(result.legit.map((c) => [c.id, c] as const))("reads legitimate bill %s end to end", (_id, c) => {
    expect(c.mismatches).toEqual([]);
  });

  it.each(result.adversarial.map((c) => [c.id, c.title, c] as const))("%s %s", (_id, _title, c) => {
    expect(c.mismatches).toEqual([]);
  });
});

describe("Keel Personal corpus with a compromised model", async () => {
  // The model obeys the attacker inside a valid schema: another amount and another folio
  const compromised = (truth: InvoiceExtraction) =>
    honestInvoiceModel({ ...truth, amount_clp: truth.amount_clp + 1, invoice_number: "999999" });
  const result = await runPersonalCorpus(compromised);

  it("never pays a bent reading: every legitimate bill goes to tier 3 with both values", () => {
    for (const c of result.legit) expect(c.outcome).toMatchObject({ status: "escalated", tier: 3 });
  });

  it("never makes an adversarial bill ready where the honest pipeline would not", () => {
    for (const c of result.adversarial) expect(c.outcome.status === "ready" && c.expected.status !== "ready").toBe(false);
  });
});

describe("rendered corpus in redteam/corpus/personal", async () => {
  const manifest = JSON.parse(await readFile(new URL("manifest.json", CORPUS_DIR), "utf8")) as {
    documents: { id: string; path: string; fileHash: string }[];
  };

  it("matches the specs it was generated from (run `npm run corpus -w ingest` after changing them)", async () => {
    const byId = new Map<string, () => Promise<Uint8Array>>([
      ...PERSONAL_LEGIT.map((l) => [l.id, () => renderInvoice(l.spec)] as const),
      ...PERSONAL_CASES.map((c) => [c.id, () => renderCase(c)] as const),
    ]);
    expect(manifest.documents.length).toBe(byId.size);
    for (const doc of manifest.documents) {
      const bytes = new Uint8Array(await readFile(new URL(doc.path, CORPUS_DIR)));
      expect(keccak256(bytes), doc.path).toBe(doc.fileHash);
      expect(keccak256(await byId.get(doc.id)!()), doc.id).toBe(doc.fileHash);
    }
  });
});
