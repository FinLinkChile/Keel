// Bundles each handler in aws/src/handlers/ into infra/terraform/dist/<name>.mjs, the file
// Terraform zips (infra/terraform/lambda.tf). ESM for Node 24 on arm64; the AWS SDK v3 is
// bundled too, so the code does not depend on the version the runtime ships.
import { build } from "esbuild";
import { readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const handlers = join(root, "src", "handlers");
const out = join(root, "..", "infra", "terraform", "dist");

const entries = readdirSync(handlers).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
if (entries.length === 0) throw new Error("no handlers in aws/src/handlers");

await Promise.all(
  entries.map((file) =>
    build({
      entryPoints: [join(handlers, file)],
      outfile: join(out, `${basename(file, ".ts")}.mjs`),
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node24",
      minify: true,
      // No source maps: inline maps doubled the bundles (pdfjs in ingest). Stack traces name minified code.
      sourcemap: false,
      legalComments: "none",
      // Some CommonJS dependencies call require at run time
      banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
      // Never in a Lambda: compilers and test tooling of the engine
      external: ["solc", "@ethereumjs/*", "node:sqlite"],
    }),
  ),
);
console.log(`built ${entries.length} handlers into ${out}`);
