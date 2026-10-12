// Telegram bot. Owned by Area 4. T4.3, issue #28.
// It only sends template messages built from typed fields (enums, amounts, dates),
// never text taken from an email or a PDF. It answers only to registered chats and
// signs nothing: buttons open the Keel app, where the owner's wallet signs.
import type { PaymentState } from "@keel/schemas";

export interface HeldPaymentNotice {
  state: PaymentState;
  amountClp: number;
  // Unix timestamp, seconds
  dueDate: number;
}

export function renderHeldPayment(_notice: HeldPaymentNotice): string {
  throw new Error("not implemented: T4.3 (#28), T4.6 (#31)");
}
