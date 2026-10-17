// Runs the Keel Trade and Keel Personal corpora against the configured LLM (LLM_* in .env).
// Calls the real provider API once per document read (about 100 calls; costs money). Usage:
//   npm run corpus:run -w ingest
// "stricter" means more conservative than the label (held instead of ready, or an extra warning).
// "UNSAFE" is an adversarial document accepted where it should not be.
import { configFromEnv, createExtractor } from "../src/index";
import { runPersonalCorpus } from "../src/testing/personalCorpus";
import { isStricter, runCorpus, type CaseResult } from "../src/testing/tradeCorpusRunner";

const extractor = await createExtractor(configFromEnv());
console.log(`provider: ${extractor.provider}  model: ${extractor.model}`);
const started = Date.now();
const result = await runCorpus(() => extractor);

const describe = (c: CaseResult) => {
  const o = c.outcome as { status: string; reason?: string; failure?: string };
  return [o.status, o.reason, o.failure].filter(Boolean).join(":");
};
let exact = 0;
let stricter = 0;
let unsafe = 0;
for (const c of [...result.legit, ...result.adversarial]) {
  const ok = c.mismatches.length === 0;
  const tooLenient = c.outcome.status === "ready" && c.expected.status !== "ready";
  const strict = isStricter(c.outcome, c.expected, c.mismatches);
  exact += ok ? 1 : 0;
  stricter += strict ? 1 : 0;
  unsafe += tooLenient ? 1 : 0;
  const label = ok ? "ok" : tooLenient ? "UNSAFE" : strict ? "stricter" : "differs";
  console.log(`${label.padEnd(8)} ${c.id.padEnd(16)} ${describe(c).padEnd(40)} ${ok ? "" : c.mismatches.join("; ")}`);
}
const total = result.legit.length + result.adversarial.length;
const legitOk = result.legit.filter((c) => c.mismatches.length === 0).length;
console.log(`\n${exact}/${total} as expected, ${stricter} stricter, ${legitOk}/${result.legit.length} legitimate documents read end to end, ${result.packages.filter((p) => p.ok).length}/${result.packages.length} complete packages, ${unsafe} unsafe, ${Math.round((Date.now() - started) / 1000)} s`);

// Keel Personal: a disagreement goes to tier 3 (cosignature) instead of being held
console.log("\nKeel Personal");
const personal = await runPersonalCorpus(() => extractor);
let pExact = 0;
let pUnsafe = 0;
const lenient = (status: string, expected: string) => status === "ready" && expected !== "ready";
for (const c of [...personal.legit, ...personal.adversarial]) {
  const ok = c.mismatches.length === 0;
  const bad = lenient(c.outcome.status, c.expected.status);
  pExact += ok ? 1 : 0;
  pUnsafe += bad ? 1 : 0;
  const o = c.outcome as { status: string; reason?: string; failure?: string };
  const got = [o.status, o.reason, o.failure].filter(Boolean).join(":");
  console.log(`${(ok ? "ok" : bad ? "UNSAFE" : "differs").padEnd(8)} ${c.id.padEnd(16)} ${got.padEnd(40)} ${ok ? "" : c.mismatches.join("; ")}`);
}
const pLegit = personal.legit.filter((c) => c.mismatches.length === 0).length;
console.log(`\n${pExact}/${personal.legit.length + personal.adversarial.length} as expected, ${pLegit}/${personal.legit.length} legitimate bills read end to end, ${pUnsafe} unsafe`);
process.exitCode = unsafe + pUnsafe > 0 ? 1 : 0;
