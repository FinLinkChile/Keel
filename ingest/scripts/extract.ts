// Reads one invoice with both readers and prints the two-source agreement result.
// Calls the real provider API (costs money). Usage:
//   npm run extract -w ingest -- [invoice.pdf]
// Without a file it renders the synthetic sample invoice.
import { readFile } from "node:fs/promises";
import { ALIAS_IDS } from "@keel/schemas";
import { configFromEnv, createExtractor, readInvoice } from "../src/index";
import { renderInvoice, sampleSpec } from "../src/testing/renderInvoice";

const file = process.argv[2];
const pdf = file ? new Uint8Array(await readFile(file)) : await renderInvoice(sampleSpec());

const extractor = await createExtractor(configFromEnv());
console.log(`provider: ${extractor.provider}  model: ${extractor.model}`);

const started = Date.now();
const reading = await readInvoice(pdf, [{ alias: ALIAS_IDS[0], rut: "761234560", emailDomain: "example.cl" }], extractor);
console.log(`latency: ${Date.now() - started} ms`);
console.dir(reading, { depth: null });
