// Templates for notices about one order (Keel Trade, T4.6). One pure function per kind.
// Each message says what happened, why, how much time is left and what the person can do.
// Only typed fields reach the text: names come from the directory, never from the notice.
import { checkTradeDiff } from "../../domain/diffs";
import type { Message, RenderContext } from "../../domain/message";
import type { NoticeKind, NoticeOf, Parties } from "../../domain/notice";
import type { Recipient } from "../../domain/recipients";
import { formatAmount, formatDate, formatDaysLeft } from "../format";
import { diffLine } from "./diff-lines";

export type Render<K extends NoticeKind> = (n: NoticeOf<K>, r: Recipient, ctx: RenderContext) => Message;

const names = (n: { parties: Parties }, ctx: RenderContext) => ({
  imp: ctx.name(n.parties.importer),
  exp: ctx.name(n.parties.exporter),
});

const orderLink = (n: { orderRef: string }) => ({ label: "Open the order", path: `/orders/${n.orderRef}` });
const documentsLink = (n: { orderRef: string }) => ({ label: "Review the documents", path: `/orders/${n.orderRef}/documents` });

const lines = (...parts: (string | false | undefined)[]) => parts.filter(Boolean).join(" ");

export const orderOpened: Render<"order_opened"> = (n, r, ctx) => {
  const { imp, exp } = names(n, ctx);
  const total = formatAmount(n.amountMinor, n.currency);
  const shipBy = formatDate(n.shipmentDeadline, ctx.now);
  const text =
    r.side === "exporter"
      ? lines(
          `${imp} signed order ${n.orderLabel} with you. Total: ${total}.`,
          `Ship by ${shipBy}.`,
          `You will be told when ${imp} deposits the total.`,
        )
      : lines(
          `Order ${n.orderLabel} with ${exp} is signed by both sides. Total: ${total}.`,
          `${exp} must ship by ${shipBy}.`,
          "Next step: deposit the total in Keel.",
        );
  return { text, link: orderLink(n) };
};

export const orderFunded: Render<"order_funded"> = (n, r, ctx) => {
  const { imp, exp } = names(n, ctx);
  const total = formatAmount(n.amountMinor, n.currency);
  const text =
    r.side === "exporter"
      ? lines(
          `${imp} deposited ${total} for ${n.orderLabel}. The total is locked for you.`,
          "You get the advance as the signed order says, and the balance after your proof of shipment is accepted and the dispute window closes.",
        )
      : lines(
          `Your deposit of ${total} for ${n.orderLabel} is locked in Keel.`,
          `It is paid to ${exp} only as the signed order says: the advance first, the balance after proof of shipment.`,
        );
  return { text, link: orderLink(n) };
};

export const advanceReleased: Render<"advance_released"> = (n, r, ctx) => {
  const { exp } = names(n, ctx);
  const advance = formatAmount(n.amountMinor, n.currency);
  const text =
    r.side === "exporter"
      ? lines(`You received the ${advance} advance for ${n.orderLabel}.`, "Next step: ship and upload the bill of lading in Keel.")
      : lines(
          `Advance of ${advance} paid to ${exp} for ${n.orderLabel}, as the signed order says.`,
          "The rest stays locked until proof of shipment is accepted and the dispute window closes.",
        );
  return { text, link: orderLink(n) };
};

export const shipmentAccepted: Render<"shipment_accepted"> = (n, r, ctx) => {
  const { exp } = names(n, ctx);
  const onBoard = formatDate(n.onBoardDate, ctx.now);
  const windowCloses =
    n.balanceReleasableAt === undefined
      ? "when the dispute window closes"
      : `when the dispute window closes on ${formatDate(n.balanceReleasableAt, ctx.now)}`;
  const text =
    r.side === "exporter"
      ? lines(
          `Your proof of shipment for ${n.orderLabel} was accepted. On board: ${onBoard}.`,
          `The balance is paid to you ${windowCloses}.`,
        )
      : lines(
          `Proof of shipment for ${n.orderLabel} was accepted. The goods were on board on ${onBoard}.`,
          `The balance goes to ${exp} ${windowCloses}, or earlier if you approve it in Keel.`,
          "If something is wrong with the order, open a dispute in Keel before then.",
        );
  return { text, link: orderLink(n) };
};

