// Templates for Keel Personal (T4.6): what happened, why, how long until the due date and how
// to pay by hand if it is urgent. Bills are named by their fixed alias, never by the issuer.
import { checkPersonalDiff } from "../../domain/diffs";
import type { Message, RenderContext } from "../../domain/message";
import type { NoticeKind, NoticeOf, PaymentHeldReason } from "../../domain/notice";
import type { Recipient } from "../../domain/recipients";
import { formatClp, formatDate, formatDueIn } from "../format";
import { ALIAS_NAME, diffLine, FIELD_NAME, shown } from "./diff-lines";

type Render<K extends NoticeKind> = (n: NoticeOf<K>, r: Recipient, ctx: RenderContext) => Message;

const MANUAL = "If it is urgent, pay it from your bank as usual.";
const billLink = (alias: string) => ({ label: "Open the bill", path: `/bills/${alias}` });

const lines = (...parts: (string | false | undefined)[]) => parts.filter(Boolean).join(" ");

const HELD_WHY: Record<PaymentHeldReason, (alias: string) => string> = {
  issuer_mismatch: (alias) => `the bill comes from a different company than the one registered for ${alias}`,
  amount_out_of_range: () => "the amount is far from what this bill usually costs",
  over_period_limit: () => "it is above this month's limit",
  fx_divergence: () => "the exchange rate sources disagree",
  account_change_request: () => "the bill asks to change where it is paid",
  hidden_text: () => "the bill has hidden text",
  simulation_failed: () => "the payment did not pass Keel's last check",
};

export const paymentHeld: Render<"payment_held"> = (n, _r, ctx) => ({
  text: lines(
    `Your ${ALIAS_NAME[n.aliasId]} bill of ${formatClp(n.amountClp)} is on hold: ${HELD_WHY[n.reason](ALIAS_NAME[n.aliasId])}.`,
    `Nothing was paid. It is due on ${formatDate(n.dueDate, ctx.now)}.`,
    MANUAL,
  ),
  link: billLink(n.aliasId),
});

export const paymentDeadline: Render<"payment_deadline"> = (n, _r, ctx) => ({
  text: lines(
    `Your ${ALIAS_NAME[n.aliasId]} bill of ${formatClp(n.amountClp)} is on hold and ${formatDueIn(n.daysLeft)} (${formatDate(n.dueDate, ctx.now)}).`,
    MANUAL,
  ),
  link: billLink(n.aliasId),
});

export const invoiceNeedsCosign: Render<"invoice_needs_cosign"> = (n, r, ctx) => {
  const alias = ALIAS_NAME[n.aliasId];
  const checked = n.diffs.map(checkPersonalDiff);
  const [only] = checked;
  // One disagreement reads as a sentence; several as a list.
  const detail =
    checked.length === 1 && only
      ? only.display === "values"
        ? `disagree on the ${FIELD_NAME[only.field].toLowerCase()}: ${shown(only.a, ctx.now)} and ${shown(only.b, ctx.now)}.`
        : `disagree on the ${FIELD_NAME[only.field].toLowerCase()}. Both values are in Keel.`
      : `disagree. ${checked.map((d) => diffLine(d, ctx.now)).join(" ")}`;
  if (r.role === "cosigner") {
    return {
      text: lines(
        `Your approval is needed. The two readings of ${ctx.name(n.accountId)}'s ${alias} bill ${detail}`,
        "Nothing is paid until you approve it.",
      ),
      link: { label: "Review it", path: "/cosigner" },
    };
  }
  return {
    text: lines(`The two readings of your ${alias} bill ${detail}`, "Your cosigner needs to approve it before it is paid."),
    link: billLink(n.aliasId),
  };
};

export const invoiceHeld: Render<"invoice_held"> = (n) => {
  const bill = n.aliasId ? `your ${ALIAS_NAME[n.aliasId]} bill` : "a bill";
  const what = n.reason === "parser_failed" ? `Keel could not read ${bill}.` : `Keel could not finish reading ${bill}.`;
  return {
    text: lines(what, "It was not paid. Check it in Keel.", MANUAL),
    link: n.aliasId ? billLink(n.aliasId) : { label: "See activity", path: "/activity" },
  };
};

const TRIGGER: Record<NoticeOf<"change_requested">["triggers"][number], string> = {
  announced_in_document: "it announces a new account",
  unknown_destination: "it shows an account that is not registered",
};

export const changeRequested: Render<"change_requested"> = (n, r, ctx) => {
  const alias = ALIAS_NAME[n.aliasId];
  const why = n.triggers.map((t) => TRIGGER[t]).join(" and ");
  const link = { label: "Review the request", path: `/changes/${n.requestId}` };
  if (r.role === "cosigner") {
    return {
      text: lines(
        `${ctx.name(n.accountId)} got a request to change where the ${alias} bill is paid: ${why}.`,
        "Nothing changed and nothing was paid. If it is approved, you can still stop it before it takes effect.",
      ),
      link,
    };
  }
  return {
    text: lines(
      `A ${alias} bill asks to change where it is paid: ${why}.`,
      "Keel changed nothing and paid nothing. Approve it in Keel only if you expected this change.",
    ),
    link,
  };
};

export const changeDigest: Render<"change_digest"> = (n) => {
  const aliases = n.aliasIds.map((a) => ALIAS_NAME[a]);
  const list = aliases.length > 1 ? `${aliases.slice(0, -1).join(", ")} and ${aliases.at(-1)}` : aliases[0];
  const requests = n.count === 1 ? "1 account change request" : `${n.count} account change requests`;
  return {
    text: `${requests} arrived today for ${list}. Review them in Keel. Do not approve a change you did not expect.`,
    link: { label: "Review requests", path: "/activity" },
  };
};

export const paymentExecuted: Render<"payment_executed"> = (n) => ({
  text: `Your ${ALIAS_NAME[n.aliasId]} bill of ${formatClp(n.amountClp)} was paid to its registered account.`,
  link: { label: "See activity", path: "/activity" },
});

export const changeVetoed: Render<"change_vetoed"> = (n) => ({
  text: `The change to where your ${ALIAS_NAME[n.aliasId]} bill is paid was stopped. Payments keep going to the registered account.`,
  link: { label: "See activity", path: "/activity" },
});

export const changeScheduled: Render<"change_scheduled"> = (n, r, ctx) => {
  const alias = ALIAS_NAME[n.aliasId];
  const when = formatDate(n.effectiveAt, ctx.now);
  const text =
    r.role === "cosigner"
      ? `A change to where ${ctx.name(n.accountId)}'s ${alias} bill is paid takes effect on ${when}. If it looks wrong, stop it in Keel before then.`
      : `The new payment account for your ${alias} bill takes effect on ${when}. Until then your cosigner can stop it.`;
  return { text, link: { label: "Review the change", path: "/cosigner" } };
};
