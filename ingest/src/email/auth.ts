// Authenticated inbound channel. T3.1, issue #18.
// A message is accepted only if its author domain (the From a person sees) is proven by
// DMARC (or, if the admin allows it, by an aligned DKIM signature when the domain publishes
// no DMARC record), and that domain is the one registered at onboarding for an alias.
import { authenticate, type AuthenticateResult, type DNSResolver } from "mailauth";
import type { AliasId } from "@keel/schemas";
import type { AliasTable } from "../parser";

// SMTP envelope as seen by the receiving MTA and passed on by the forwarder
export interface Envelope {
  ip?: string;
  helo?: string;
  mailFrom?: string;
}

// Result keywords only: nothing a sender wrote reaches the log or the user
export interface AuthSummary {
  spf: string;
  dkim: string;
  dmarc: string;
  fromDomain?: string;
}

export const AUTH_FAILURES = ["ambiguous_author", "not_authenticated", "unknown_sender_domain"] as const;
export type AuthFailure = (typeof AUTH_FAILURES)[number];

export type EmailAuthResult =
  | { status: "authenticated"; fromDomain: string; aliases: AliasId[]; auth: AuthSummary }
  | { status: "quarantined"; reason: AuthFailure; auth: AuthSummary };

export const domainMatches = (domain: string, registered: string) =>
  domain === registered || domain.endsWith(`.${registered}`);

function summarize(r: AuthenticateResult, fromDomain: string | undefined): AuthSummary {
  const dkimResults = r.dkim.results.map((d) => d.status.result);
  return {
    spf: r.spf ? r.spf.status.result : "none",
    dkim: dkimResults.includes("pass") ? "pass" : (dkimResults[0] ?? "none"),
    dmarc: r.dmarc ? r.dmarc.status.result : "none",
    fromDomain,
  };
}

export interface AuthPolicy {
  // false lets an aligned DKIM signature authenticate a domain with no DMARC record
  requireDmarc: boolean;
  resolver?: DNSResolver;
}

export async function authenticateEmail(
  raw: Buffer,
  envelope: Envelope,
  aliases: AliasTable,
  { requireDmarc, resolver }: AuthPolicy,
): Promise<EmailAuthResult> {
  const result = await authenticate(raw, {
    ip: envelope.ip,
    helo: envelope.helo,
    sender: envelope.mailFrom,
    mta: "keel-ingest",
    ...(resolver ? { resolver } : {}),
  });
  const fromDomain = result.dmarc ? result.dmarc.status.header?.from?.toLowerCase() : undefined;
  const auth = summarize(result, fromDomain);

  if (result.dmarcSkipReason || !fromDomain) return { status: "quarantined", reason: "ambiguous_author", auth };

  const alignedDkim = result.dkim.results.some((d) => d.status.result === "pass" && d.status.aligned);
  const proven = auth.dmarc === "pass" || (!requireDmarc && auth.dmarc === "none" && alignedDkim);
  if (!proven) return { status: "quarantined", reason: "not_authenticated", auth };

  const matching = aliases.filter((a) => domainMatches(fromDomain, a.emailDomain.toLowerCase())).map((a) => a.alias);
  if (matching.length === 0) return { status: "quarantined", reason: "unknown_sender_domain", auth };

  return { status: "authenticated", fromDomain, aliases: matching, auth };
}
