// Amounts, dates and days left, formatted for a chat message.
import type { Currency } from "../domain/notice";

// Decimals per currency. The payment token is open decision 1: change it here.
export const DECIMALS: Record<Currency, number> = { USD: 2, EUR: 2, CNY: 2, HKD: 2 };

const grouped = new Intl.NumberFormat("en-US", { useGrouping: true, maximumFractionDigits: 0 });

// 2400000, USD -> "24,000.00 USD". Integer arithmetic: no float rounding.
export function formatAmount(minor: number, currency: Currency): string {
  const d = DECIMALS[currency];
  const unit = 10 ** d;
  const whole = Math.floor(minor / unit);
  const frac = String(minor % unit).padStart(d, "0");
  return `${grouped.format(whole)}${d > 0 ? `.${frac}` : ""} ${currency}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Dates are shown in UTC: the parties are in Chile and Hong Kong, and a deadline set on chain is
// one instant. The year is shown only when it is not the current one.
export function formatDate(unixSeconds: number, nowMs: number): string {
  const d = new Date(unixSeconds * 1000);
  const day = `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
  return d.getUTCFullYear() === new Date(nowMs).getUTCFullYear() ? day : `${day}, ${d.getUTCFullYear()}`;
}

export function formatDaysLeft(days: number): string {
  if (days === 0) return "the deadline is today";
  return days === 1 ? "1 day left" : `${days} days left`;
}

// 45990 -> "$45.990": Chilean pesos, no decimals, dot as thousands separator.
export function formatClp(amount: number): string {
  return `$${String(amount).replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;
}

// 2026, 10 -> "Oct 2026"
export function formatPeriod(year: number, month: number): string {
  return `${MONTHS[month - 1]} ${year}`;
}

// Personal: due in N days.
export function formatDueIn(days: number): string {
  if (days === 0) return "is due today";
  return days === 1 ? "is due tomorrow" : `is due in ${days} days`;
}
