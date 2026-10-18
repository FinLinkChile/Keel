// KeyValueStore in memory, with the same expiry rule as the DynamoDB one. For tests of the bot and
// of the AWS handlers.
import type { KeyValueStore, KvItem } from "./store";

export class MemoryKeyValueStore implements KeyValueStore {
  private readonly items = new Map<string, KvItem>();

  // Unix ms, so a test can move time
  constructor(private readonly now: () => number = () => Date.now()) {}

  private live(pk: string, sk: string): KvItem | undefined {
    const item = this.items.get(`${pk}\n${sk}`);
    if (!item) return undefined;
    if (typeof item.ttl === "number" && item.ttl <= Math.floor(this.now() / 1000)) return undefined;
    return item;
  }

  async get(pk: string, sk: string) {
    const item = this.live(pk, sk);
    return item ? { ...item } : undefined;
  }

  async query(pk: string, skPrefix: string) {
    const out: KvItem[] = [];
    for (const [key, item] of this.items) {
      const [p, s] = key.split("\n") as [string, string];
      if (p === pk && s.startsWith(skPrefix) && this.live(p, s)) out.push({ ...item });
    }
    return out;
  }

  async put(pk: string, sk: string, item: KvItem, opts: { ifAbsent?: boolean; ttl?: number } = {}) {
    if (opts.ifAbsent && this.live(pk, sk)) return false;
    this.items.set(`${pk}\n${sk}`, { ...item, pk, sk, ...(opts.ttl !== undefined ? { ttl: opts.ttl } : {}) });
    return true;
  }

  async delete(pk: string, sk: string) {
    this.items.delete(`${pk}\n${sk}`);
  }

  async increment(pk: string, sk: string, attr: string, max: number, ttl: number) {
    const item = this.live(pk, sk) ?? { pk, sk, ttl };
    const count = typeof item[attr] === "number" ? (item[attr] as number) : 0;
    if (count >= max) return undefined;
    this.items.set(`${pk}\n${sk}`, { ...item, [attr]: count + 1 });
    return count + 1;
  }

  async decrement(pk: string, sk: string, attr: string) {
    const item = this.live(pk, sk);
    if (!item || typeof item[attr] !== "number" || (item[attr] as number) <= 0) return;
    this.items.set(`${pk}\n${sk}`, { ...item, [attr]: (item[attr] as number) - 1 });
  }

  async setOnce(pk: string, sk: string, attr: string, ttl: number) {
    const item = this.live(pk, sk) ?? { pk, sk, ttl };
    if (item[attr] === true) return false;
    this.items.set(`${pk}\n${sk}`, { ...item, [attr]: true });
    return true;
  }

  // For tests: how many items are stored, expired or not
  get size(): number {
    return this.items.size;
  }
}
