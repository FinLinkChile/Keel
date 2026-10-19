// Deterministic parser of the Keel Trade documents. T3.3, issue #20.
// Reads only visible text for the extracted fields. Any missing or ambiguous field throws
// TradeParseError: the document is held, never guessed.
// Bills of lading have no standard format across carriers. This parser reads documents that
// print each field next to its label ("B/L No.:", "Port of Loading:") or under it in the same
// box, as the carrier forms of CSAV and Hapag-Lloyd do, and skips the pages of terms and
// conditions. It covers those forms and the corpus (redteam/corpus/trade), not any carrier:
// that limit is declared.
import {
  CommercialInvoiceExtraction,
  CURRENCIES,
  type Currency,
  type RequiredDocType,
  TransportDocumentExtraction,
  type TransportDocType,
} from "@keel/schemas";
import { foldHomoglyphs, NormalizationError, normalizeRut } from "../normalize";
import { findPaymentDestinations, mentionsAccountChange, type PaymentDestination } from "../parser";
import { splitByVisibility, type HiddenReason } from "../pdf/hidden";
import { withoutTermsPages } from "../pdf/pages";
import { lineText, type LayoutLine, PdfReadError, readTextRuns, toLayoutLines, toLines, type TextRun } from "../pdf/text";
import {
  amountToMinor,
  findDate,
  normalizeDocumentNumber,
  normalizeHsCode,
  normalizeReference,
  resolvePlace,
} from "./normalize";

export const TRADE_PARSE_FAILURES = [
  "unreadable_pdf",
  "no_text",
  "unknown_document_type",
  "missing_field",
  "ambiguous_field",
  "invalid_field",
  "schema_mismatch",
] as const;
export type TradeParseFailure = (typeof TRADE_PARSE_FAILURES)[number];
export type TradeParsedField =
  | keyof TransportDocumentExtraction
  | Exclude<keyof CommercialInvoiceExtraction, "amount_minor">
  | "amount";

export class TradeParseError extends Error {
  constructor(
    readonly reason: TradeParseFailure,
    readonly field?: TradeParsedField,
  ) {
    super(field ? `${reason}: ${field}` : reason);
    this.name = "TradeParseError";
  }
}

export interface TradeText {
  // Visible lines of the form pages (terms pages skipped) after homoglyph folding, uppercase
  // and without accents
  visible: string[];
  // The same lines with the position of each run, to read a value under its label
  layout: LayoutLine[];
  // Visible and hidden lines after folding, original case: destinations are searched here
  all: string[];
  hiddenReasons: HiddenReason[];
  homoglyphs: boolean;
}

interface Parsed<T> {
  extraction: T;
  // Destinations found anywhere in the document, hidden text included. They feed only the
  // account alert (T3.6), never a payment and never a change of the order.
  destinations: PaymentDestination[];
  hiddenReasons: HiddenReason[];
}
export type ParsedTransportDocument = Parsed<TransportDocumentExtraction>;
export type ParsedCommercialInvoice = Parsed<CommercialInvoiceExtraction>;

const canon = (line: string) => line.normalize("NFD").replace(/\p{M}/gu, "").toUpperCase();

export async function readTradeText(pdf: Uint8Array): Promise<TradeText> {
  let runs: TextRun[];
  try {
    runs = await readTextRuns(pdf);
  } catch (e) {
    if (e instanceof PdfReadError) throw new TradeParseError("unreadable_pdf");
    throw e;
  }
  const { visible, hidden } = splitByVisibility(runs);
  let homoglyphs = false;
  const foldOne = (l: string) => {
    const r = foldHomoglyphs(l);
    homoglyphs ||= r.suspicious;
    return r.text;
  };
  const fold = (lines: string[]) => lines.map(foldOne);
  // Every page, terms included, for the destinations and the account change wording
  const visibleLines = fold(toLines(visible));
  const hiddenLines = fold(toLines(hidden.map((h) => h.run)));
  if (visibleLines.join("").trim() === "") throw new TradeParseError("no_text");
  const layout = toLayoutLines(withoutTermsPages(visible))
    .map((line) => ({ ...line, cells: line.cells.map((c) => ({ ...c, text: canon(foldOne(c.text)).trim() })) }))
    .map((line) => ({ ...line, cells: line.cells.filter((c) => c.text.length > 0) }))
    .filter((line) => line.cells.length > 0);
  return {
    visible: layout.map(lineText),
    layout,
    all: [...visibleLines, ...hiddenLines],
    hiddenReasons: [...new Set(hidden.map((h) => h.reason))],
    homoglyphs,
  };
}

