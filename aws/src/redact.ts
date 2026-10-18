// Nothing that reaches a log line or the Lambda runtime may carry the RPC URL: the endpoint holds
// its API key in the path or the query, and viem puts the full URL in the message of an
// HttpRequestError. Every URL is replaced, whatever the error that carried it.
const URL_PATTERN = /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>)]+/gi;

export const redactUrls = (text: string): string => text.replace(URL_PATTERN, "[redacted-url]");

// A message that is safe to log: the short message viem keeps apart from the details (no URL),
// otherwise the message, with every URL removed
export function safeMessage(e: unknown): string {
  if (e instanceof Error) {
    const short = (e as { shortMessage?: unknown }).shortMessage;
    return redactUrls(typeof short === "string" ? short : e.message);
  }
  return redactUrls(String(e));
}

// The same error, rebuilt without a URL in its message or stack, for a handler that must throw
export function redactedError(e: unknown): Error {
  const out = new Error(safeMessage(e));
  out.name = e instanceof Error ? e.name : "Error";
  out.stack = `${out.name}: ${out.message}`;
  return out;
}
