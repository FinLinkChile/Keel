// How a template's link reaches the chat.
// - Public base (https and not local): an inline button.
// - Local base (localhost, 127.0.0.1) or plain http: the URL at the end of the text. Whether
//   Telegram accepts buttons to a local URL is not certain, and this way it does not matter.
// - No base: no link.
// To record the demo, point APP_BASE_URL at a tunnel. No code change.
import type { Message } from "../../domain/message";

export type Placement = { kind: "button"; label: string; url: string } | { kind: "text"; url: string } | undefined;

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "0.0.0.0"]);

export function placeLink(message: Message, appBaseUrl: string | undefined): Placement {
  if (!message.link || !appBaseUrl) return undefined;
  const url = `${appBaseUrl}${message.link.path}`;
  const base = new URL(appBaseUrl);
  const isPublic = base.protocol === "https:" && !LOCAL_HOSTS.has(base.hostname) && !base.hostname.endsWith(".localhost");
  return isPublic ? { kind: "button", label: message.link.label, url } : { kind: "text", url };
}

// The text as sent: with the URL appended when it cannot go as a button.
export function textWithLink(message: Message, placement: Placement): string {
  return placement?.kind === "text" ? `${message.text}\n\n${message.link?.label}: ${placement.url}` : message.text;
}
