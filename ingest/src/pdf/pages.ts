// Pages of terms and conditions. Carriers print the contract of carriage on the back of every
// bill of lading: tens of thousands of characters of fixed legal prose that carry no field of the
// shipment, repeat the field labels ("port of loading") in sentences and are larger than the
// extractor accepts. Both readers skip them; the hidden text and account change checks still
// read every page.
import { toLines, type TextRun } from "./text";

// A terms page is long and almost all prose: a form page of a real B/L has about 3,000
// characters, and its prose share stays under 0.75 even with the "received by the carrier"
// paragraph. Every page of the corpus is under 0.1.
export const TERMS_PAGE_MIN_CHARS = 4000;
export const TERMS_PROSE_SHARE = 0.8;
const PROSE_LINE_CHARS = 100;

export function isTermsPage(lines: string[]): boolean {
  const total = lines.reduce((sum, l) => sum + l.length, 0);
  if (total < TERMS_PAGE_MIN_CHARS) return false;
  const prose = lines.filter((l) => l.length >= PROSE_LINE_CHARS).reduce((sum, l) => sum + l.length, 0);
  return prose / total >= TERMS_PROSE_SHARE;
}

// The runs of every page that is not a terms page. A document made only of prose keeps all
// its pages, so it fails on its own fields instead of looking empty.
export function withoutTermsPages(runs: TextRun[]): TextRun[] {
  const pages = [...new Set(runs.map((r) => r.page))];
  const terms = new Set(pages.filter((p) => isTermsPage(toLines(runs.filter((r) => r.page === p)))));
  if (terms.size === pages.length) return runs;
  return runs.filter((r) => !terms.has(r.page));
}
