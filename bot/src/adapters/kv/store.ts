// A small key-value port for the bot's state in the cloud: items addressed by a partition key and
// a sort key, with an optional expiry. DynamoDB implements it in aws/src/bot/dynamo-kv.ts, so the
// bot never depends on the AWS SDK; MemoryKeyValueStore implements it for tests.
//
// Key layout (one table, pk/sk, TTL attribute `ttl` in Unix seconds):
//   account#<accountId>   meta                       { name, kind }            name shown in messages
//   account#<accountId>   chat#<role>#<chatId>       { chatId }                a chat of a role
//   order#<orderId>       meta                       { label, importer, exporter, arbiter?, shipmentDeadline }
//   order#<orderRef>      hold#<side>                { ttl }                   a document hold was told
//   index                 account#<id> | order#<id>  { }                       what GET /bot/recipients lists
//   audit#recipients      <ISO time>#<nonce>         { actor, at, changes }    every operator change
//   notice#<noticeId>     seen                       { ttl }                   deduplication
//   notice#<noticeId>     chat#<chatId>              { ttl }                   delivery claim
//   chat#<chatId>         hour#<hourStart>           { count, overflowSent, ttl }  hourly cap
//
// Account, chat and order items are written only by the operator route (kv-admin.ts). Withheld
// diff values are never stored: a value that fails its check is dropped when the notice is
// rendered and only the field name is logged, so there is nothing of them to keep.
//
// Expiry is checked on every read: DynamoDB deletes expired items late (up to days), so an item
// past its `ttl` is treated as absent here, never trusted to be gone.

export type KvItem = Record<string, unknown>;

export interface KeyValueStore {
  get(pk: string, sk: string): Promise<KvItem | undefined>;
  // Items of a partition whose sort key starts with `skPrefix`, each with its `sk`
  query(pk: string, skPrefix: string): Promise<KvItem[]>;
  // Writes an item. With ifAbsent, nothing is written and the result is false when a live item
  // already has that key.
  put(pk: string, sk: string, item: KvItem, opts?: { ifAbsent?: boolean; ttl?: number }): Promise<boolean>;
  delete(pk: string, sk: string): Promise<void>;
  // Adds one to a counter unless it already reached `max`. The new value, or undefined at `max`.
  increment(pk: string, sk: string, attr: string, max: number, ttl: number): Promise<number | undefined>;
  // Takes one off a counter that is above zero. Nothing happens at zero or when it is absent.
  decrement(pk: string, sk: string, attr: string): Promise<void>;
  // Sets a flag that was not set: true for the first caller only.
  setOnce(pk: string, sk: string, attr: string, ttl: number): Promise<boolean>;
}

export const keys = {
  account: (accountId: string) => `account#${accountId}`,
  meta: "meta",
  chat: (role: string, chatId: number) => `chat#${role}#${chatId}`,
  chatsOf: (role: string) => `chat#${role}#`,
  order: (orderId: string) => `order#${orderId.toLowerCase()}`,
  hold: (side: string) => `hold#${side}`,
  chatsAll: "chat#",
  index: "index",
  indexAccount: (accountId: string) => `account#${accountId}`,
  indexOrder: (orderId: string) => `order#${orderId.toLowerCase()}`,
  audit: "audit#recipients",
  notice: (noticeId: string) => `notice#${noticeId}`,
  seen: "seen",
  claim: (chatId: number) => `chat#${chatId}`,
  window: (chatId: number) => `chat#${chatId}`,
  hour: (hourStart: number) => `hour#${hourStart}`,
} as const;

export const nowSeconds = (ms: number) => Math.floor(ms / 1000);
