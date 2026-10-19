// NotifyService: validate, deduplicate, route, cap per chat, render and send.
// The bot decides and executes nothing: a notice that does not validate is dropped and counted.
import { checkPersonalDiff, checkTradeDiff, withheldCount, type CheckedDiff } from "../domain/diffs";
import { accountsOf, isDocumentReason, Notice, NoticeId, type NoticeKind } from "../domain/notice";
import type { Message } from "../domain/message";
import { MemoryNotifyState } from "./memory-state";
import { route } from "./routing";
import {
  RetryableSendError,
  type ChatId,
  type Clock,
  type Logger,
  type MessageSender,
  type NotifyState,
  type RecipientDirectory,
  type RecipientLookup,
  type Renderer,
} from "./ports";

// Chain and engine notices an attacker cannot repeat at will: they always go out.
// Everything else counts toward the cap, including what is born from an email or a document
// (account_change_attempt among them: an attacker can send hundreds).
// The kind is not enough for operation_held: the engine holds a deposit, and an uploader can
// make ingest hold a document as often as it uploads. So the source decides: whatever comes
// from a document or an email (the ingest route says so) counts toward the cap, whatever its kind.
const UNCAPPED: ReadonlySet<NoticeKind> = new Set<NoticeKind>([
  "operation_held",
  "transfer_blocked",
  "unauthorized_execution",
  "agent_revoked",
  "gate_paused",
  "payment_held",
]);

// Where a notice was born. The route that receives it says so; it is never read from the notice.
// "document": ingest read an email or a document (an uploader can repeat it). "engine": the
// agent, the engine or the chain, which an attacker cannot repeat at will.
export type NoticeOrigin = "document" | "engine";

export interface NotifyOptions {
  maxMessagesPerChatPerHour: number;
}

// retry: chats whose send failed with a RetryableSendError. Their claim was given back, so the
// same notice delivered again reaches them (and only them).
export type NotifyResult =
  | { status: "rejected" }
  | { status: "duplicate" }
  | { status: "accepted"; sent: number; retry?: number };

export interface NotifyStats {
  received: number;
  rejected: number;
  duplicates: number;
  sent: number;
  sendFailed: number;
  rateLimited: number;
  noChats: number;
  diffValuesWithheld: number;
}

// Deduplication, document holds and the per-chat cap live in a NotifyState: process memory by
// default (the local bot), a store in the cloud, where each invocation starts empty.
export class NotifyService {
  private readonly state: NotifyState;
  private readonly counters: NotifyStats = {
    received: 0,
    rejected: 0,
    duplicates: 0,
    sent: 0,
    sendFailed: 0,
    rateLimited: 0,
    noChats: 0,
    diffValuesWithheld: 0,
  };

  constructor(
    private readonly deps: {
      directory: RecipientDirectory | RecipientLookup;
      renderer: Renderer;
      sender: MessageSender;
      clock: Clock;
      logger: Logger;
      state?: NotifyState;
    },
    private readonly options: NotifyOptions,
  ) {
    this.state = deps.state ?? new MemoryNotifyState();
  }

  stats(): NotifyStats {
    return { ...this.counters };
  }

