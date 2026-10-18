// A message that is safe to log or to put in an event. viem keeps the URL of the RPC (with its API
// key) in `message` and `details`, never in `shortMessage`, so that one wins; any other message has
// its URLs removed.
export function errorDetail(e: unknown): string {
  const short = (e as { shortMessage?: unknown } | null)?.shortMessage;
  const text = typeof short === "string" ? short : e instanceof Error ? e.message : String(e);
  return text.replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>)]+/gi, "[redacted-url]");
}
