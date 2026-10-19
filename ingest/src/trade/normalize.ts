// Normalization of the Keel Trade fields. Both readers (parser and extractor) go through the
// same functions, so the two-source comparison (T3.5) and blNumberHash (T3.7) see one form.
// Every function throws NormalizationError on input it cannot normalize: callers hold the document.
import { NormalizationError } from "../normalize";

const SEPARATORS = /[\s\-/.]/g;

// "MEDU 123-456.78" -> "MEDU12345678". This is the `document_number` blNumberHash hashes,
// so the carrier's attestation must be built from the same form (schemas/src/hash.ts).
export function normalizeDocumentNumber(raw: string): string {
  const compact = raw.replace(SEPARATORS, "").toUpperCase();
  // Carriers' numbers always carry digits; letters only is a label read as a value ("REFERENCE NO.")
  if (!/^[A-Z0-9]{6,20}$/.test(compact) || !/\d/.test(compact)) throw new NormalizationError("document_number", raw);
  return compact;
}

// Invoice and order numbers: "NB-2026/0915" -> "NB20260915".
export function normalizeReference(raw: string): string {
  const compact = raw.replace(SEPARATORS, "").toUpperCase();
  if (!/^[A-Z0-9]{1,20}$/.test(compact)) throw new NormalizationError("reference", raw);
  return compact;
}

// "8471.30.00" -> "84713000".
export function normalizeHsCode(raw: string): string {
  const compact = raw.replace(SEPARATORS, "");
  if (!/^[0-9]{6,10}$/.test(compact)) throw new NormalizationError("hs_code", raw);
  return compact;
}

// Every currency in the schema (USD, EUR, CNY, HKD) has two decimals.
const MINOR_DIGITS = 2;

// "25,000.00", "25000.5" or "25000" -> 2500000 (minor units). Only the dot is a decimal mark:
// "25.000,00" is rejected rather than read as 25 with three decimals. String arithmetic, no floats.
export function amountToMinor(raw: string): number {
  const s = raw.trim();
  const m = /^(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) throw new NormalizationError("amount", raw);
  const units = m[1]!.replace(/,/g, "");
  const minor = Number(units + (m[2] ?? "").padEnd(MINOR_DIGITS, "0"));
  if (!Number.isSafeInteger(minor) || minor <= 0) throw new NormalizationError("amount", raw);
  return minor;
}

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const MON = String.raw`(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\.?`;

// Unambiguous forms only. 03/04/2026 is the 3rd of April in Chile and March 4th in a US
// template, so purely numeric day-month dates are not read: the document is held instead.
const DATE_FORMS: { re: RegExp; parts: (m: RegExpExecArray) => [string, string, string] }[] = [
  // 2026-10-12
  { re: /\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/, parts: (m) => [m[1]!, m[2]!, m[3]!] },
  // 12-OCT-2026, 12 OCT 2026, 12 OCTOBER 2026
  {
    re: new RegExp(String.raw`\b(\d{1,2})[\s\-]+${MON}[\s\-,]+(20\d{2})\b`),
    parts: (m) => [m[3]!, String(MONTHS.indexOf(m[2]!) + 1), m[1]!],
  },
  // OCT 12, 2026 and OCT.12,2026
  {
    re: new RegExp(String.raw`\b${MON}\s*(\d{1,2})(?:ST|ND|RD|TH)?,?\s*(20\d{2})\b`),
    parts: (m) => [m[3]!, String(MONTHS.indexOf(m[1]!) + 1), m[2]!],
  },
];

// The first unambiguous date in `text` (uppercase), as a unix timestamp at midnight UTC,
// the same convention the extractor is given. undefined if there is none.
export function findDate(text: string): number | undefined {
  let best: { index: number; value: number } | undefined;
  for (const form of DATE_FORMS) {
    const m = form.re.exec(text);
    if (!m || (best && best.index <= m.index)) continue;
    const [y, mo, d] = form.parts(m).map(Number) as [number, number, number];
    const ms = Date.UTC(y, mo - 1, d);
    const check = new Date(ms);
    if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) {
      throw new NormalizationError("date", m[0]);
    }
    best = { index: m.index, value: ms / 1000 };
  }
  return best?.value;
}

// Port and airport names of the corridor, to their UN/LOCODE. Longer names first, so
// "SHANGHAI PUDONG" is not read as the seaport of Shanghai. A document that names a place
// outside this table, without printing its UN/LOCODE, is held: the limit is declared.
const PLACES: [string, string][] = [
  ["SHANGHAI PUDONG", "CNPVG"],
  ["SHENZHEN BAOAN", "CNSZX"],
  ["HONG KONG", "HKHKG"],
  ["SAN ANTONIO", "CLSAI"],
  ["VALPARAISO", "CLVAP"],
  ["SAN VICENTE", "CLSVE"],
  ["SANTIAGO", "CLSCL"],
  ["SHANGHAI", "CNSHA"],
  ["NINGBO", "CNNGB"],
  ["SHENZHEN", "CNSZX"],
  ["YANTIAN", "CNYTN"],
  ["QINGDAO", "CNTAO"],
  ["XIAMEN", "CNXMN"],
  ["GUANGZHOU", "CNCAN"],
  ["TIANJIN", "CNTSN"],
];
// Airports printed by their IATA code, e.g. "(PVG)"
const IATA: Record<string, string> = { PVG: "CNPVG", SZX: "CNSZX", CAN: "CNCAN", HKG: "HKHKG", SCL: "CLSCL" };
const LOCODES = new Set(PLACES.map(([, code]) => code));

// "SHANGHAI, CHINA (CNSHA)" -> "CNSHA". The text is uppercase without accents.
export function resolvePlace(text: string): string | undefined {
  const printed = [...text.matchAll(/\b([A-Z]{2}[A-Z0-9]{3})\b/g)].map((m) => m[1]!).filter((c) => LOCODES.has(c));
  if (printed.length > 0) return printed[0];
  const iata = /\(([A-Z]{3})\)/.exec(text)?.[1];
  if (iata && IATA[iata]) return IATA[iata];
  return PLACES.find(([name]) => new RegExp(String.raw`\b${name}\b`).test(text))?.[1];
}