  async notify(input: unknown, origin: NoticeOrigin = "engine"): Promise<NotifyResult> {
    const { directory, renderer, sender, clock, logger } = this.deps;
    this.counters.received++;

    const parsed = Notice.safeParse(input);
    if (!parsed.success) {
      this.counters.rejected++;
      logger.log({
        event: "rejected",
        noticeId: idOf(input),
        issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), code: i.code })),
      });
      return { status: "rejected" };
    }
    const notice = parsed.data;

    // Every account is resolved before rendering: the templates read names synchronously.
    const names = new Map<string, string>();
    for (const accountId of accountsOf(notice)) {
      const name = await directory.name(accountId);
      if (name === undefined) {
        this.counters.rejected++;
        logger.log({ event: "unknown_account", noticeId: notice.id, kind: notice.kind });
        return { status: "rejected" };
      }
      names.set(accountId, name);
    }

    // A repeat still walks the chats: each one is claimed at most once, so a repeat reaches only
    // the chats a retryable failure left pending, and none at all otherwise.
    const first = await this.state.firstSeen(notice.id);
    if (!first) {
      this.counters.duplicates++;
      logger.log({ event: "duplicate", noticeId: notice.id, kind: notice.kind });
    }

    if (first) {
      const checked: CheckedDiff[] =
        notice.kind === "operation_held"
          ? (notice.diffs ?? []).map((d) => checkTradeDiff(d, notice.currency))
          : notice.kind === "invoice_needs_cosign"
            ? notice.diffs.map(checkPersonalDiff)
            : [];
      const withheld = withheldCount(checked);
      if (withheld > 0) {
        this.counters.diffValuesWithheld += withheld;
        const fields = checked.filter((c) => c.display === "field_only" && !c.valid).map((c) => c.field);
        logger.log({ event: "diff_withheld", noticeId: notice.id, kind: notice.kind, fields });
      }
    }

    const now = clock.now();
    const ctx = { now, name: (a: string) => names.get(a) ?? a };
    const reached = new Set<ChatId>();
    const holdsBefore = first ? await this.markDocumentHold(notice) : new Set<string>();
    const capped = origin === "document" || !UNCAPPED.has(notice.kind);
    let sent = 0;
    let retry = 0;

    for (const recipient of route(notice)) {
      const chats = await directory.chats(recipient.accountId, recipient.role);
      if (chats.length === 0) {
        if (first) {
          this.counters.noChats++;
          logger.log({ event: "no_chats", noticeId: notice.id, kind: notice.kind, recipient });
        }
        continue;
      }
      // Rendered once per recipient, when a chat needs it. A chat registered under two roles gets
      // the first one only.
      let message: Message | undefined;
      for (const chatId of chats) {
        if (reached.has(chatId)) continue;
        reached.add(chatId);
        if (!(await this.state.claim(notice.id, chatId))) continue;

        // From here the claim is a lease. Whatever is not final gives it back, so the redelivery
        // reaches this chat; a crash before confirm() frees it when the lease ends.
        let admitted = false;
        try {
          if (capped) {
            const admission = await this.state.admit(chatId, now, this.options.maxMessagesPerChatPerHour);
            if (admission !== "admitted") {
              this.counters.rateLimited++;
              logger.log({ event: "rate_limited", noticeId: notice.id, kind: notice.kind, chatId });
              if (admission === "over_cap_first") await this.sendOverflow(chatId);
              await this.state.confirm(notice.id, chatId);
              continue;
            }
            admitted = true;
          }
          message ??= renderer.render(notice, recipient, { ...ctx, repeatDocumentHold: holdsBefore.has(recipient.side ?? "") });
        } catch (err) {
          // The store or the template failed before anything was sent: not final
          await this.giveBack(notice.id, chatId, now, admitted);
          throw err;
        }
        try {
          await sender.send(chatId, message);
          this.counters.sent++;
          sent++;
          logger.log({ event: "sent", noticeId: notice.id, kind: notice.kind, chatId, recipient });
        } catch (err) {
          this.counters.sendFailed++;
          const again = err instanceof RetryableSendError;
          if (again) {
            await this.giveBack(notice.id, chatId, now, admitted);
            retry++;
          } else {
            await this.state.confirm(notice.id, chatId);
          }
          logger.log({ event: "send_failed", noticeId: notice.id, kind: notice.kind, chatId, error: errorName(err), ...(again ? { retry: true } : {}) });
          continue;
        }
        await this.state.confirm(notice.id, chatId);
      }
    }
    if (!first && sent === 0 && retry === 0) return { status: "duplicate" };
    return { status: "accepted", sent, ...(retry > 0 ? { retry } : {}) };
  }

  // Frees a chat for the redelivery: the claim goes back and so does the cap slot, so retries do
  // not eat the hourly cap. Best effort: if the store fails here, the lease ends by itself.
  private async giveBack(noticeId: string, chatId: ChatId, now: number, admitted: boolean): Promise<void> {
    try {
      await this.state.release(noticeId, chatId);
    } catch {
      // The lease expires on its own
    }
    try {
      if (admitted) await this.state.refund(chatId, now);
    } catch {
      // One slot of the cap stays used until the hour ends
    }
  }

  // Sides of the order that had a document hold before this notice; records this one.
  private async markDocumentHold(notice: Notice): Promise<ReadonlySet<string>> {
    const before = new Set<string>();
    if (notice.kind !== "operation_held" || !isDocumentReason(notice.reason)) return before;
    for (const side of ["importer", "exporter"]) {
      if (await this.state.documentHold(notice.orderRef, side)) before.add(side);
    }
    return before;
  }

  // The single fixed message for a chat over its cap. NotifyState says when it is the first one.
  private async sendOverflow(chatId: ChatId): Promise<void> {
    try {
      await this.deps.sender.send(chatId, this.deps.renderer.overflow());
      this.deps.logger.log({ event: "overflow_sent", chatId });
    } catch (err) {
      this.counters.sendFailed++;
      this.deps.logger.log({ event: "send_failed", noticeId: "overflow", kind: "overflow", chatId, error: errorName(err) });
    }
  }
}

// The id of a rejected notice is logged only if it is a well formed id.
function idOf(input: unknown): string | undefined {
  if (typeof input !== "object" || input === null || !("id" in input)) return undefined;
  const id = NoticeId.safeParse((input as { id: unknown }).id);
  return id.success ? id.data : undefined;
}

// Error class name only: a message could echo a payload.
const errorName = (err: unknown): string => (err instanceof Error ? err.name : "unknown");
