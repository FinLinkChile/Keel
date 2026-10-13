// One inbound email, end to end. Checks run cheapest first, so a flood costs no LLM calls:
// authentication, duplicate message, sender rate limit, PDF, parser, duplicate invoice,
// model, two-source agreement, alias binding, beneficiary change with its own limits.
import { createHash } from "node:crypto";
import type { DNSResolver } from "mailauth";
import type { Hex } from "@keel/schemas";
import { readInvoice, type InvoiceReading } from "../agreement";
import { detectBeneficiaryChange } from "../beneficiaryChange";
import type { ExtractorProvider } from "../extractor";
import type { AliasTable } from "../parser";
import { MAX_EMAILS_PER_SENDER_PER_DAY, type IngestStore, type StoredChangeRequest } from "../store";
import { authenticateEmail, type AuthFailure, type AuthSummary, type Envelope } from "./auth";
import { extractInvoicePdf, MimeError, type MimeFailure } from "./mime";

export type QuarantineReason =
  | AuthFailure
  | MimeFailure
  | "rate_limited"
  | "alias_domain_mismatch"
  // A change request for this alias is already waiting for the owner
  | "change_pending"
  // A change for this alias was rejected or vetoed less than CHANGE_COOLDOWN_DAYS ago
  | "change_cooldown";

interface Received {
  // sha256 of the raw message, to log and deduplicate without storing its content
  messageHash: string;
  auth: AuthSummary;
}

type Read = Extract<InvoiceReading, { status: "ready" | "escalated" }>;

export type EmailOutcome =
  | ({ status: "quarantined"; reason: QuarantineReason } & Received)
  // The same message again (invoiceKey absent), or the same invoice in a new message
  | ({ status: "duplicate"; invoiceKey?: Hex } & Received)
  // A change request replaces the payment path: this invoice is never "ready" as received
  | ({ status: "change_requested"; changeRequest: StoredChangeRequest } & Omit<Read, "status"> & Received)
  | (Exclude<InvoiceReading, { status: "duplicate" }> & Received);

export interface ReceiveOptions {
  requireDmarc: boolean;
  store: IngestStore;
  resolver?: DNSResolver;
}

export async function receiveEmail(
  raw: Buffer,
  envelope: Envelope,
  aliases: AliasTable,
  extractor: ExtractorProvider,
  options: ReceiveOptions,
): Promise<EmailOutcome> {
  const { store } = options;
  const messageHash = createHash("sha256").update(raw).digest("hex");
  const authResult = await authenticateEmail(raw, envelope, aliases, options);
  const { auth } = authResult;
  const quarantine = (reason: QuarantineReason): EmailOutcome => ({ status: "quarantined", reason, messageHash, auth });
  if (authResult.status === "quarantined") return quarantine(authResult.reason);

  // Only authenticated mail counts against a sender, so nobody can spend a domain's quota
  if (!store.recordEmail(messageHash, authResult.fromDomain)) return { status: "duplicate", messageHash, auth };
  if (store.emailsFromSender(authResult.fromDomain) > MAX_EMAILS_PER_SENDER_PER_DAY) return quarantine("rate_limited");

  let pdf: Uint8Array;
  try {
    pdf = await extractInvoicePdf(raw);
  } catch (e) {
    if (e instanceof MimeError) return quarantine(e.reason);
    throw e;
  }

  const reading = await readInvoice(pdf, aliases, extractor, { isDuplicate: (key) => store.hasInvoice(key) });
  if (reading.status === "held") return { ...reading, messageHash, auth };
  if (reading.status === "duplicate") return { status: "duplicate", invoiceKey: reading.invoiceKey, messageHash, auth };
  // An authenticated sender may only bill as its own alias: the customs agent's domain
  // cannot deliver an invoice issued under the warehouse's RUT.
  if (!authResult.aliases.includes(reading.extraction.alias_id)) return quarantine("alias_domain_mismatch");

  const alias = aliases.find((a) => a.alias === reading.extraction.alias_id)!;
  const change = detectBeneficiaryChange(alias, reading.extraction, reading.destinations);
  if (change) {
    // Nobody signs out of fatigue: one pending request per alias, and a pause after a "no"
    if (store.inCooldown(alias.alias)) return quarantine("change_cooldown");
    const stored = store.addChangeRequest({
      aliasId: alias.alias,
      previous: alias.knownDestinations ?? [],
      proposed: change.proposed,
      triggers: change.triggers,
      source: { fromDomain: authResult.fromDomain, auth },
      documentHash: createHash("sha256").update(pdf).digest("hex"),
      messageHash,
      createdAt: new Date().toISOString(),
    });
    if (!stored) return quarantine("change_pending");
    const { status: _readStatus, ...rest } = reading;
    return { ...rest, status: "change_requested", changeRequest: stored, messageHash, auth };
  }

  // Recorded only once it enters the payment path; PDRGate enforces it again on chain
  store.recordInvoice(reading.invoiceKey, messageHash);
  return { ...reading, messageHash, auth };
}
