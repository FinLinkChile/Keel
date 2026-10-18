// Routing table: which sides and roles each notice reaches. The templates get the recipient, so
// the same event is told differently on each side.
import { isDocumentReason, isPersonal, type Notice, type Parties, type PersonalNotice, type TradeNotice } from "../domain/notice";
import type { Recipient, Role, Side } from "../domain/recipients";

type Route = Partial<Record<Side, readonly Role[]>>;

const BOTH: Route = { importer: ["owner", "operator"], exporter: ["owner", "operator"] };
const WALLET: Route = { importer: ["owner", "cosigner"] };

function routeOf(n: TradeNotice): Route {
  switch (n.kind) {
    case "order_opened":
    case "order_funded":
    case "shipment_accepted":
    case "balance_released":
    case "refunded":
    case "order_cancelled":
      return BOTH;
    case "advance_released":
      return { importer: ["operator"], exporter: ["owner", "operator"] };
    case "deadline_approaching":
      return { importer: ["operator"], exporter: ["owner", "operator"] };
    case "operation_held":
      if (n.reason === "over_limit_cosign") return { importer: ["cosigner", "owner"] };
      if (isDocumentReason(n.reason)) return { importer: ["owner", "operator"], exporter: ["operator"] };
      return { importer: ["owner", "operator"] };
    case "account_change_attempt":
      return { importer: ["owner", "operator"], exporter: ["owner"] };
    case "change_queued":
      return { importer: ["cosigner", "owner"] };
    case "unauthorized_execution":
      // A chain incident for the whole account: the owner, the operator who runs the agent and the
      // cosigner who can stop it all need to know
      return { importer: ["owner", "operator", "cosigner"] };
    case "transfer_blocked":
    case "agent_revoked":
    case "gate_paused":
      return WALLET;
    case "dispute_raised":
    case "dispute_resolved":
      return { ...BOTH, arbiter: ["owner"] };
  }
}

// Keel Personal: one account, no order with two parties, so no side.
function personalRoles(n: PersonalNotice): readonly Role[] {
  switch (n.kind) {
    case "payment_held":
    case "payment_deadline":
    case "invoice_held":
    case "payment_executed":
    case "change_vetoed":
      return ["owner"];
    case "change_scheduled":
    case "change_requested":
    case "change_digest":
      return ["owner", "cosigner"];
    case "invoice_needs_cosign":
      return ["cosigner", "owner"];
  }
}

const accountOn = (parties: Parties, side: Side) => parties[side];

// Order of the result: importer, exporter, arbiter, and the roles in table order.
export function route(n: Notice): Recipient[] {
  if (isPersonal(n)) return personalRoles(n).map((role) => ({ accountId: n.accountId, role }));
  const table = routeOf(n);
  const out: Recipient[] = [];
  for (const side of ["importer", "exporter", "arbiter"] as const) {
    const roles = table[side];
    if (!roles) continue;
    // Wallet notices belong to the importer's company: in Trade it is the importer's wallet that
    // holds the funds.
    const accountId = "parties" in n ? accountOn(n.parties, side) : side === "importer" ? n.accountId : undefined;
    if (!accountId) continue;
    for (const role of roles) out.push({ accountId, role, side });
  }
  return out;
}
