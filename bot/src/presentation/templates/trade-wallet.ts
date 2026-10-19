// Templates for notices about the importer's wallet itself, not one order (Keel Trade, T4.6).
import type { ChangeKind } from "../../domain/notice";
import { formatDate } from "../format";
import type { Render } from "./trade-order";

const CHANGE: Record<ChangeKind, string> = {
  limit: "a new spending limit",
  supplier_added: "a new supplier",
  role_change: "a change in who can act on the account",
  policy_signer: "a change of the key that signs the payment rules",
};

export const changeQueued: Render<"change_queued"> = (n, r, ctx) => {
  const what = CHANGE[n.changeKind];
  const when = formatDate(n.effectiveAt, ctx.now);
  const text =
    r.role === "cosigner"
      ? `A change to ${ctx.name(n.accountId)}'s account is waiting: ${what}. It takes effect on ${when} unless you stop it. Review it in Keel.`
      : `A change to your account is waiting: ${what}. It takes effect on ${when}. If you did not ask for it, ask your cosigner to stop it in Keel.`;
  return { text, link: { label: "Review the change", path: "/cosigner" } };
};

export const transferBlocked: Render<"transfer_blocked"> = () => ({
  text: "Keel blocked a transfer the agent was not allowed to make. Nothing left the account. If you did not expect this, turn off the agent in Keel.",
  link: { label: "See what happened", path: "/activity" },
});

// What the monitor cannot repeat at will: it needs a key outside the system. The monitor fires it
// for a deposit through the gate with a payment request the engine never issued, or for a balance
// released from the escrow with a decision the engine never signed. The message says what was
// seen, never what was paid or to whom, and does not claim a pause: that has its own notice, and
// pausing the gate stops new deposits, not releases from the escrow.
export const unauthorizedExecution: Render<"unauthorized_execution"> = (_n, r) => ({
  text:
    r.role === "cosigner"
      ? "A payment on one of your orders used an approval Keel's engine never issued. A Keel key may have been used outside the system. If it was not expected, pause new deposits in Keel now."
      : "A payment on one of your orders used an approval Keel's engine never issued. A Keel key may have been used outside the system. Check it in Keel, and if you did not expect it, tell your cosigner right away.",
  link: { label: "See what happened", path: "/activity" },
});

export const agentRevoked: Render<"agent_revoked"> = () => ({
  text: "The Keel agent was turned off. It can no longer pay anything. Payments wait until it is turned back on in Keel.",
  link: { label: "Open agent settings", path: "/agent" },
});

export const gatePaused: Render<"gate_paused"> = () => ({
  text: "Keel payments are paused. Nothing will be paid until they are resumed in Keel.",
  link: { label: "Open agent settings", path: "/agent" },
});
