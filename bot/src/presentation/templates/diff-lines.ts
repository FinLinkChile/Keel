// How a checked diff reads in a message, for both modes.
import type { AliasId } from "@keel/schemas";
import type { CheckedDiff, DiffField, Shown } from "../../domain/diffs";
import { formatAmount, formatClp, formatDate, formatPeriod } from "../format";

export const FIELD_NAME: Record<DiffField, string> = {
  doc_type: "Document type",
  document_number: "Document number",
  on_board_date: "On board date",
  port_of_loading: "Port of loading",
  port_of_discharge: "Port of discharge",
  order_number: "Order number",
  amount_minor: "Amount",
  currency: "Currency",
  incoterm: "Incoterm",
  importer_tax_id: "Importer tax ID",
  hs_code: "HS code",
  issuer_tax_id: "Issuer tax ID",
  invoice_number: "Invoice number",
  period: "Period",
  amount_clp: "Amount",
  alias_id: "Bill type",
};

// Fixed names of the aliases, shown instead of anything read from a document.
export const ALIAS_NAME: Record<AliasId, string> = {
  ARRIENDO: "ARRIENDO",
  LUZ: "LUZ",
  INTERNET: "INTERNET",
  GASTOS_COMUNES: "GASTOS COMUNES",
};

export function shown(v: Shown, now: number): string {
  switch (v.type) {
    case "date":
      return formatDate(v.at, now);
    case "amount":
      return formatAmount(v.minor, v.currency);
    case "currency":
    case "incoterm":
    case "port":
      return v.code;
    case "doc_type":
      return v.docType === "BILL_OF_LADING" ? "bill of lading" : "air waybill";
    case "clp":
      return formatClp(v.amount);
    case "period":
      return formatPeriod(v.year, v.month);
    case "alias":
      return ALIAS_NAME[v.alias];
  }
}

export function diffLine(d: CheckedDiff, now: number): string {
  if (d.display === "values") return `${FIELD_NAME[d.field]}: ${shown(d.a, now)} and ${shown(d.b, now)}.`;
  return `${FIELD_NAME[d.field]}: does not match, both values are in Keel.`;
}
