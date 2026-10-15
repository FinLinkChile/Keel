// What a template produces. Plain text, no parse_mode: nothing to escape and no way to inject
// formatting. The link is a path in the app; the sender turns it into a URL.
export interface Message {
  text: string;
  link?: { label: string; path: string };
}

// What a template needs besides the notice and its recipient.
export interface RenderContext {
  // Unix ms
  now: number;
  // Name from the recipient directory. Every account of a notice is checked before rendering.
  name: (accountId: string) => string;
}
