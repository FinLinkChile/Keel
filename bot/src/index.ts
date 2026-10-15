// Telegram bot. Owned by Area 4. T4.3 (#28) and T4.6 (#31).
// It only sends template messages built from typed fields (enums, amounts, dates),
// never text taken from an email or a PDF. It answers only to registered chats and
// signs nothing: links open the Keel app, where the person's wallet signs.
export { Notice, type NoticeKind } from "./domain/notice";
export type { Message } from "./domain/message";
export type { Recipient, Role, Side, AccountKind } from "./domain/recipients";
export { NotifyService, type NotifyResult, type NotifyStats } from "./application/notify";
export { route } from "./application/routing";
export { templateRenderer } from "./presentation/templates";