export const balanceReleased: Render<"balance_released"> = (n, r, ctx) => {
  const { exp } = names(n, ctx);
  const balance = formatAmount(n.amountMinor, n.currency);
  const text =
    r.side === "exporter"
      ? `You received the ${balance} balance for ${n.orderLabel}. The order is settled.`
      : `Balance of ${balance} paid to ${exp}. Order ${n.orderLabel} is settled.`;
  return { text, link: orderLink(n) };
};

export const refunded: Render<"refunded"> = (n, r, ctx) => {
  const { imp } = names(n, ctx);
  const back = formatAmount(n.amountMinor, n.currency);
  const text =
    r.side === "exporter"
      ? lines(
          `${back} went back to ${imp} for ${n.orderLabel}.`,
          "There was no accepted proof of shipment by the deadline. The order is closed.",
        )
      : lines(
          `${back} went back to you for ${n.orderLabel}.`,
          "There was no accepted proof of shipment by the deadline.",
          // The advance left before shipment; a refund only returns what the escrow still held.
          "The advance already paid is not part of this refund. The order is closed.",
        );
  return { text, link: orderLink(n) };
};

export const orderCancelled: Render<"order_cancelled"> = (n, r, ctx) => {
  const { imp } = names(n, ctx);
  const back = formatAmount(n.amountMinor, n.currency);
  const text =
    r.side === "exporter"
      ? `Order ${n.orderLabel} was cancelled by both sides. ${back} went back to ${imp}. The order is closed.`
      : `Order ${n.orderLabel} was cancelled by both sides. ${back} went back to you. The order is closed.`;
  return { text, link: orderLink(n) };
};

export const disputeRaised: Render<"dispute_raised"> = (n, r, ctx) => {
  const { imp, exp } = names(n, ctx);
  const by = n.raisedBy === "importer" ? imp : exp;
  if (r.side === "arbiter") {
    return {
      text: lines(
        `${by} opened a dispute on order ${n.orderLabel} between ${imp} and ${exp}.`,
        "You are the arbiter. The locked funds stay in Keel until you sign how they are split.",
      ),
      link: { label: "Review the dispute", path: `/orders/${n.orderRef}` },
    };
  }
  const opener = n.raisedBy === r.side ? "You" : by;
  return {
    text: lines(
      `${opener} opened a dispute on ${n.orderLabel}.`,
      "The locked funds stay in Keel until the arbiter decides how they are split. They can only go to the two parties of the order.",
    ),
    link: orderLink(n),
  };
};

export const disputeResolved: Render<"dispute_resolved"> = (n, r, ctx) => {
  const { imp, exp } = names(n, ctx);
  const toImp = formatAmount(n.toImporterMinor, n.currency);
  const toExp = formatAmount(n.toExporterMinor, n.currency);
  const head = r.side === "arbiter" ? `Your decision on ${n.orderLabel} was carried out:` : `The arbiter resolved the dispute on ${n.orderLabel}:`;
  return { text: `${head} ${toImp} to ${imp} and ${toExp} to ${exp}. The order is closed.`, link: orderLink(n) };
};

