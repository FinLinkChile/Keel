// What the application needs from the outside. main.ts plugs in the adapters.
import type { Message, RenderContext } from "../domain/message";
import type { Notice } from "../domain/notice";
import type { AccountId, Recipient, Role } from "../domain/recipients";

export type { RenderContext };

// Telegram chat id. Group chats are negative.
export type ChatId = number;

export interface Renderer {
  render(notice: Notice, recipient: Recipient, ctx: RenderContext): Message;
  // The single fixed message sent when a chat goes over its hourly cap.
  overflow(): Message;
}

export interface MessageSender {
  // Throws RetryableSendError when the same send may work later (rate limit, outage)
  send(chatId: ChatId, message: Message): Promise<void>;
}

// A send that failed for a reason that may pass: Telegram's 429 or 5xx, or the network. Any other
// error is final (a blocked bot, a chat that no longer exists) and is never retried.
export class RetryableSendError extends Error {
  override name = "RetryableSendError";
}

// Loaded once at startup (the recipients file)
export interface RecipientDirectory {
  name(accountId: AccountId): string | undefined;
  chats(accountId: AccountId, role: Role): readonly ChatId[];
}

// The same questions against a store (DynamoDB in the cloud), where chats are linked at run time
export interface RecipientLookup {
  name(accountId: AccountId): Promise<string | undefined>;
  chats(accountId: AccountId, role: Role): Promise<readonly ChatId[]>;
}

// Result of counting one capped message for a chat: within the cap, the first one over it (the
// fixed overflow message goes out once) or any later one.
export type Admission = "admitted" | "over_cap_first" | "over_cap";

// What NotifyService remembers between notices. In memory for the local bot; in a store for the
// cloud, where each invocation starts empty and the same notice may arrive twice.
export interface NotifyState {
  // Records a notice id. True the first time it is seen.
  firstSeen(noticeId: string): Promise<boolean>;
  // Claims the delivery of a notice to one chat: true the first time only, so a notice that
  // arrives twice (a producer retry, a queue redelivery) reaches each chat once. In a store the
  // claim is a short lease: if the invocation dies before confirm(), the chat is free again
  // once the lease ends, so a crash mid-send never loses the notice.
  claim(noticeId: string, chatId: ChatId): Promise<boolean>;
  // Turns the lease into the long record, once the send is over for good (sent, or a final error).
  confirm(noticeId: string, chatId: ChatId): Promise<void>;
  // Gives a claim back after a failure that will be retried.
  release(noticeId: string, chatId: ChatId): Promise<void>;
  // Gives back the cap slot `admit` counted for a message that was not delivered.
  refund(chatId: ChatId, now: number): Promise<void>;
  // Records a document hold on one side of an order. True if that side already had one.
  documentHold(orderRef: string, side: string): Promise<boolean>;
  // Counts one capped message for a chat at `now` (Unix ms) against `max` per hour.
  admit(chatId: ChatId, now: number, max: number): Promise<Admission>;
}

export interface Clock {
  // Unix ms
  now(): number;
}

// Entries carry ids, kinds, enums and counts only, never a value taken from a notice field.
export type LogEntry =
  | { event: "rejected"; noticeId?: string; issues: { path: string; code: string }[] }
  | { event: "unknown_account"; noticeId: string; kind: string }
  | { event: "duplicate"; noticeId: string; kind: string }
  | { event: "diff_withheld"; noticeId: string; kind: string; fields: string[] }
  | { event: "no_chats"; noticeId: string; kind: string; recipient: Recipient }
  | { event: "sent"; noticeId: string; kind: string; chatId: ChatId; recipient: Recipient }
  | { event: "send_failed"; noticeId: string; kind: string; chatId: ChatId; error: string; retry?: boolean }
  | { event: "rate_limited"; noticeId: string; kind: string; chatId: ChatId }
  | { event: "overflow_sent"; chatId: ChatId };

export interface Logger {
  log(entry: LogEntry): void;
}
