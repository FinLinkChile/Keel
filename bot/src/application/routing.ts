// Routing table: which sides and roles each notice reaches. The templates get the recipient, so
// the same event is told differently on each side.
import { isDocumentReason, type Notice, type Parties } from "../domain/notice";
import type { Recipient, Role, Side } from "../domain/recipients";

type Route = Partial<Record<Side, readonly Role[]>>;

const BOTH: Route = { importer: ["owner", "operator"], exporter: ["owner", "operator"] };
const WALLET: Route = { importer: ["owner", "cosigner"] };

function routeOf(n: Notice): Route {
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
    case "transfer_blocked":
    case "agent_revoked":
    case "gate_paused":
      return WALLET;
    case "dispute_raised":
    case "dispute_resolved":
      return { ...BOTH, arbiter: ["owner"] };
  }
}

const accountOn = (parties: Parties, side: Side) => parties[side];

// Order of the result: importer, exporter, arbiter, and the roles in table order.
export function route(n: Notice): Recipient[] {
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
