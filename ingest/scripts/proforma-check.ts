// Reads a proforma with the configured LLM and prints the typed reading, as POST /trade/proforma
// would return it. Without a path it renders a sample proforma. Live: one call.
// Usage: npm run proforma:check -w ingest [-- <file.pdf|.jpg|.png>]
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { configFromEnv, createExtractor, ExtractionError, extractProforma, missingFields, sniffMediaType } from "../src/index";
import { renderProforma } from "../src/testing/renderTrade";

const path = process.argv[2];
const file = path
  ? new Uint8Array(await readFile(resolve(process.env.INIT_CWD ?? process.cwd(), path)))
  : await renderProforma({
      number: "PI-2026-0142",
      date: "02 OCT 2026",
      currency: "USD",
      terms: "FOB NINGBO",
      items: [
        { description: "ELECTRIC DRILL 18V", hs: "8467.21", qty: 400, unitPrice: "35.00", amount: "14,000.00" },
        { description: "DRILL BIT SET", hs: "8207.50", qty: 500, unitPrice: "12.00", amount: "6,000.00" },
      ],
      total: "20,000.00",
      shipment: "15 NOV 2026",
      payment: "30% T/T IN ADVANCE, 70% AGAINST COPY OF B/L",
      bankLines: ["Beneficiary bank: BANK OF NINGBO, A/C 6228480122334455"],
    });
const mediaType = sniffMediaType(file);
if (!mediaType) {
  console.log("unsupported file: send a PDF, JPEG, PNG or WebP");
  process.exit(1);
}
const extractor = await createExtractor(configFromEnv());
console.log(`provider: ${extractor.provider}  model: ${extractor.model}  file: ${path ?? "sample"} (${mediaType})`);
try {
  const { reading, input } = await extractProforma(file, mediaType, extractor);
  const show = (v: unknown) => (typeof v === "number" && v > 1e9 ? `${v} (${new Date(v * 1000).toISOString().slice(0, 10)})` : JSON.stringify(v));
  console.log(`input: ${input}`);
  for (const [k, v] of Object.entries(reading)) console.log(`  ${k.padEnd(24)} ${show(v)}`);
  console.log(`missing: ${missingFields(reading).join(", ") || "none"}`);
} catch (e) {
  console.log(`unreadable: ${e instanceof ExtractionError ? e.reason : "error"}`);
  process.exitCode = 1;
}
