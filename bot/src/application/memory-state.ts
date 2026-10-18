// NotifyState in process memory: what the local bot uses. It is lost on restart, which is fine for
// a long-running process; the cloud uses a store instead (adapters/kv/kv-notify-state.ts).
import type { Admission, ChatId, NotifyState } from "./ports";

const HOUR_MS = 3_600_000;

interface Window {
  start: number;
  count: number;
  overflowSent: boolean;
}

export class MemoryNotifyState implements NotifyState {
  private readonly seen = new Set<string>();
  private readonly claims = new Set<string>();
  // "orderRef:side" that already got a document hold
  private readonly documentHolds = new Set<string>();
  private readonly windows = new Map<ChatId, Window>();

  async firstSeen(noticeId: string): Promise<boolean> {
    if (this.seen.has(noticeId)) return false;
    this.seen.add(noticeId);
    return true;
  }

  async claim(noticeId: string, chatId: ChatId): Promise<boolean> {
    const key = `${noticeId}\n${chatId}`;
    if (this.claims.has(key)) return false;
    this.claims.add(key);
    return true;
  }

  async release(noticeId: string, chatId: ChatId): Promise<void> {
    this.claims.delete(`${noticeId}\n${chatId}`);
  }

  async documentHold(orderRef: string, side: string): Promise<boolean> {
    const key = `${orderRef}:${side}`;
    const before = this.documentHolds.has(key);
    this.documentHolds.add(key);
    return before;
  }

  // Fixed window per chat, starting at its first capped message.
  async admit(chatId: ChatId, now: number, max: number): Promise<Admission> {
    let w = this.windows.get(chatId);
    if (!w || now - w.start >= HOUR_MS) {
      w = { start: now, count: 0, overflowSent: false };
      this.windows.set(chatId, w);
    }
    if (w.count < max) {
      w.count++;
      return "admitted";
    }
    if (w.overflowSent) return "over_cap";
    w.overflowSent = true;
    return "over_cap_first";
  }
}
