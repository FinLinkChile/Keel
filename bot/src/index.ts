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

// What the AWS handlers (aws/src/handlers/bot*.ts) compose. The store behind them is injected
// through KeyValueStore, so the bot never depends on the AWS SDK.
export { ROLES, ROLES_BY_KIND, AccountId } from "./domain/recipients";
export { RetryableSendError, type LogEntry, type MessageSender, type NotifyState } from "./application/ports";
export { TelegramSender } from "./adapters/outbound/telegram-sender";
export { AccountName } from "./adapters/config/recipients-file";
export { keys as kvKeys, type KeyValueStore, type KvItem } from "./adapters/kv/store";
export { MemoryKeyValueStore } from "./adapters/kv/memory-store";
export { KvNotifyState } from "./adapters/kv/kv-notify-state";
export { KvDirectory, KvOrders, type AccountMeta } from "./adapters/kv/kv-directory";
export {
  RecipientsAdmin,
  RecipientsChange,
  RecipientsError,
  type RecipientsAudit,
  type RecipientsView,
} from "./adapters/kv/kv-admin";
export { handleQueueMessage, type QueueOutcome, type QueueLog } from "./adapters/inbound/queue-source";
