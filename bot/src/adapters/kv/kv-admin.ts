// The cloud's recipient directory and order book, edited by an operator instead of files: the
// operator route (aws/src/handlers/botAdmin.ts) reads and changes them with this. The bot in the
// cloud only sends and receives nothing from Telegram, so chats are not linked from a chat: the
// operator writes each chat id, as the local recipients file does.
//
// The change has the shape of the two local files, and every entry is checked with the same rules:
//   { "accounts": { "<accountId>": { kind, name, roles: { owner?, operator?, cosigner? } } | null },
//     "orders":   { "<bytes32 orderId>": { label, importer, exporter, arbiter?, shipmentDeadline } | null } }
// An account listed replaces that account whole (name, kind and every chat); null removes it. The
// same for an order. What is not listed stays as it is. Every change that changes something
// leaves an audit item with the actor, the time and each entry before and after.
//
// Not atomic across entries: a store failure halfway leaves the entries written so far. The
// operator sends the same change again, which is idempotent.
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { Parties } from "../../domain/notice";
import { AccountId, ROLES, ROLES_BY_KIND, type Role } from "../../domain/recipients";
import { OrderFileEntry, OrderId } from "../config/orders-file";
import { AccountEntry } from "../config/recipients-file";
import { AccountMeta, ChatItem, withoutKeys } from "./kv-directory";
import { keys, type KeyValueStore } from "./store";

const MAX_ACCOUNTS = 200;
const MAX_ORDERS = 500;

export const RecipientsChange = z.strictObject({
  accounts: z.record(AccountId, AccountEntry.nullable()).optional(),
  orders: z.record(OrderId, OrderFileEntry.nullable()).optional(),
});
export type RecipientsChange = z.infer<typeof RecipientsChange>;

export interface RecipientsView {
  accounts: Record<string, AccountEntry>;
  orders: Record<string, OrderFileEntry>;
}

export interface RecipientsAudit {
  type: "recipients_changed";
  at: string;
  actor: string;
  changes: {
    accounts?: Record<string, { from: AccountEntry | null; to: AccountEntry | null }>;
    orders?: Record<string, { from: OrderFileEntry | null; to: OrderFileEntry | null }>;
  };
}

// A change the rules reject. `message` names entries and rules only, never a value.
export class RecipientsError extends Error {
  override name = "RecipientsError";
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// The form view() reads back: roles in table order, chats sorted and unique, no empty role
function normalize(a: AccountEntry): AccountEntry {
  const roles: AccountEntry["roles"] = {};
  for (const role of ROLES) {
    const chats = [...new Set(a.roles[role] ?? [])].sort((x, y) => x - y);
    if (chats.length > 0) roles[role] = chats;
  }
  return { kind: a.kind, name: a.name, roles };
}

export class RecipientsAdmin {
  constructor(
    private readonly kv: KeyValueStore,
    // Unix ms
    private readonly now: () => number = () => Date.now(),
  ) {}

  async account(accountId: string): Promise<AccountEntry | null> {
    const meta = AccountMeta.safeParse(await this.kv.get(keys.account(accountId), keys.meta));
    if (!meta.success) return null;
    const roles: Partial<Record<Role, number[]>> = {};
    for (const item of await this.kv.query(keys.account(accountId), keys.chatsAll)) {
      const role = String(item.sk ?? "").split("#")[1] as Role;
      const chat = ChatItem.safeParse(item);
      if (!ROLES.includes(role) || !chat.success) continue;
      (roles[role] ??= []).push(chat.data.chatId);
    }
    return normalize({ kind: meta.data.kind, name: meta.data.name, roles });
  }

  async order(orderId: string): Promise<OrderFileEntry | null> {
    const parsed = OrderFileEntry.safeParse(withoutKeys(await this.kv.get(keys.order(orderId), keys.meta)));
    return parsed.success ? parsed.data : null;
  }

  async view(): Promise<RecipientsView> {
    const view: RecipientsView = { accounts: {}, orders: {} };
    for (const item of await this.kv.query(keys.index, "")) {
      const [type, id] = String(item.sk ?? "").split("#") as [string, string];
      if (type === "account") {
        const a = await this.account(id);
        if (a) view.accounts[id] = a;
      } else if (type === "order") {
        const o = await this.order(id);
        if (o) view.orders[id] = o;
      }
    }
    return view;
  }

