// Real carrier forms in redteam/corpus/carrier-forms: the specimens CSAV and Hapag-Lloyd publish,
// blank and filled with known corridor data by scripts/carrier-forms.ts. Parser only, no network;
// scripts/carrier-forms-run.ts measures the model on the same files.
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parseTransportDocument, TradeParseError } from "./trade/parser";

const DIR = new URL("../../redteam/corpus/carrier-forms/", import.meta.url);

interface Manifest {
  filled: Record<string, Record<string, unknown> & { hiddenReasons: string[] }>;
  blank: Record<string, { reason: string; field?: string }>;
}

describe("real carrier forms in redteam/corpus/carrier-forms", async () => {
  const manifest = JSON.parse(await readFile(new URL("manifest.json", DIR), "utf8")) as Manifest;
  const pdf = async (path: string) => new Uint8Array(await readFile(new URL(path, DIR)));

  it.each(Object.entries(manifest.filled))("reads %s", async (path, { hiddenReasons, ...truth }) => {
    const parsed = await parseTransportDocument(await pdf(`filled/${path}`));
    expect(parsed.extraction).toEqual({ ...truth, hidden_text_detected: true });
    expect(parsed.hiddenReasons).toEqual(hiddenReasons);
  });

  it.each(Object.entries(manifest.blank))("holds the blank %s", async (path, expected) => {
    const failure = await parseTransportDocument(await pdf(`blank/${path}`)).then(
      () => "read",
      (e: unknown) => (e instanceof TradeParseError ? { reason: e.reason, ...(e.field ? { field: e.field } : {}) } : e),
    );
    expect(failure).toEqual(expected);
  });
});
