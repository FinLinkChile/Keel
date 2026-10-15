// Dependency rule: the core never touches Telegram, HTTP or the environment, and the
// application reaches templates only through the Renderer port.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = import.meta.dirname;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : p.endsWith(".ts") && !p.endsWith(".test.ts") ? [p] : [];
  });
}

const FORBIDDEN = [/from\s+["']grammy["']/, /from\s+["']node:http["']/, /process\.env/];

describe("dependency rule", () => {
  for (const layer of ["domain", "application", "presentation"]) {
    it(`${layer} does not import grammy, node:http or process.env`, () => {
      for (const f of files(join(SRC, layer))) {
        const code = readFileSync(f, "utf8");
        for (const re of FORBIDDEN) expect(code, f).not.toMatch(re);
      }
    });
  }

  it("domain imports nothing from the project", () => {
    for (const f of files(join(SRC, "domain"))) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(/from\s+["']\.\.\//);
    }
  });

  it("application does not import presentation", () => {
    for (const f of files(join(SRC, "application"))) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(/from\s+["'][./]*presentation/);
    }
  });
});
