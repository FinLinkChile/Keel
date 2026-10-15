// Revalidation of the two readings of a two source mismatch (T3.5).
// T3.5 says the notice shows both values, but a regex is not enough for identifiers:
// "CALL56912345678" passes the document number regex and is a phone number. So:
// - fixed shape fields (dates, amounts, currency, period, alias) show both values, each
//   revalidated here;
// - identifiers only say which field disagrees, and the app shows both values (T4.2).
// A value that fails its check never blocks the notice: the line falls back to the field name.
import { ALIAS_IDS, type AliasId } from "@keel/schemas";
import { z } from "zod";
import {
  AmountClp,
  AmountMinor,
  Currency,
  Timestamp,
  type PersonalDiff,
  type PersonalDiffField,
  type TradeDiff,
  type TradeDiffField,
} from "./notice";

export type Shown =
  | { type: "date"; at: number }
  | { type: "amount"; minor: number; currency: Currency }
  | { type: "currency"; code: Currency }
  | { type: "clp"; amount: number }
  // YYYYMM
  | { type: "period"; year: number; month: number }
  | { type: "alias"; alias: AliasId };

export type DiffField = TradeDiffField | PersonalDiffField;

export type CheckedDiff =
  | { field: DiffField; display: "values"; a: Shown; b: Shown }
  // valid is false when a value failed its field's check: logged and counted, never shown
  | { field: DiffField; display: "field_only"; valid: boolean };

const DOCUMENT_NUMBER = z.string().regex(/^[A-Z0-9]{6,20}$/);
const ISSUER_TAX_ID = z.string().regex(/^[0-9]{7,8}[0-9K]$/);
const INVOICE_NUMBER = z.string().regex(/^[0-9]{1,12}$/);
const PERIOD = z.string().regex(/^20[0-9]{2}(0[1-9]|1[0-2])$/);

type Raw = { field: DiffField; a: string | number; b: string | number };

const parse = <T>(schema: z.ZodType<T>, v: string | number): T | undefined => {
  const r = schema.safeParse(v);
  return r.success ? r.data : undefined;
};

function both<T>(diff: Raw, schema: z.ZodType<T>, show: (v: T) => Shown): CheckedDiff {
  const a = parse(schema, diff.a);
  const b = parse(schema, diff.b);
  if (a === undefined || b === undefined) return { field: diff.field, display: "field_only", valid: false };
  return { field: diff.field, display: "values", a: show(a), b: show(b) };
}

// An identifier is never shown: only whether both values were well formed.
function identifier(diff: Raw, schema: z.ZodType<string>): CheckedDiff {
  const valid = parse(schema, diff.a) !== undefined && parse(schema, diff.b) !== undefined;
  return { field: diff.field, display: "field_only", valid };
}

// orderCurrency: the currency of the held operation, needed to show an amount. Without it the
// amount line is shown as field only.
export function checkTradeDiff(diff: TradeDiff, orderCurrency?: Currency): CheckedDiff {
  switch (diff.field) {
    case "document_number":
      return identifier(diff, DOCUMENT_NUMBER);
    case "on_board_date":
      return both(diff, Timestamp, (at) => ({ type: "date", at }));
    case "currency":
      return both(diff, Currency, (code) => ({ type: "currency", code }));
    case "amount_minor": {
      const checked = both(diff, AmountMinor, (minor) => ({ type: "amount", minor, currency: orderCurrency ?? "USD" }));
      if (checked.display === "values" && orderCurrency === undefined) return { field: diff.field, display: "field_only", valid: true };
      return checked;
    }
  }
}

export function checkPersonalDiff(diff: PersonalDiff): CheckedDiff {
  switch (diff.field) {
    case "issuer_tax_id":
      return identifier(diff, ISSUER_TAX_ID);
    case "invoice_number":
      return identifier(diff, INVOICE_NUMBER);
    case "period":
      return both(diff, PERIOD, (p) => ({ type: "period", year: Number(p.slice(0, 4)), month: Number(p.slice(4)) }));
    case "amount_clp":
      return both(diff, AmountClp, (amount) => ({ type: "clp", amount }));
    case "alias_id":
      return both(diff, z.enum(ALIAS_IDS), (alias) => ({ type: "alias", alias }));
  }
}

// How many values of a notice were withheld because they failed their check.
export const withheldCount = (checked: readonly CheckedDiff[]): number =>
  checked.filter((c) => c.display === "field_only" && !c.valid).length;