// The document type is the first title in reading order. A commercial invoice usually quotes
// the B/L number in its body, so "anywhere in the text" would not work.
const TITLES: [RegExp, RequiredDocType][] = [
  [/\bCOMMERCIAL\s+INVOICE\b/, "COMMERCIAL_INVOICE"],
  [/\bBILL\s+OF\s+LADING\b/, "BILL_OF_LADING"],
  [/\bAIR\s*WAYBILL\b/, "AIR_WAYBILL"],
];

export function detectDocType(visible: string[]): RequiredDocType | undefined {
  for (const line of visible) {
    const hits = TITLES.filter(([re]) => re.test(line));
    if (hits.length > 1) throw new TradeParseError("ambiguous_field", "doc_type");
    if (hits.length === 1) return hits[0]![1];
  }
  return undefined;
}

// Labels that can follow a value on the same line when two boxes are side by side.
const LABEL_WORDS = String.raw`(?:PORT|PLACE|AIRPORT|VESSEL|VOYAGE|FLIGHT|B\/L|BILL|AWB|SHIPPED|LADEN|ON\s+BOARD|DATE|INVOICE|ORDER|P\.?O\.?|TERMS|INCOTERMS?|HS|CURRENCY|TOTAL|CONSIGNEE|SHIPPER|NOTIFY)\b`;
const NEXT_LABEL = new RegExp(String.raw`\s+${LABEL_WORDS}.*$`);
// A run that is itself a label: it ends in a colon ("PAGE:") or in "No." ("REFERENCE NO."), or
// opens with a label word
const LABEL_CELL = new RegExp(String.raw`(?::\s*$)|(?:\b(?:NO\.?|NUMBER|#)\s*$)|^${LABEL_WORDS}`);

// A gap wider than this, in glyph heights, separates two boxes of a form on the same line
const BOX_GAP = 3;
// How far under a label its value may sit, in glyph heights of the label line
const BELOW_REACH = 2.6;

// The value printed for `label`, once per place the label appears. A label counts where it
// opens a run (after an optional box number like "(9)") or is followed by a colon; anywhere
// else it is a word of a sentence ("from the port of loading, whichever..."). The value is the
// text after the label in its box, cut at the next label, or when the box holds nothing more,
// the first line under the label inside the same box. An empty string when neither has text.
function fieldValues(layout: LayoutLine[], label: RegExp): string[] {
  const opener = new RegExp(String.raw`^(?:\(?\d{1,2}[.)]?\s*)?(?:${label.source})(?!\s*,)`);
  const labelled = new RegExp(String.raw`(?:${label.source})(?=\s*[:#])`);
  const values: string[] = [];
  layout.forEach((line, i) => {
    line.cells.forEach((cell, j) => {
      const m = opener.exec(cell.text) ?? labelled.exec(cell.text);
      if (!m) return;
      // The box ends at the next label on the line or at a wide gap
      const right = line.cells.slice(j + 1);
      const nextLabel = right.find((c) => LABEL_CELL.test(c.text));
      const boxEnd = nextLabel?.x ?? Infinity;
      const inBox = (cells: typeof line.cells, from: number) => {
        const taken: typeof cells = [];
        let end = from;
        for (const c of cells) {
          if (c.x >= boxEnd || c.x - end > BOX_GAP * line.size) break;
          taken.push(c);
          end = c.x1;
        }
        return taken;
      };
      const rest = cell.text.slice(m.index + m[0].length).replace(/^\s*[:#]?\s*/, "");
      const inline = [rest, ...inBox(right, cell.x1).map((c) => c.text)]
        .join(" ")
        .replace(NEXT_LABEL, "")
        .trim();
      if (inline !== "") {
        values.push(inline);
        return;
      }
      const inColumn = (c: { x: number }) => c.x >= cell.x - line.size && c.x < boxEnd;
      const under = layout
        .slice(i + 1)
        .find((l) => l.page === line.page && line.y - l.y <= BELOW_REACH * line.size && l.cells.some(inColumn));
      const first = under?.cells.filter(inColumn) ?? [];
      if (first.length === 0 || LABEL_CELL.test(first[0]!.text)) {
        values.push("");
        return;
      }
      values.push(
        [first[0]!, ...inBox(first.slice(1), first[0]!.x1)]
          .map((c) => c.text)
          .join(" ")
          .replace(NEXT_LABEL, "")
          .trim(),
      );
    });
  });
  return values;
}

function single<T>(values: T[], field: TradeParsedField): T {
  const distinct = [...new Set(values)];
  if (distinct.length > 1) throw new TradeParseError("ambiguous_field", field);
  if (distinct.length === 0) throw new TradeParseError("missing_field", field);
  return distinct[0]!;
}

// Runs a normalizer, turning its failure into a typed parse failure for `field`.
function normalized<T>(field: TradeParsedField, fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof NormalizationError) throw new TradeParseError("invalid_field", field);
    throw e;
  }
}

