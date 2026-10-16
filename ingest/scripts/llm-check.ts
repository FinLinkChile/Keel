// Checks the configured LLM with one tiny structured request and prints the provider's own
// error if it fails (status and message, never the key). Usage: npm run llm:check -w ingest
import { configFromEnv, createExtractor, ExtractionError } from "../src/index";

const config = configFromEnv();
const extractor = await createExtractor(config);
console.log(`provider: ${extractor.provider}  model: ${extractor.model}  baseURL: ${config.baseURL ?? "(vendor default)"}`);
try {
  const raw = await extractor.complete({
    text: "ping",
    system: "Reply only with the JSON the schema asks for.",
    user: "Return ok = true.",
    schemaName: "llm_check",
    schema: { type: "object", additionalProperties: false, required: ["ok"], properties: { ok: { type: "boolean" } } },
  });
  console.log(`ok: ${raw}`);
} catch (e) {
  const cause = (e instanceof ExtractionError ? e.cause : e) as { status?: number; message?: string } | undefined;
  console.log(`failed: ${e instanceof ExtractionError ? e.reason : "error"}  status: ${cause?.status ?? "-"}  ${cause?.message ?? ""}`);
  process.exitCode = 1;
}
