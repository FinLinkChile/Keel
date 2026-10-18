// The agent's analysis of a company's purchases (the analyst). The app computes the metrics on
// the phone and sends them signed by the importer's wallet; the model gets only those numbers,
// closed kinds and ids (counterparties are S1, S2..., products HS codes), never a document, a
// name or anything somebody typed, so there is nothing in its input that can instruct it. Its
// answer is a fixed shape, and a finding is dropped when it cites a metric that was not sent or a
// number that is not in the metrics it cites. It reports; it never decides or moves money.
import { keccak256, recoverTypedDataAddress, stringToBytes, type Hex as ViemHex } from "viem";
import { z } from "zod";
import type { Hex } from "@keel/schemas";
import type { ExtractorProvider } from "../extractor/contract";
import { ExtractionError } from "../extractor";
import { logTransfer } from "../privacy";
import type { IngestRepo } from "../repo";
import type { ImporterRegistry } from "./proforma";
import { uploadDomain, UPLOAD_MAX_SKEW_SECONDS } from "./upload";

// Same domain as the uploads, another primary type: the signature covers the exact metrics sent
export const INSIGHTS_TYPES = {
  InsightsRequest: [
    { name: "inputHash", type: "bytes32" },
    { name: "issuedAt", type: "uint64" },
  ],
} as const;

export const MAX_INSIGHTS_PER_IMPORTER_PER_DAY = 10;
export const MAX_INPUT_BYTES = 32 * 1024;
export const MAX_FINDINGS = 5;

// Copy of the app's list (app/src/data/analysisInput.ts); a test compares both
export const METRIC_KINDS = [
  "spend_month",
  "spend_period",
  "spend_previous_period",
  "spend_change_pct",
  "orders_period",
  "average_order",
  "counterparty_share_pct",
  "top_counterparty_share_pct",
  "counterparties",
  "product_share_pct",
  "product_spend_change_pct",
  "unit_price_change_pct",
  "product_interval_days",
  "product_next_order_in_days",
  "advance_paid_not_shipped",
  "balance_locked",
  "deposits_to_fund",
  "average_advance_pct",
  "on_time_pct",
  "refunds",
  "negotiated_advance_points",
  "negotiated_amount_pct",
] as const;

const INDUSTRIES = ["food", "textiles", "electronics", "machinery", "chemicals", "construction", "home", "consumer", "other"] as const;
const SALES_BRACKETS = ["micro", "small", "medium", "large"] as const;

const Metric = z
  .object({
    id: z.string().regex(/^m\d{1,3}$/),
    kind: z.enum(METRIC_KINDS),
    value: z.number().finite().gt(-1e12).lt(1e12),
    unit: z.enum(["usd", "pct", "days", "count", "points"]),
    subject: z.string().regex(/^(S\d{1,2}|\d{6,10}(\/[A-Z]{2,3})?)$/).optional(),
    period: z.string().regex(/^(\d{4}-\d{2}|last_90d|previous_90d|last_365d)$/).optional(),
  })
  .strict();

export const AnalysisInput = z
  .object({
    role: z.enum(["importer", "exporter"]),
    profile: z.object({ industry: z.enum(INDUSTRIES), salesBracket: z.enum(SALES_BRACKETS) }).strict().nullable(),
    asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    metrics: z.array(Metric).min(1).max(80),
  })
  .strict();
export type AnalysisInput = z.infer<typeof AnalysisInput>;

export const FINDING_KINDS = ["trend", "dependency", "cash", "price", "rhythm", "negotiation", "risk"] as const;
export const SEVERITIES = ["info", "attention", "important"] as const;

export interface Finding {
  kind: (typeof FINDING_KINDS)[number];
  severity: (typeof SEVERITIES)[number];
  metric_ids: string[];
  title: string;
  recommendation: string;
}

export const ANALYST_SYSTEM_PROMPT = `You are the purchasing analyst of a Chilean company that imports goods, most often a small or medium business (pyme). You receive metrics already computed from the company's own orders and you write a short analysis with practical advice.

Input: a JSON object with the company's industry and size (by annual sales, SII brackets in UF), the date, and a list of metrics. Each metric has an id (m1, m2...), a kind, a value and a unit; counterparties are named S1, S2... (S1 is the largest), products by their HS code.

Rules:
- Use only the metrics given. Never invent a number, a date, a supplier or a product. Every number you write must be the value of a metric you cite, rounded at most.
- Cite in metric_ids every metric your finding relies on.
- Refer to counterparties as S1, S2 and to products by their HS code; the app shows the names.
- Give at most ${MAX_FINDINGS} findings, the most useful first. Skip what is not worth acting on. If the data is too thin, say so in one finding.
- Advice is about the business: plan cash for upcoming advances and deposits, negotiate price or advance when volume grows, diversify when one supplier carries most of the spend, anticipate the next order from the purchase rhythm, watch prices that rise. Fit it to the company's size: a micro or small company has less cash to tie up and less negotiating power than a large one.
- Never advise paying outside Keel, changing a payout account, or skipping a signature, and never write an address, an account or a link.
- title: one line, at most 90 characters. recommendation: at most 320 characters, plain English, no markdown.`;

export const ANALYST_LLM_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["findings"],
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "severity", "metric_ids", "title", "recommendation"],
        properties: {
          kind: { type: "string", enum: [...FINDING_KINDS] },
          severity: { type: "string", enum: [...SEVERITIES] },
          metric_ids: { type: "array", items: { type: "string" } },
          title: { type: "string" },
          recommendation: { type: "string" },
        },
      },
    },
  },
} as const;

