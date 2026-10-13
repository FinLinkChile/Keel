// Beneficiary change detection. T3.6, issue #23.
// A destination found in a document never becomes a payment address. It can only open a
// change request, which the owner reviews (Area 4's readable diff) and, if confirmed,
// queues through the Delay Modifier (Area 1).
import type { AliasId, InvoiceExtraction } from "@keel/schemas";
import type { AuthSummary } from "./email/auth";
import type { AliasEntry, PaymentDestination } from "./parser";

export const CHANGE_TRIGGERS = ["announced_in_document", "unknown_destination"] as const;
export type ChangeTrigger = (typeof CHANGE_TRIGGERS)[number];

export interface ChangeRequest {
  aliasId: AliasId;
  // Destinations registered for the alias at onboarding
  previous: PaymentDestination[];
  // Destinations in the document that are not registered (may be empty if only announced)
  proposed: PaymentDestination[];
  triggers: ChangeTrigger[];
  source: { fromDomain: string; auth: AuthSummary };
  // sha256 of the PDF and of the raw email
  documentHash: string;
  messageHash: string;
  createdAt: string;
}

const key = (d: PaymentDestination) => `${d.kind}:${d.value.toLowerCase()}`;

export function detectBeneficiaryChange(
  alias: AliasEntry,
  extraction: InvoiceExtraction,
  destinations: PaymentDestination[],
): { triggers: ChangeTrigger[]; proposed: PaymentDestination[] } | null {
  const known = new Set((alias.knownDestinations ?? []).map(key));
  const proposed = destinations.filter((d) => !known.has(key(d)));
  const triggers: ChangeTrigger[] = [];
  if (extraction.mentions_account_change) triggers.push("announced_in_document");
  if (proposed.length > 0) triggers.push("unknown_destination");
  return triggers.length > 0 ? { triggers, proposed } : null;
}
