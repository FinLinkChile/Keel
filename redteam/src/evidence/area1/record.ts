// Output: one JSON file per case and a summary table. The layout of evidence/ is Area 5's call:
// everything that shapes a file is in `toJson` and `fileName`, so adapting it is local.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Hex } from "@keel/schemas";
import type { DecodedError } from "./abi";

export const SCHEMA = "keel.area1.evidence/v1";

export interface TxRef {
  label: string;
  hash: Hex;
  blockNumber: bigint;
  from: Hex;
  to: Hex;
  status: "success" | "reverted";
  gasUsed: bigint;
  gasLimit: bigint;
}

export interface ExpectedError {
  name: string;
  // Omitted: only the name is checked
  args?: string[];
}

export interface RevertEvidence {
  tx: TxRef;
  expected: ExpectedError;
  // eth_call right before sending, with the same sender, calldata and gas
  simulated: DecodedError;
  // Of the mined transaction: debug_traceTransaction when the node has it, otherwise an
  // eth_call replay on the state of the parent block
  actual: DecodedError & { source: "trace" | "replay" };
  reproduce: string;
}

export interface CaseRecord {
  caseId: string;
  phase: 1 | 3;
  title: string;
  kind: "revert" | "state-change";
  // Transactions that must succeed for the case (Safe calls, orders opened, a first shipment)
  setup: TxRef[];
  revert?: RevertEvidence;
  passed: boolean;
  details: Record<string, unknown>;
  notes: string[];
}

export interface RunInfo {
  chainId: number;
  contracts: Record<string, Hex>;
}

const replacer = (_: string, v: unknown) => (typeof v === "bigint" ? v.toString() : v);

export function toJson(run: RunInfo, rec: CaseRecord): string {
  return JSON.stringify({ schema: SCHEMA, ...run, ...rec, writtenAt: new Date().toISOString() }, replacer, 2);
}

export function fileName(rec: CaseRecord): string {
  const tag = rec.revert ? rec.revert.expected.name : rec.title.replace(/[^A-Za-z0-9]+/g, "-").slice(0, 40);
  return `${rec.caseId}-${tag}.json`;
}

export class Sink {
  readonly records: CaseRecord[] = [];
  constructor(
    readonly dir: string,
    readonly run: RunInfo,
  ) {}

  write(rec: CaseRecord): string {
    const path = join(this.dir, fileName(rec));
    writeFileSync(path, `${toJson(this.run, rec)}\n`);
    this.records.push(rec);
    return path;
  }
}

const errText = (e?: { name: string; args?: string[] }) => (e ? `${e.name}${e.args?.length ? `(${e.args.join(", ")})` : ""}` : "");

export function summaryTable(records: CaseRecord[]): string {
  const rows = records.map((r) => [
    r.caseId,
    r.revert ? errText(r.revert.expected) : r.title,
    r.revert ? errText(r.revert.actual) : `${r.setup.length} tx ok`,
    r.revert ? r.revert.tx.status : "",
    r.passed ? "OK" : "FAIL",
    r.revert ? r.revert.tx.hash : (r.setup.at(-1)?.hash ?? ""),
    String(r.revert ? r.revert.tx.blockNumber : (r.setup.at(-1)?.blockNumber ?? "")),
  ]);
  const head = ["case", "expected", "actual", "status", "result", "tx", "block"];
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)));
  const line = (cells: string[]) => `| ${cells.map((c, i) => c.padEnd(widths[i] ?? 0)).join(" | ")} |`;
  return [line(head), `|${widths.map((w) => "-".repeat(w + 2)).join("|")}|`, ...rows.map(line)].join("\n");
}