const DOC_NUMBER = String.raw`([A-Z0-9][A-Z0-9 \-/.]{4,28}[A-Z0-9])`;
const TRANSPORT_LABELS: Record<
  TransportDocType,
  { number: RegExp; numberValue: RegExp; date: RegExp; from: RegExp; to: RegExp }
> = {
  BILL_OF_LADING: {
    // "B/L No.", "B/L-No." (CSAV, Hapag-Lloyd), "Bill of Lading Number"
    number: /\b(?:B\/L|BILL\s+OF\s+LADING)[\s-]*(?:NO\.?|NUMBER|#)/,
    numberValue: new RegExp(String.raw`^${DOC_NUMBER}`),
    date: /\b(?:SHIPPED|LADEN)?\s*ON\s+BOARD(?:\s+DATE)?\b/,
    from: /\bPORT\s+OF\s+LOADING\b/,
    to: /\bPORT\s+OF\s+DISCHARGE\b/,
  },
  AIR_WAYBILL: {
    number: /\b(?:AWB|AIR\s*WAYBILL)[\s-]*(?:NO\.?|NUMBER|#)/,
    numberValue: /^(\d{3}[\s-]?\d{4}\s?\d{4})\b/,
    date: /\b(?:FLIGHT\s+DATE|DATE\s+OF\s+FLIGHT|EXECUTED\s+ON)\b/,
    from: /\bAIRPORT\s+OF\s+DEPARTURE\b/,
    to: /\bAIRPORT\s+OF\s+DESTINATION\b/,
  },
};

const hiddenFlag = (text: TradeText) => text.hiddenReasons.length > 0 || text.homoglyphs;

export function parseTransportText(text: TradeText): ParsedTransportDocument {
  const docType = detectDocType(text.visible);
  if (docType === undefined) throw new TradeParseError("unknown_document_type");
  if (docType === "COMMERCIAL_INVOICE") throw new TradeParseError("unknown_document_type", "doc_type");
  const labels = TRANSPORT_LABELS[docType];

  const number = single(
    fieldValues(text.layout, labels.number).flatMap((v) => {
      const m = labels.numberValue.exec(v);
      return m ? [normalized("document_number", () => normalizeDocumentNumber(m[1]!))] : [];
    }),
    "document_number",
  );
  const date = single(
    fieldValues(text.layout, labels.date).flatMap((v) => {
      const d = normalized("on_board_date", () => findDate(v));
      return d === undefined ? [] : [d];
    }),
    "on_board_date",
  );
  const place = (label: RegExp, field: "port_of_loading" | "port_of_discharge") => {
    const values = fieldValues(text.layout, label);
    if (values.length === 0) throw new TradeParseError("missing_field", field);
    return single(
      values.map((v) => resolvePlace(v) ?? "?"),
      field,
    );
  };
  const from = place(labels.from, "port_of_loading");
  const to = place(labels.to, "port_of_discharge");
  if (from === "?") throw new TradeParseError("invalid_field", "port_of_loading");
  if (to === "?") throw new TradeParseError("invalid_field", "port_of_discharge");

  const result = TransportDocumentExtraction.safeParse({
    doc_type: docType,
    document_number: number,
    on_board_date: date,
    port_of_loading: from,
    port_of_discharge: to,
    hidden_text_detected: hiddenFlag(text),
  });
  if (!result.success) throw new TradeParseError("schema_mismatch");
  return { extraction: result.data, destinations: findTradeDestinations(text.all), hiddenReasons: text.hiddenReasons };
}

const CURRENCY_ALIASES: Record<string, Currency> = { "US$": "USD", RMB: "CNY", "HK$": "HKD", "€": "EUR" };
const CURRENCY = String.raw`(USD|EUR|CNY|HKD|RMB|US\$|HK\$|€)`;
const AMOUNT = String.raw`(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)`;
// The invoice total states its currency, before or after the amount. Requiring it keeps
// "TOTAL PACKAGES: 20" or "TOTAL QUANTITY 500" from being read as the amount.
const TOTAL_RE = new RegExp(
  String.raw`(?<!SUB\s?)\bTOTAL(?:\s+AMOUNT)?(?:\s+(?:EXW|FOB|CIF|CFR))?\s*:?\s*(?:${CURRENCY}\s*${AMOUNT}|${AMOUNT}\s*${CURRENCY})\s*$`,
);
const INVOICE_NO = /\bINVOICE\s*(?:NO\.?|NUMBER|#)\s*:?\s*([A-Z0-9][A-Z0-9\-/.]{0,28})/;
const ORDER_NO = /\b(?:P\.?\s?O\.?|PURCHASE\s+ORDER|ORDER)\s*(?:NO\.?|NUMBER|#)\s*:?\s*([A-Z0-9][A-Z0-9\-/.]{0,28})/;
const INCOTERM_RE = /\b(?:INCOTERMS?(?:\s+20\d{2})?|TERMS\s+OF\s+(?:DELIVERY|SALE)|PRICE\s+TERMS?|TRADE\s+TERMS?)\s*:?\s*([A-Z]{3})\b/;
const RUT_RE = /\b(\d{1,2}\.?\d{3}\.?\d{3}\s*-\s*[0-9K])\b/g;
// Without spaces inside the code: "8467.21 50 PCS" must not read as 84672150
const HS_RE = /\bH\.?\s?S\.?\s*(?:CODE)?\s*(?:NO\.?)?\s*:?\s*(\d{4}(?:\.?\d{2}){1,3})\b/;

export function parseCommercialInvoiceText(text: TradeText): ParsedCommercialInvoice {
  const docType = detectDocType(text.visible);
  if (docType !== "COMMERCIAL_INVOICE") throw new TradeParseError("unknown_document_type");
  const v = text.visible;

  const capture = (re: RegExp, field: TradeParsedField, norm: (s: string) => string) =>
    single(
      v.flatMap((l) => {
        const m = re.exec(l);
        return m ? [normalized(field, () => norm(m[1]!))] : [];
      }),
      field,
    );

  const invoiceNumber = capture(INVOICE_NO, "invoice_number", normalizeReference);
  const orderNumber = capture(ORDER_NO, "order_number", normalizeReference);

  const totals = v.flatMap((l) => {
    const m = TOTAL_RE.exec(l);
    if (!m) return [];
    const cur = m[1] ?? m[4]!;
    return [{ currency: CURRENCY_ALIASES[cur] ?? cur, amount: normalized("amount", () => amountToMinor(m[2] ?? m[3]!)) }];
  });
  const amount = single(
    totals.map((t) => t.amount),
    "amount",
  );
  const currency = single(
    totals.map((t) => t.currency),
    "currency",
  );
  if (!(CURRENCIES as readonly string[]).includes(currency)) throw new TradeParseError("invalid_field", "currency");

  const incoterm = capture(INCOTERM_RE, "incoterm", (s) => s);
  const importer = single(
    v.flatMap((l) => [...l.matchAll(RUT_RE)].map((m) => normalized("importer_tax_id", () => normalizeRut(m[1]!)))),
    "importer_tax_id",
  );
  const hsCode = capture(HS_RE, "hs_code", normalizeHsCode);

  const parsed = CommercialInvoiceExtraction.safeParse({
    invoice_number: invoiceNumber,
    order_number: orderNumber,
    amount_minor: amount,
    currency,
    incoterm,
    importer_tax_id: importer,
    hs_code: hsCode,
    mentions_account_change: mentionsAccountChange(text.all) || announcesNewAccount(text.all),
    hidden_text_detected: hiddenFlag(text),
  });
  if (!parsed.success) {
    // An incoterm outside the schema's enum (DAP, DDP, FCA...) is a field the order cannot carry
    if (parsed.error.issues.some((i) => i.path[0] === "incoterm")) throw new TradeParseError("invalid_field", "incoterm");
    throw new TradeParseError("schema_mismatch");
  }
  return { extraction: parsed.data, destinations: findTradeDestinations(text.all), hiddenReasons: text.hiddenReasons };
}

// English phrasing of trade correspondence that the Spanish patterns of Keel Personal miss.
const NEW_ACCOUNT_RES = [
  /\b(NEW|UPDATED|CHANGED|DIFFERENT)\s+(BANK(ING)?\s+)?(ACCOUNT|DETAILS|BENEFICIARY|REMITTANCE|PAYMENT\s+(DETAILS|INFORMATION|INSTRUCTIONS))\b/,
  /\b(REMIT|PAY|TRANSFER)\s+(THE\s+)?(BALANCE|PAYMENT|AMOUNT|FUNDS)?\s*TO\s+(OUR|THE)\s+(NEW|FOLLOWING|BELOW)\b/,
  /\b(ACCOUNT|BANK\s+DETAILS)\s+(HAS|HAVE)\s+(BEEN\s+)?(CHANGED|UPDATED)\b/,
  // A payment instruction to a wallet or address is an account change in all but name
  /\b(PAY|REMIT|TRANSFER|SEND)\b.{0,30}\bTO\s+(THIS\s+|OUR\s+|THE\s+|A\s+)?(WALLET|ADDRESS)\b/,
];

export function announcesNewAccount(lines: string[]): boolean {
  return lines.some((line) => NEW_ACCOUNT_RES.some((re) => re.test(canon(line))));
}

const IBAN_RE = /\b([A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){3,7}(?: ?[A-Z0-9]{1,4})?)\b/g;
const ACCOUNT_RE = /\b(?:A\/C|ACCOUNT)\s*(?:NO\.?|NUMBER|#)?\s*:?\s*([0-9][0-9\- ]{5,30}[0-9])\b/g;

// Wallets and bank accounts anywhere in the document, hidden text included, normalized so they
// can be compared with the destinations registered for the exporter.
export function findTradeDestinations(lines: string[]): PaymentDestination[] {
  const found = new Map<string, PaymentDestination>();
  for (const d of findPaymentDestinations(lines)) found.set(`${d.kind}:${d.value}`, d);
  for (const line of lines.map(canon)) {
    for (const m of line.matchAll(IBAN_RE)) {
      const value = m[1]!.replace(/\s/g, "");
      found.set(`bank_account:${value}`, { kind: "bank_account", value });
    }
    for (const m of line.matchAll(ACCOUNT_RE)) {
      const value = m[1]!.replace(/[\s-]/g, "");
      found.set(`bank_account:${value}`, { kind: "bank_account", value });
    }
  }
  return [...found.values()];
}

export async function parseTransportDocument(pdf: Uint8Array): Promise<ParsedTransportDocument> {
  return parseTransportText(await readTradeText(pdf));
}

export async function parseCommercialInvoice(pdf: Uint8Array): Promise<ParsedCommercialInvoice> {
  return parseCommercialInvoiceText(await readTradeText(pdf));
}
