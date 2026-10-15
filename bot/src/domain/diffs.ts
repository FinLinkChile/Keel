// Revalidation of the two readings of a two source mismatch (T3.5).
// T3.5 says the notice shows both values, but a regex is not enough for identifiers:
// "CALL56912345678" passes the document number regex and is a phone number. So:
// - fixed shape fields (dates, amounts, currency) show both values, each revalidated here;
// - identifiers only say which field disagrees, and the app shows both values (T4.2).
// A value that fails its check never blocks the notice: the line falls back to the field name.
import { AmountMinor, Currency, DiffValue, Timestamp, type TradeDiff } from "./notice";
import { z } from "zod";

export type Shown =
  | { type: "date"; at: number }
  | { type: "amount"; minor: number; currency: Currency }
  | { type: "currency"; code: Currency };

export type CheckedDiff =
  | { field: TradeDiff["field"]; display: "values"; a: Shown; b: Shown }
  // valid is false when a value failed its field's check: logged and counted, never shown
  | { field: TradeDiff["field"]; display: "field_only"; valid: boolean };

const DOCUMENT_NUMBER = z.string().regex(/^[A-Z0-9]{6,20}$/);

const parse = <T>(schema: z.ZodType<T>, v: z.infer<typeof DiffValue>): T | undefined => {
  const r = schema.safeParse(v);
  return r.success ? r.data : undefined;
};

// orderCurrency: the currency of the held operation, needed to show an amount. Without it the
// amount line is shown as field only.
export function checkTradeDiff(diff: TradeDiff, orderCurrency?: Currency): CheckedDiff {
  const { field } = diff;
  const both = <T>(schema: z.ZodType<T>, show: (v: T) => Shown): CheckedDiff => {
    const a = parse(schema, diff.a);
    const b = parse(schema, diff.b);
    if (a === undefined || b === undefined) return { field, display: "field_only", valid: false };
    return { field, display: "values", a: show(a), b: show(b) };
  };
  switch (field) {
    case "document_number": {
      const valid = parse(DOCUMENT_NUMBER, diff.a) !== undefined && parse(DOCUMENT_NUMBER, diff.b) !== undefined;
      return { field, display: "field_only", valid };
    }
    case "on_board_date":
      return both(Timestamp, (at) => ({ type: "date", at }));
    case "currency":
      return both(Currency, (code) => ({ type: "currency", code }));
    case "amount_minor": {
      const checked = both(AmountMinor, (minor) => ({ type: "amount", minor, currency: orderCurrency ?? "USD" }));
      if (checked.display === "values" && orderCurrency === undefined) return { field, display: "field_only", valid: true };
      return checked;
    }
  }
}

// How many values of a notice were withheld because they failed their check.
export const withheldCount = (checked: readonly CheckedDiff[]): number =>
  checked.filter((c) => c.display === "field_only" && !c.valid).length;