  // Validates the whole change before writing anything. Throws RecipientsError if a rule fails.
  async apply(input: unknown, actor: string): Promise<RecipientsAudit | null> {
    const parsed = RecipientsChange.safeParse(input);
    if (!parsed.success) {
      const paths = [...new Set(parsed.error.issues.map((i) => i.path.join(".") || "(root)"))];
      throw new RecipientsError(`does not validate at: ${paths.slice(0, 10).join(", ")}`);
    }
    const accounts = Object.entries(parsed.data.accounts ?? {}).map(([id, a]) => [id, a && normalize(a)] as const);
    const orders = Object.entries(parsed.data.orders ?? {}).map(([id, o]) => [id.toLowerCase(), o] as const);
    if (accounts.length === 0 && orders.length === 0) throw new RecipientsError("nothing to change");
    if (accounts.length > MAX_ACCOUNTS || orders.length > MAX_ORDERS) throw new RecipientsError("too many entries in one change");

    for (const [id, a] of accounts) {
      if (!a) continue;
      for (const role of ROLES) {
        if (a.roles[role] && !ROLES_BY_KIND[a.kind].includes(role)) throw new RecipientsError(`account ${id}: a ${a.kind} account has no ${role}`);
      }
    }
    const listed = new Map(accounts);
    const exists = async (accountId: string) => {
      if (listed.has(accountId)) return listed.get(accountId) !== null;
      return (await this.account(accountId)) !== null;
    };
    const labels = new Set<string>();
    for (const [id, o] of orders) {
      if (!o) continue;
      if (labels.has(o.label)) throw new RecipientsError(`order ${id}: the label appears twice`);
      labels.add(o.label);
      if (!Parties.safeParse({ importer: o.importer, exporter: o.exporter, arbiter: o.arbiter }).success) {
        throw new RecipientsError(`order ${id}: parties must be valid, different account ids`);
      }
      for (const account of [o.importer, o.exporter, ...(o.arbiter ? [o.arbiter] : [])]) {
        if (!(await exists(account))) throw new RecipientsError(`order ${id}: account ${account} is not in the directory`);
      }
    }

    const changes: RecipientsAudit["changes"] = {};
    for (const [id, to] of accounts) {
      const from = await this.account(id);
      if (same(from, to)) continue;
      await this.writeAccount(id, to);
      (changes.accounts ??= {})[id] = { from, to };
    }
    for (const [id, to] of orders) {
      const from = await this.order(id);
      if (same(from, to)) continue;
      await this.writeOrder(id, to);
      (changes.orders ??= {})[id] = { from, to };
    }
    if (!changes.accounts && !changes.orders) return null;

    const at = new Date(this.now()).toISOString();
    const audit: RecipientsAudit = { type: "recipients_changed", at, actor, changes };
    await this.kv.put(keys.audit, `${at}#${randomBytes(4).toString("hex")}`, { ...audit });
    return audit;
  }

  private async writeAccount(id: string, to: AccountEntry | null): Promise<void> {
    const pk = keys.account(id);
    const wanted = new Set(to ? ROLES.flatMap((role) => (to.roles[role] ?? []).map((chatId) => keys.chat(role, chatId))) : []);
    for (const item of await this.kv.query(pk, keys.chatsAll)) {
      const sk = String(item.sk);
      if (!wanted.has(sk)) await this.kv.delete(pk, sk);
    }
    if (!to) {
      await this.kv.delete(pk, keys.meta);
      await this.kv.delete(keys.index, keys.indexAccount(id));
      return;
    }
    await this.kv.put(pk, keys.meta, { name: to.name, kind: to.kind });
    for (const role of ROLES) {
      for (const chatId of to.roles[role] ?? []) await this.kv.put(pk, keys.chat(role, chatId), { chatId });
    }
    await this.kv.put(keys.index, keys.indexAccount(id), {});
  }

  private async writeOrder(id: string, to: OrderFileEntry | null): Promise<void> {
    if (!to) {
      await this.kv.delete(keys.order(id), keys.meta);
      await this.kv.delete(keys.index, keys.indexOrder(id));
      return;
    }
    await this.kv.put(keys.order(id), keys.meta, { ...to });
    await this.kv.put(keys.index, keys.indexOrder(id), {});
  }
}
