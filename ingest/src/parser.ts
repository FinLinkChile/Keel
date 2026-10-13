// Deterministic invoice parser. T3.3, issue #20.
// Reads only visible text for the payment fields. Any missing or ambiguous field
// throws ParseError: the invoice is held, never guessed.
import { InvoiceExtraction, type AliasId } from "@keel/schemas";
import { splitByVisibility, type HiddenReason } from "./pdf/hidden";
import { PdfReadError, readTextRuns, toLines, type TextRun } from "./pdf/text";
import { foldHomoglyphs, normalizePeriod, normalizeRut, NormalizationError } from "./normalize";

export interface AliasEntry {
  alias: AliasId;
  // Normalized RUT of the issuer registered at onboarding
  rut: string;
  // Email domain the invoices for this alias must come from (T3.1)
  emailDomain: string;
  // Destinations verified at onboarding (the payout wallet, the bank account the issuer
  // prints on its invoices). Any other destination in a document opens a change request.
  knownDestinations?: PaymentDestination[];
}
export type AliasTable = readonly AliasEntry[];

export const PARSE_FAILURES = [
  "unreadable_pdf",
  "no_text",
  "missing_field",
  "ambiguous_field",
  "invalid_field",
  "unknown_issuer",
  "schema_mismatch",
] as const;
export type ParseFailure = (typeof PARSE_FAILURES)[number];
export type ParsedField = "issuer_tax_id" | "invoice_number" | "period" | "amount_clp" | "due_date";

export class ParseError extends Error {
  constructor(
    readonly reason: ParseFailure,
    readonly field?: ParsedField,
  ) {
    super(field ? `${reason}: ${field}` : reason);
    this.name = "ParseError";
  }
}

// Destinations found anywhere in the document, hidden text included.
// They feed only the beneficiary change flow (T3.6), never a payment.
export type PaymentDestination =
  | { kind: "evm_address"; value: `0x${string}` }
  | { kind: "bank_account"; value: string };

export interface ParsedInvoice {
  extraction: InvoiceExtraction;
  destinations: PaymentDestination[];
  hiddenReasons: HiddenReason[];
  homoglyphs: boolean;
}

const stripAccents = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "");
const canon = (line: string) => stripAccents(line).toUpperCase();

const RUT_RE = /\b(\d{1,2}\.?\d{3}\.?\d{3}\s*-\s*[0-9K])\b/;
const AMOUNT = String.raw`\$?\s*(\d{1,3}(?:\.\d{3})+|\d+)(?:,0{1,2})?`;
const TOTAL_RE = new RegExp(String.raw`^(?:MONTO\s+)?TOTAL(?!\s+NETO)\b[^0-9$]*${AMOUNT}\s*$`);
const FOLIO_RE = /\b(?:FOLIO|N\s?[°O.]|NRO\.?|NUMERO)\s*:?\s*(\d{1,12})\b/;
const DATE = String.raw`(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})`;
const DUE_RE = new RegExp(String.raw`(?:VENCIMIENTO|PAGAR\s+HASTA)[^0-9]*${DATE}`);
const ISSUE_RE = new RegExp(String.raw`FECHA\s+(?:DE\s+)?EMISION[^0-9]*${DATE}`);
const MONTHS = [
  "ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO",
  "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE",
];
const PERIOD_RE = new RegExp(
  String.raw`PERIODO(?:\s+DE\s+FACTURACION)?\s*:?\s*(\d{1,2}[-/]\d{4}|\d{4}[-/]?\d{2}|(?:${MONTHS.join("|")})\s+(?:DE\s+)?\d{4})`,
);

const ACCOUNT_CHANGE_RES = [
  /\b(NUEV[OA]S?|CAMBI\w*|ACTUALIZ\w*|MODIFIC\w*)\s+(?:DE\s+|EN\s+)?(?:NUESTR[OA]S?\s+|LOS\s+|LA\s+|SU\s+)?(DATOS\s+(BANCARIOS|DE\s+(PAGO|TRANSFERENCIA))|CUENTA|BILLETERA|WALLET|DIRECCION\s+DE\s+PAGO)/,
  /\b(DATOS\s+BANCARIOS|CUENTA|BILLETERA|WALLET)\s+(HA\s+|HAN\s+)?(CAMBIAD|ACTUALIZAD|NUEV)/,
  /\bNEW\s+(BANK\s+)?(ACCOUNT|WALLET|PAYMENT\s+DETAILS)\b/,
  /\bCHANGED?\s+(OUR\s+)?(BANK|ACCOUNT|WALLET)/,
];
const EVM_RE = /\b0[xX][0-9a-fA-F]{40}\b/g;
const BANK_RE =
  /(?:CUENTA\s+(?:CORRIENTE|VISTA|RUT|DE\s+AHORRO)|CTA\.?\s*(?:CTE|VISTA)\.?|N\s?[°O.]?\s*(?:DE\s+)?CUENTA)\s*:?\s*(?:N\s?[°O.]?\s*)?([0-9][0-9\- ]{4,22}[0-9])/g;

function unique<T>(values: T[], field: ParsedField): T | undefined {
  const distinct = [...new Set(values)];
  if (distinct.length > 1) throw new ParseError("ambiguous_field", field);
  return distinct[0];
}

function required<T>(value: T | undefined, field: ParsedField): T {
  if (value === undefined) throw new ParseError("missing_field", field);
  return value;
}

function toUnix(d: string, m: string, y: string, field: ParsedField): number {
  const [day, month, year] = [Number(d), Number(m), Number(y)];
  const ms = Date.UTC(year, month - 1, day);
  const check = new Date(ms);
  if (check.getUTCDate() !== day || check.getUTCMonth() !== month - 1) throw new ParseError("invalid_field", field);
  // Midnight UTC of the due date, the same convention the LLM extractor is given
  return ms / 1000;
}

