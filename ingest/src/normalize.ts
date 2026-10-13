// Normalization of the fields that feed invoiceKey and the two-source comparison.
// Every function throws on input it cannot normalize: callers hold the invoice.

export class NormalizationError extends Error {
  constructor(field: string, value: string) {
    super(`cannot normalize ${field}: ${JSON.stringify(value)}`);
    this.name = "NormalizationError";
  }
}

// Characters from other scripts that render like Latin letters or digits.
const CONFUSABLES: Record<string, string> = {
  // Cyrillic
  "А": "A", "В": "B", "Е": "E", "К": "K", "М": "M", "Н": "H", "О": "O", "Р": "P",
  "С": "C", "Т": "T", "Х": "X", "У": "Y", "І": "I", "Ј": "J", "Ѕ": "S", "З": "3",
  "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "у": "y", "х": "x", "і": "i",
  "ј": "j", "ѕ": "s", "к": "k", "һ": "h", "ԁ": "d", "ӏ": "l",
  // Greek
  "Α": "A", "Β": "B", "Ε": "E", "Ζ": "Z", "Η": "H", "Ι": "I", "Κ": "K", "Μ": "M",
  "Ν": "N", "Ο": "O", "Ρ": "P", "Τ": "T", "Υ": "Y", "Χ": "X", "ο": "o", "ν": "v",
  "κ": "k", "ι": "i", "ρ": "p",
  // Look-alike punctuation inside numbers
  "‐": "-", "‑": "-", "‒": "-", "–": "-", "—": "-", "−": "-", "﹣": "-",
  "․": ".", "‧": ".", "·": ".",
};
const CONFUSABLE_RE = new RegExp(`[${Object.keys(CONFUSABLES).join("")}]`, "g");
// Zero-width and bidi control characters
const INVISIBLE_RE = /[​-‏‪-‮⁠-⁤﻿­]/g;

// NFKC changes that are normal in invoices: ordinals, typographic ligatures, trademark signs
const BENIGN_COMPAT = /[ºªﬀ-ﬆ™℠]/;

// A character is deceptive when it is a look-alike, invisible, or a compatibility form
// (full-width, mathematical, superscript, circled…) that NFKC turns into a letter or digit.
function isDeceptive(c: string): boolean {
  if (CONFUSABLES[c] !== undefined || new RegExp(INVISIBLE_RE.source).test(c)) return true;
  if (c.charCodeAt(0) < 0x80 || BENIGN_COMPAT.test(c)) return false;
  const folded = c.normalize("NFKC");
  return folded !== c && /[0-9A-Za-z]/.test(folded);
}

// NFKC, drops invisible characters and maps look-alikes to Latin. Applied before any
// regular expression. `suspicious` ignores benign differences such as "º" or "ﬁ".
export function foldHomoglyphs(text: string): { text: string; suspicious: boolean } {
  const suspicious = [...text].some(isDeceptive);
  const folded = text
    .normalize("NFKC")
    .replace(INVISIBLE_RE, "")
    .replace(CONFUSABLE_RE, (c) => CONFUSABLES[c]!)
    .replace(/[  -   　]/g, " ");
  return { text: folded, suspicious };
}

// Chilean RUT check digit, modulo 11.
export function rutCheckDigit(body: string): string {
  let sum = 0;
  let factor = 2;
  for (let i = body.length - 1; i >= 0; i--) {
    sum += Number(body[i]) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }
  const dv = 11 - (sum % 11);
  return dv === 11 ? "0" : dv === 10 ? "K" : String(dv);
}

// "76.123.456-k" -> "76123456K". Rejects a wrong check digit.
export function normalizeRut(raw: string): string {
  const compact = raw.replace(/[.\-\s]/g, "").toUpperCase();
  const match = /^([0-9]{7,8})([0-9K])$/.exec(compact);
  if (!match) throw new NormalizationError("rut", raw);
  const [, body, dv] = match as unknown as [string, string, string];
  if (rutCheckDigit(body) !== dv) throw new NormalizationError("rut", raw);
  return body + dv;
}

// "000123" -> "123".
export function normalizeInvoiceNumber(raw: string): string {
  const compact = raw.replace(/\s/g, "");
  if (!/^[0-9]{1,12}$/.test(compact)) throw new NormalizationError("invoice_number", raw);
  const stripped = compact.replace(/^0+/, "");
  if (stripped === "") throw new NormalizationError("invoice_number", raw);
  return stripped;
}

// Accepts YYYYMM, YYYY-MM, YYYY/MM, MM-YYYY and MM/YYYY. Returns YYYYMM.
export function normalizePeriod(raw: string): string {
  const s = raw.trim();
  const ym = /^(20[0-9]{2})[-/]?(0[1-9]|1[0-2])$/.exec(s);
  if (ym) return ym[1]! + ym[2]!;
  const my = /^(0?[1-9]|1[0-2])[-/](20[0-9]{2})$/.exec(s);
  if (my) return my[2]! + my[1]!.padStart(2, "0");
  throw new NormalizationError("period", raw);
}
