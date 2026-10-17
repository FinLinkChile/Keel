// NotifyService: validate, deduplicate, route, cap per chat, render and send.
// The bot decides and executes nothing: a notice that does not validate is dropped and counted.
import { checkPersonalDiff, checkTradeDiff, withheldCount, type CheckedDiff } from "../domain/diffs";
import { accountsOf, isDocumentReason, Notice, NoticeId, type NoticeKind } from "../domain/notice";
import { route } from "./routing";
import type { ChatId, Clock, Logger, MessageSender, RecipientDirectory, Renderer } from "./ports";

// Chain and engine notices an attacker cannot repeat at will: they always go out.
// Everything else counts toward the cap, including what is born from an email or a document
// (account_change_attempt among them: an attacker can send hundreds).
// The kind is not enough for operation_held: the engine holds a deposit, and an uploader can
// make ingest hold a document as often as it uploads. So the source decides: whatever comes
// from a document or an email (the ingest route says so) counts toward the cap, whatever its kind.
const UNCAPPED: ReadonlySet<NoticeKind> = new Set<NoticeKind>([
  "operation_held",
  "transfer_blocked",
  "agent_revoked",
  "gate_paused",
  "payment_held",
]);

const HOUR_MS = 3_600_000;

// Where a notice was born. The route that receives it says so; it is never read from the notice.
// "document": ingest read an email or a document (an uploader can repeat it). "engine": the
// agent, the engine or the chain, which an attacker cannot repeat at will.
export type NoticeOrigin = "document" | "engine";

export interface NotifyOptions {
  maxMessagesPerChatPerHour: number;
}

export type NotifyResult =
  | { status: "rejected" }
  | { status: "duplicate" }
  | { status: "accepted"; sent: number };

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

interface Window {
  start: number;
  count: number;
  overflowSent: boolean;
}

export class NotifyService {
  private readonly seen = new Set<string>();
  // "orderRef:side" that already got a document hold. In memory, like deduplication.
  private readonly documentHolds = new Set<string>();
  private readonly windows = new Map<ChatId, Window>();
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
      directory: RecipientDirectory;
      renderer: Renderer;
      sender: MessageSender;
      clock: Clock;
      logger: Logger;
    },
    private readonly options: NotifyOptions,
  ) {}

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

    if (accountsOf(notice).some((a) => directory.name(a) === undefined)) {
      this.counters.rejected++;
      logger.log({ event: "unknown_account", noticeId: notice.id, kind: notice.kind });
      return { status: "rejected" };
    }

    if (this.seen.has(notice.id)) {
      this.counters.duplicates++;
      logger.log({ event: "duplicate", noticeId: notice.id, kind: notice.kind });
      return { status: "duplicate" };
    }
    this.seen.add(notice.id);

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

    const now = clock.now();
    const ctx = { now, name: (a: string) => directory.name(a) ?? a };
    const reached = new Set<ChatId>();
    const holdsBefore = this.markDocumentHold(notice);
    let sent = 0;

    for (const recipient of route(notice)) {
      const chats = directory.chats(recipient.accountId, recipient.role);
      if (chats.length === 0) {
        this.counters.noChats++;
        logger.log({ event: "no_chats", noticeId: notice.id, kind: notice.kind, recipient });
        continue;
      }
      // Rendered once per recipient. A chat registered under two roles gets the first one only.
      const message = renderer.render(notice, recipient, { ...ctx, repeatDocumentHold: holdsBefore.has(recipient.side ?? "") });
      for (const chatId of chats) {
        if (reached.has(chatId)) continue;
        reached.add(chatId);

        if ((origin === "document" || !UNCAPPED.has(notice.kind)) && !this.admit(chatId, now)) {
          this.counters.rateLimited++;
          logger.log({ event: "rate_limited", noticeId: notice.id, kind: notice.kind, chatId });
          await this.sendOverflowOnce(chatId);
          continue;
        }
        try {
          await sender.send(chatId, message);
          this.counters.sent++;
          sent++;
          logger.log({ event: "sent", noticeId: notice.id, kind: notice.kind, chatId, recipient });
        } catch (err) {
          this.counters.sendFailed++;
          logger.log({ event: "send_failed", noticeId: notice.id, kind: notice.kind, chatId, error: errorName(err) });
        }
      }
    }
    return { status: "accepted", sent };
  }

  // Sides of the order that had a document hold before this notice; records this one.
  private markDocumentHold(notice: Notice): ReadonlySet<string> {
    const before = new Set<string>();
    if (notice.kind !== "operation_held" || !isDocumentReason(notice.reason)) return before;
    for (const side of ["importer", "exporter"]) {
      const key = `${notice.orderRef}:${side}`;
      if (this.documentHolds.has(key)) before.add(side);
      this.documentHolds.add(key);
    }
    return before;
  }

  // Fixed window per chat, starting at its first capped message.
  private admit(chatId: ChatId, now: number): boolean {
    let w = this.windows.get(chatId);
    if (!w || now - w.start >= HOUR_MS) {
      w = { start: now, count: 0, overflowSent: false };
      this.windows.set(chatId, w);
    }
    if (w.count >= this.options.maxMessagesPerChatPerHour) return false;
    w.count++;
    return true;
  }

  private async sendOverflowOnce(chatId: ChatId): Promise<void> {
    const w = this.windows.get(chatId);
    if (!w || w.overflowSent) return;
    w.overflowSent = true;
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