function parsePeriod(raw: string): string {
  const named = new RegExp(String.raw`^(${MONTHS.join("|")})\s+(?:DE\s+)?(\d{4})$`).exec(raw);
  const value = named ? `${MONTHS.indexOf(named[1]!) + 1}/${named[2]}` : raw;
  try {
    return normalizePeriod(value);
  } catch {
    throw new ParseError("invalid_field", "period");
  }
}

export function findPaymentDestinations(lines: string[]): PaymentDestination[] {
  const found = new Map<string, PaymentDestination>();
  for (const line of lines) {
    for (const m of line.matchAll(EVM_RE)) {
      const value = m[0].toLowerCase() as `0x${string}`;
      found.set(value, { kind: "evm_address", value });
    }
    for (const m of canon(line).matchAll(BANK_RE)) {
      const value = m[1]!.replace(/[\s-]/g, "");
      found.set(`bank:${value}`, { kind: "bank_account", value });
    }
  }
  return [...found.values()];
}

export function mentionsAccountChange(lines: string[]): boolean {
  return lines.some((line) => ACCOUNT_CHANGE_RES.some((re) => re.test(canon(line))));
}

export interface TextInput {
  visibleLines: string[];
  hiddenLines: string[];
  hiddenReasons: HiddenReason[];
}

export function parseInvoiceText(input: TextInput, aliases: AliasTable): ParsedInvoice {
  let homoglyphs = false;
  const fold = (lines: string[]) =>
    lines.map((l) => {
      const r = foldHomoglyphs(l);
      homoglyphs ||= r.suspicious;
      return r.text;
    });
  const visible = fold(input.visibleLines);
  const hidden = fold(input.hiddenLines);
  if (visible.join("").trim() === "") throw new ParseError("no_text");
  const lines = visible.map(canon);

  // Issuer: the first RUT in reading order, which in a Chilean DTE is the issuer box
  const firstRut = lines.map((l) => RUT_RE.exec(l)?.[1]).find((r) => r !== undefined);
  let issuerRut: string;
  try {
    issuerRut = normalizeRut(required(firstRut, "issuer_tax_id"));
  } catch (e) {
    if (e instanceof NormalizationError) throw new ParseError("invalid_field", "issuer_tax_id");
    throw e;
  }

  // Folio: inside the document type box (the FACTURA line and the two after it) or after FOLIO
  const boxStart = lines.findIndex((l) => l.includes("FACTURA"));
  const folioLines = lines.filter((l, i) => l.includes("FOLIO") || (boxStart >= 0 && i >= boxStart && i <= boxStart + 2));
  const folio = required(
    unique(
      folioLines.flatMap((l) => {
        const m = FOLIO_RE.exec(l);
        return m ? [m[1]!.replace(/^0+/, "")] : [];
      }),
      "invoice_number",
    ),
    "invoice_number",
  );

  const amount = required(
    unique(
      lines.flatMap((l) => {
        const m = TOTAL_RE.exec(l);
        return m ? [Number(m[1]!.replace(/\./g, ""))] : [];
      }),
      "amount_clp",
    ),
    "amount_clp",
  );

  const dueMatch = required(unique(lines.flatMap((l) => DUE_RE.exec(l)?.slice(1, 4).join("-") ?? []), "due_date"), "due_date");
  const [dd, mm, yyyy] = dueMatch.split("-") as [string, string, string];
  const dueDate = toUnix(dd, mm, yyyy, "due_date");

  // Period: explicit label, otherwise the month of the issue date
  let period = unique(lines.flatMap((l) => {
    const m = PERIOD_RE.exec(l);
    return m ? [parsePeriod(m[1]!)] : [];
  }), "period");
  if (period === undefined) {
    const issue = unique(lines.flatMap((l) => ISSUE_RE.exec(l)?.slice(1, 4).join("-") ?? []), "period");
    if (issue === undefined) throw new ParseError("missing_field", "period");
    const [, im, iy] = issue.split("-") as [string, string, string];
    period = parsePeriod(`${im}/${iy}`);
  }

  const entry = aliases.find((a) => a.rut === issuerRut);
  if (!entry) throw new ParseError("unknown_issuer", "issuer_tax_id");

  const all = [...visible, ...hidden];
  const result = InvoiceExtraction.safeParse({
    alias_id: entry.alias,
    issuer_tax_id: issuerRut,
    invoice_number: folio,
    period,
    amount_clp: amount,
    due_date: dueDate,
    mentions_account_change: mentionsAccountChange(all),
    // Deceptive text of any kind (hidden runs or look-alike characters) raises the same flag
    hidden_text_detected: input.hiddenReasons.length > 0 || homoglyphs,
  });
  if (!result.success) throw new ParseError("schema_mismatch");

  return {
    extraction: result.data,
    destinations: findPaymentDestinations(all),
    hiddenReasons: [...new Set(input.hiddenReasons)],
    homoglyphs,
  };
}

export async function parseInvoice(pdf: Uint8Array, aliases: AliasTable): Promise<ParsedInvoice> {
  let runs: TextRun[];
  try {
    runs = await readTextRuns(pdf);
  } catch (e) {
    if (e instanceof PdfReadError) throw new ParseError("unreadable_pdf");
    throw e;
  }
  const { visible, hidden } = splitByVisibility(runs);
  return parseInvoiceText(
    {
      visibleLines: toLines(visible),
      hiddenLines: toLines(hidden.map((h) => h.run)),
      hiddenReasons: hidden.map((h) => h.reason),
    },
    aliases,
  );
}
