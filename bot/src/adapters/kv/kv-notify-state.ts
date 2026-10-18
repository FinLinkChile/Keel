// NotifyState over the key-value port, for the cloud: each invocation starts empty, so what
// NotifyService must remember between notices lives in the store. Every write that decides
// something is conditional, so two invocations handling the same notice at once still send it to
// each chat once.
//
// The hourly cap here is an aligned clock hour per chat (12:00 to 13:00), not the window opened by
// the first capped message that the in-memory state uses: an atomic counter needs a fixed key.
import type { Admission, ChatId, NotifyState } from "../../application/ports";
import { keys, nowSeconds, type KeyValueStore } from "./store";

const HOUR_MS = 3_600_000;
const DAY_S = 24 * 60 * 60;
// Long enough to cover any redelivery or producer retry of the same notice
export const NOTICE_TTL_SECONDS = 30 * DAY_S;
// A claim is a lease until the send is over: longer than the notify Lambda's timeout (60 s), so
// a live invocation never loses it, short enough that a crashed one frees the chat soon.
export const CLAIM_LEASE_SECONDS = 5 * 60;
// A document hold is "the second one" for the life of an order
export const HOLD_TTL_SECONDS = 365 * DAY_S;

export class KvNotifyState implements NotifyState {
  constructor(
    private readonly kv: KeyValueStore,
    // Unix ms
    private readonly now: () => number,
  ) {}

  private ttl(seconds: number): number {
    return nowSeconds(this.now()) + seconds;
  }

  firstSeen(noticeId: string): Promise<boolean> {
    return this.kv.put(keys.notice(noticeId), keys.seen, {}, { ifAbsent: true, ttl: this.ttl(NOTICE_TTL_SECONDS) });
  }

  claim(noticeId: string, chatId: ChatId): Promise<boolean> {
    return this.kv.put(keys.notice(noticeId), keys.claim(chatId), {}, { ifAbsent: true, ttl: this.ttl(CLAIM_LEASE_SECONDS) });
  }

  async confirm(noticeId: string, chatId: ChatId): Promise<void> {
    await this.kv.put(keys.notice(noticeId), keys.claim(chatId), {}, { ttl: this.ttl(NOTICE_TTL_SECONDS) });
  }

  async refund(chatId: ChatId, now: number): Promise<void> {
    await this.kv.decrement(keys.window(chatId), keys.hour(Math.floor(now / HOUR_MS) * HOUR_MS), "count");
  }

  release(noticeId: string, chatId: ChatId): Promise<void> {
    return this.kv.delete(keys.notice(noticeId), keys.claim(chatId));
  }

  async documentHold(orderRef: string, side: string): Promise<boolean> {
    const first = await this.kv.put(keys.order(orderRef), keys.hold(side), {}, { ifAbsent: true, ttl: this.ttl(HOLD_TTL_SECONDS) });
    return !first;
  }

  async admit(chatId: ChatId, now: number, max: number): Promise<Admission> {
    const hourStart = Math.floor(now / HOUR_MS) * HOUR_MS;
    const pk = keys.window(chatId);
    const sk = keys.hour(hourStart);
    // Kept one hour past its end, then DynamoDB may drop it
    const ttl = nowSeconds(hourStart + 2 * HOUR_MS);
    if ((await this.kv.increment(pk, sk, "count", max, ttl)) !== undefined) return "admitted";
    return (await this.kv.setOnce(pk, sk, "overflowSent", ttl)) ? "over_cap_first" : "over_cap";
  }
}
