// The Renderer that main.ts plugs into NotifyService: one template per kind.
import type { Message, RenderContext } from "../../domain/message";
import type { Notice, NoticeKind } from "../../domain/notice";
import type { Recipient } from "../../domain/recipients";
import * as order from "./trade-order";
import type { Render } from "./trade-order";
import * as personal from "./personal";
import * as wallet from "./trade-wallet";

const TEMPLATES: { [K in NoticeKind]: Render<K> } = {
  order_opened: order.orderOpened,
  order_funded: order.orderFunded,
  advance_released: order.advanceReleased,
  shipment_accepted: order.shipmentAccepted,
  balance_released: order.balanceReleased,
  refunded: order.refunded,
  order_cancelled: order.orderCancelled,
  dispute_raised: order.disputeRaised,
  dispute_resolved: order.disputeResolved,
  operation_held: order.operationHeld,
  deadline_approaching: order.deadlineApproaching,
  account_change_attempt: order.accountChangeAttempt,
  change_queued: wallet.changeQueued,
  transfer_blocked: wallet.transferBlocked,
  unauthorized_execution: wallet.unauthorizedExecution,
  agent_revoked: wallet.agentRevoked,
  gate_paused: wallet.gatePaused,
  payment_held: personal.paymentHeld,
  payment_deadline: personal.paymentDeadline,
  invoice_needs_cosign: personal.invoiceNeedsCosign,
  invoice_held: personal.invoiceHeld,
  change_requested: personal.changeRequested,
  change_digest: personal.changeDigest,
  payment_executed: personal.paymentExecuted,
  change_vetoed: personal.changeVetoed,
  change_scheduled: personal.changeScheduled,
};

export function render(notice: Notice, recipient: Recipient, ctx: RenderContext): Message {
  return (TEMPLATES[notice.kind] as Render<NoticeKind>)(notice as never, recipient, ctx);
}

export const OVERFLOW: Message = {
  text: "More alerts arrived this hour. See them in Keel.",
  link: { label: "Open Keel", path: "/activity" },
};

export const templateRenderer = { render, overflow: () => OVERFLOW };
