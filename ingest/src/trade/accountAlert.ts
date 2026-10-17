// Account change detection for Keel Trade. T3.6, issue #23.
// In Keel Trade a document never opens a change request: the payout address is part of the
// purchase order signed by both parties, and it changes only with a new signed order (D12).
// A document that announces other bank details, or carries a destination the exporter has not
// registered, raises an alert for Area 4 to show. Nothing else happens.
import type { Hex, RequiredDocType } from "@keel/schemas";
import type { PaymentDestination } from "../parser";

export const ALERT_TRIGGERS = ["announced_in_document", "unknown_destination"] as const;
export type AlertTrigger = (typeof ALERT_TRIGGERS)[number];

// Fixed reminder code; Area 4 renders the text. It is the whole answer to the alert.
export const ALERT_REMINDER = "payout_changes_only_with_new_signed_order" as const;

export interface AccountAlert {
  orderId: Hex;
  docType: RequiredDocType;
  triggers: AlertTrigger[];
  // Destinations in the document that are neither the order's payout address nor registered
  // for the exporter. Shown so a person can recognise the attempt; never used to pay.
  found: PaymentDestination[];
  source: { channel: "app"; uploader: Hex; party: "importer" | "exporter" };
  // keccak256 of the file, the same hash that goes into docsHash
  documentHash: Hex;
  reminder: typeof ALERT_REMINDER;
  createdAt: string;
}

const key = (d: PaymentDestination) => `${d.kind}:${d.value.toLowerCase()}`;

export function detectAccountAlert(
  mentionsAccountChange: boolean,
  destinations: PaymentDestination[],
  allowed: { payoutAddress: Hex; knownDestinations?: PaymentDestination[] },
): { triggers: AlertTrigger[]; found: PaymentDestination[] } | null {
  const known = new Set([
    key({ kind: "evm_address", value: allowed.payoutAddress }),
    ...(allowed.knownDestinations ?? []).map(key),
  ]);
  const found = destinations.filter((d) => !known.has(key(d)));
  const triggers: AlertTrigger[] = [];
  if (mentionsAccountChange) triggers.push("announced_in_document");
  if (found.length > 0) triggers.push("unknown_destination");
  return triggers.length > 0 ? { triggers, found } : null;
}
