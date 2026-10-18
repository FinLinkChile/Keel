// Recipient directory and order book over the key-value port, for the cloud. Both are written only
// by the operator route (kv-admin.ts, PUT /bot/recipients), never from a notice or a document.
//
// Reads are cached for the life of the instance: build one per invocation, so a batch asks the
// store once per account, and the next invocation sees what the operator changed.
import { z } from "zod";
import type { ChatId, RecipientLookup } from "../../application/ports";
import { Parties } from "../../domain/notice";
import { AccountId, ACCOUNT_KINDS, type Role } from "../../domain/recipients";
import { OrderBook, OrderFileEntry, OrderId, type OrderEntry } from "../config/orders-file";
import { AccountName } from "../config/recipients-file";
import { keys, type KeyValueStore } from "./store";

export const AccountMeta = z.object({ name: AccountName, kind: z.enum(ACCOUNT_KINDS) });
export type AccountMeta = z.infer<typeof AccountMeta>;

export const ChatItem = z.object({ chatId: z.number().int().safe() });

export class KvDirectory implements RecipientLookup {
  private readonly metas = new Map<string, Promise<AccountMeta | undefined>>();
  private readonly chatLists = new Map<string, Promise<readonly ChatId[]>>();

  constructor(private readonly kv: KeyValueStore) {}

  account(accountId: string): Promise<AccountMeta | undefined> {
    let meta = this.metas.get(accountId);
    if (!meta) {
      meta = AccountId.safeParse(accountId).success
        ? this.kv.get(keys.account(accountId), keys.meta).then((item) => {
            const parsed = AccountMeta.safeParse(item);
            return parsed.success ? parsed.data : undefined;
          })
        : Promise.resolve(undefined);
      this.metas.set(accountId, meta);
    }
    return meta;
  }

  async name(accountId: string): Promise<string | undefined> {
    return (await this.account(accountId))?.name;
  }

  chats(accountId: string, role: Role): Promise<readonly ChatId[]> {
    const key = `${accountId}\n${role}`;
    let list = this.chatLists.get(key);
    if (!list) {
      list = AccountId.safeParse(accountId).success
        ? this.kv.query(keys.account(accountId), keys.chatsOf(role)).then((items) =>
            items.flatMap((item) => {
              const parsed = ChatItem.safeParse(item);
              return parsed.success ? [parsed.data.chatId] : [];
            }),
          )
        : Promise.resolve([]);
      this.chatLists.set(key, list);
    }
    return list;
  }
}

export class KvOrders {
  constructor(private readonly kv: KeyValueStore) {}

  async get(orderId: string): Promise<OrderEntry | undefined> {
    if (!OrderId.safeParse(orderId).success) return undefined;
    const meta = OrderFileEntry.safeParse(withoutKeys(await this.kv.get(keys.order(orderId), keys.meta)));
    if (!meta.success) return undefined;
    const parties = Parties.safeParse({ importer: meta.data.importer, exporter: meta.data.exporter, arbiter: meta.data.arbiter });
    if (!parties.success) return undefined;
    return { orderRef: orderId.toLowerCase(), label: meta.data.label, parties: parties.data, shipmentDeadline: meta.data.shipmentDeadline };
  }

  // An order book holding just this order (empty if it is unknown), for the trade mapper
  async book(orderId: string): Promise<OrderBook> {
    const entry = await this.get(orderId);
    return new OrderBook(new Map(entry ? [[entry.orderRef, entry]] : []));
  }
}

// An item without its key and expiry attributes, to parse it with a strict schema
export function withoutKeys(item: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!item) return undefined;
  const { pk: _pk, sk: _sk, ttl: _ttl, ...rest } = item;
  return rest;
}
