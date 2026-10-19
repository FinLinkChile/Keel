// Writes the JSON Schema files from the zod schemas. Run after changing an extraction:
//   npm run gen:json -w @keel/schemas
import { writeFileSync } from "node:fs";
import { z } from "zod";
import { CommercialInvoiceExtraction, TransportDocumentExtraction } from "../src/index";

const files = {
  "transport-document-extraction": TransportDocumentExtraction,
  "commercial-invoice-extraction": CommercialInvoiceExtraction,
} as const;

for (const [name, schema] of Object.entries(files)) {
  const path = new URL(`../json/${name}.schema.json`, import.meta.url);
  writeFileSync(path, `${JSON.stringify(z.toJSONSchema(schema), null, 2)}\n`);
  console.log(`wrote json/${name}.schema.json`);
}