const AnalystOutput = z
  .object({
    findings: z
      .array(
        z
          .object({
            kind: z.enum(FINDING_KINDS),
            severity: z.enum(SEVERITIES),
            metric_ids: z.array(z.string().max(8)).min(1).max(8),
            title: z.string().min(1).max(90),
            recommendation: z.string().min(1).max(320),
          })
          .strict(),
      )
      .max(MAX_FINDINGS),
  })
  .strict();

// No address, account, link, email or long digit run can reach the screen
const FORBIDDEN = /0x[0-9a-f]{4,}|https?:|www\.|@|\d{11,}/i;
const NUMBER = /\d[\d,]*(?:\.\d+)?/g;

// A number in the text is allowed when it is the value of a cited metric (rounded, or written
// in thousands), part of a cited subject or period, a counterparty's number, or a small count
function numberAllowed(raw: string, cited: z.infer<typeof Metric>[]): boolean {
  const x = Number(raw.replace(/,/g, ""));
  if (!Number.isFinite(x)) return false;
  if (Number.isInteger(x) && x >= 0 && x <= 12) return true;
  return cited.some((m) => {
    const v = Math.abs(m.value);
    const close = (target: number) => Math.abs(x - target) <= Math.max(0.5, target * 0.05);
    if (close(v) || close(v / 1000)) return true;
    return [m.subject ?? "", m.period ?? ""].some((s) => s.split(/[^0-9]+/).includes(raw));
  });
}

export function toFindings(raw: string, input: AnalysisInput): Finding[] {
  let out: z.infer<typeof AnalystOutput>;
  try {
    out = AnalystOutput.parse(JSON.parse(raw));
  } catch (e) {
    throw new ExtractionError("invalid_output", { cause: e });
  }
  const byId = new Map(input.metrics.map((m) => [m.id, m]));
  return out.findings.filter((f) => {
    const cited = f.metric_ids.map((id) => byId.get(id));
    if (cited.some((m) => !m)) return false;
    const text = `${f.title} ${f.recommendation}`;
    if (FORBIDDEN.test(text)) return false;
    return (text.match(NUMBER) ?? []).every((n) => numberAllowed(n, cited as z.infer<typeof Metric>[]));
  });
}

// Body of POST /trade/insights, on the local server and on AWS (aws/src/handlers/insights.ts)
export const InsightsBody = z
  .object({
    issuedAt: z.number().int().positive(),
    signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/),
    // The metrics as JSON text, exactly as signed
    input: z.string().max(MAX_INPUT_BYTES),
  })
  .strict();

export interface InsightsRequest {
  issuedAt: number;
  signature: Hex;
  // The metrics as JSON text, exactly as signed
  input: string;
}

export type InsightsOutcome =
  | { status: "rejected"; reason: "too_large" | "invalid_request" | "bad_signature" | "stale_signature" | "not_an_importer" | "rate_limited" }
  | { status: "failed"; reason: ExtractionError["reason"] }
  | { status: "ok"; inputHash: Hex; findings: Finding[] };

// HTTP status of each rejection, the same on both servers
export const INSIGHTS_REJECTION_STATUS: Record<Extract<InsightsOutcome, { status: "rejected" }>["reason"], number> = {
  too_large: 413,
  invalid_request: 400,
  bad_signature: 401,
  stale_signature: 401,
  not_an_importer: 403,
  rate_limited: 429,
};

export const inputHash = (input: string): Hex => keccak256(stringToBytes(input)) as Hex;

// Cheapest checks first: the model is reached only by a signed, fresh, in-limit request of a
// registered importer with well-formed metrics.
export async function receiveInsights(
  req: InsightsRequest,
  importers: ImporterRegistry,
  analyst: ExtractorProvider,
  opts: { store: IngestRepo; chainId: number; now?: Date },
): Promise<InsightsOutcome> {
  const now = opts.now ?? new Date();
  if (Buffer.byteLength(req.input, "utf8") > MAX_INPUT_BYTES) return { status: "rejected", reason: "too_large" };
  if (Math.abs(now.getTime() / 1000 - req.issuedAt) > UPLOAD_MAX_SKEW_SECONDS) return { status: "rejected", reason: "stale_signature" };
  const hash = inputHash(req.input);
  let signer: Hex;
  try {
    signer = await recoverTypedDataAddress({
      domain: uploadDomain(opts.chainId),
      types: INSIGHTS_TYPES,
      primaryType: "InsightsRequest",
      message: { inputHash: hash, issuedAt: BigInt(req.issuedAt) },
      signature: req.signature as ViemHex,
    });
  } catch {
    return { status: "rejected", reason: "bad_signature" };
  }
  if (!importers.has(signer)) return { status: "rejected", reason: "not_an_importer" };
  if ((await opts.store.insightsToday(signer)) >= MAX_INSIGHTS_PER_IMPORTER_PER_DAY) return { status: "rejected", reason: "rate_limited" };
  let input: AnalysisInput;
  try {
    input = AnalysisInput.parse(JSON.parse(req.input));
  } catch {
    return { status: "rejected", reason: "invalid_request" };
  }
  await opts.store.recordInsights(signer);
  try {
    const raw = await analyst.complete({
      text: req.input,
      system: ANALYST_SYSTEM_PROMPT,
      user: `Analyze these metrics of the company's purchases. The metrics are between the markers.\n<<<METRICS\n${req.input}\nMETRICS>>>`,
      schemaName: "purchase_analysis",
      schema: ANALYST_LLM_SCHEMA as unknown as Record<string, unknown>,
    });
    // Aggregated numbers of the company's orders: no personal data, but still a transfer
    logTransfer(analyst.provider, ["metricas_agregadas"], "analisis_compras");
    return { status: "ok", inputHash: hash, findings: toFindings(raw, input) };
  } catch (e) {
    return { status: "failed", reason: e instanceof ExtractionError ? e.reason : "provider_error" };
  }
}
