// Reads the filled carrier forms of redteam/corpus/carrier-forms with the parser and with the
// configured LLM, and compares both with the manifest. Live: one call per file.
// Usage: npm run carrier-forms:run -w ingest
import { readFile } from "node:fs/promises";
import { configFromEnv, createExtractor, ExtractionError, extractTransportDocument } from "../src/index";
import { parseTransportDocument, TradeParseError } from "../src/trade/parser";

const dir = new URL("../../redteam/corpus/carrier-forms/", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("manifest.json", dir), "utf8")) as {
  filled: Record<string, Record<string, string | number>>;
};
const FIELDS = ["document_number", "on_board_date", "port_of_loading", "port_of_discharge"] as const;

const extractor = await createExtractor(configFromEnv());
console.log(`provider: ${extractor.provider}  model: ${extractor.model}`);
let right = 0;
let total = 0;
for (const [path, truth] of Object.entries(manifest.filled)) {
  const pdf = new Uint8Array(await readFile(new URL(`filled/${path}`, dir)));
  const marks: string[] = [];
  for (const [source, read] of [
    ["parser", async () => (await parseTransportDocument(pdf)).extraction],
    ["model", () => extractTransportDocument(pdf, extractor)],
  ] as const) {
    try {
      const got = (await read()) as unknown as Record<string, string | number>;
      const ok = FIELDS.filter((f) => got[f] === truth[f]);
      right += ok.length;
      total += FIELDS.length;
      const wrong = FIELDS.filter((f) => got[f] !== truth[f]).map((f) => `${f}=${got[f]}`);
      marks.push(`${source} ${ok.length}/${FIELDS.length}${wrong.length ? ` (${wrong.join(", ")})` : ""}`);
    } catch (e) {
      total += FIELDS.length;
      const reason = e instanceof TradeParseError || e instanceof ExtractionError ? e.message : "error";
      marks.push(`${source} failed: ${reason}`);
    }
  }
  console.log(`${path.padEnd(24)} ${marks.join("   ")}`);
}
console.log(`\n${right}/${total} fields read right`);
