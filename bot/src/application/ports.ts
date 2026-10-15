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
  send(chatId: ChatId, message: Message): Promise<void>;
}

export interface RecipientDirectory {
  name(accountId: AccountId): string | undefined;
  chats(accountId: AccountId, role: Role): readonly ChatId[];
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
  | { event: "send_failed"; noticeId: string; kind: string; chatId: ChatId; error: string }
  | { event: "rate_limited"; noticeId: string; kind: string; chatId: ChatId }
  | { event: "overflow_sent"; chatId: ChatId };

export interface Logger {
  log(entry: LogEntry): void;
}