export const operationHeld: Render<"operation_held"> = (n, r, ctx) => {
  const { imp, exp } = names(n, ctx);
  const until = n.deadline === undefined ? undefined : formatDate(n.deadline, ctx.now);
  const amount = n.amountMinor !== undefined && n.currency !== undefined ? formatAmount(n.amountMinor, n.currency) : undefined;

  // The exporter only gets a generic version: never the control that fired nor any value.
  if (r.side === "exporter") {
    return {
      text: lines(
        ctx.repeatDocumentHold
          ? `Another document for ${n.orderLabel} is under review. The balance is still not paid.`
          : `Your documents for ${n.orderLabel} are under review. The balance is not paid yet.`,
        until && `Accepted proof of shipment is needed by ${until}.`,
        `If anything else is needed, ${imp} will contact you.`,
      ),
      link: orderLink(n),
    };
  }

  switch (n.reason) {
    case "over_limit_cosign": {
      const what = amount ? `a ${amount} deposit for ${n.orderLabel}` : `the deposit for ${n.orderLabel}`;
      if (r.role === "cosigner") {
        return {
          text: lines(
            `Your approval is needed: ${what} with ${exp} is above ${imp}'s monthly limit.`,
            "Nothing is paid until you approve it.",
            until && `It expires on ${until}.`,
          ),
          link: { label: "Review it", path: "/cosigner" },
        };
      }
      return {
        text: lines(
          `Your cosigner needs to approve ${what}. It is above this month's limit.`,
          "Nothing is paid until they approve it.",
          until && `It expires on ${until}.`,
        ),
        link: orderLink(n),
      };
    }
    case "new_supplier_wait":
      return {
        text: lines(
          `Keel is holding the first payment for ${n.orderLabel} because ${exp} is a new supplier.`,
          "New suppliers wait before they can be paid, so a fake supplier cannot be paid at once.",
          until ? `It can go ahead on ${until}.` : "It goes ahead when the wait is over.",
          "No action needed.",
        ),
        link: orderLink(n),
      };
    default: {
      const why: Record<typeof n.reason, string> = {
        documents_mismatch: "the shipping documents do not match the signed order.",
        two_source_mismatch: "the two readings of the shipping documents disagree.",
        hidden_text: "a shipping document has hidden text.",
        account_change_mention: "a shipping document mentions a different bank account. The account in the signed order did not change.",
        bl_reused: "the bill of lading was already used for another order.",
        document_unreadable: "Keel could not read a shipping document.",
      };
      const ask = n.reason === "document_unreadable" ? "a clean copy of the document" : "valid documents";
      const diffs = (n.diffs ?? []).map((d) => diffLine(checkTradeDiff(d, n.currency), ctx.now));
      return {
        text: lines(
          `Keel is holding the balance for ${n.orderLabel}: ${why[n.reason]}`,
          ...diffs,
          "Nothing was paid.",
          until
            ? `Ask ${exp} for ${ask} before ${until}. If there is no accepted proof of shipment by then, the balance goes back to you.`
            : n.reason === "document_unreadable"
              ? `Ask ${exp} for ${ask}.`
              : "Review the documents in Keel.",
        ),
        link: documentsLink(n),
      };
    }
  }
};

export const deadlineApproaching: Render<"deadline_approaching"> = (n, r, ctx) => {
  const { imp, exp } = names(n, ctx);
  const by = formatDate(n.deadline, ctx.now);
  const left = formatDaysLeft(n.daysLeft);
  const text =
    r.side === "exporter"
      ? lines(
          `Ship by ${by}: ${left} for ${n.orderLabel}.`,
          `If there is no proof of shipment by then, the balance goes back to ${imp}. Upload the bill of lading in Keel as soon as the goods are on board.`,
        )
      : lines(
          `${exp} must ship ${n.orderLabel} by ${by}: ${left}.`,
          "If there is no proof of shipment by then, the balance goes back to you. No action needed.",
        );
  return { text, link: orderLink(n) };
};

export const accountChangeAttempt: Render<"account_change_attempt"> = (n, r) => {
  const text =
    r.side === "exporter"
      ? lines(
          `Someone asked to change the payment account for ${n.orderLabel}.`,
          "Keel did not change it: payment goes only to the account in the signed order.",
          "If this was not you, someone may be posing as your company.",
        )
      : lines(
          `Keel stopped an account change on ${n.orderLabel}. The account in the signed order did not change. Nothing was paid.`,
          "The account can only change with a new order signed by both sides. No action needed.",
        );
  return { text, link: orderLink(n) };
};
