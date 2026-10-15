// Recipient directory loaded from BOT_RECIPIENTS_FILE. Names come from onboarding and live here,
// so a notice never carries free text. Fails at startup if the file does not validate, if a
// personal account has an operator or if a chat is not in TELEGRAM_ALLOWED_CHAT_IDS.
import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { ChatId, RecipientDirectory } from "../../application/ports";
import { AccountId, ROLES, ROLES_BY_KIND, type AccountKind, type Role } from "../../domain/recipients";
import { ConfigError } from "./env";

// Shown in messages, so held to letters, digits and plain punctuation.
const Name = z.string().regex(/^[\p{L}\p{N}][\p{L}\p{N} .,&'-]{0,59}$/u);
const Chats = z.array(z.number().int().safe()).max(20);

const DirectoryFile = z.strictObject({
  accounts: z.record(
    AccountId,
    z.strictObject({
      kind: z.enum(["company", "personal"]),
      name: Name,
      roles: z.strictObject({ owner: Chats.optional(), operator: Chats.optional(), cosigner: Chats.optional() }),
    }),
  ),
});

interface Account {
  kind: AccountKind;
  name: string;
  roles: Partial<Record<Role, readonly ChatId[]>>;
}

export class FileDirectory implements RecipientDirectory {
  constructor(private readonly accounts: ReadonlyMap<string, Account>) {}

  name(accountId: string): string | undefined {
    return this.accounts.get(accountId)?.name;
  }

  chats(accountId: string, role: Role): readonly ChatId[] {
    return this.accounts.get(accountId)?.roles[role] ?? [];
  }

  // "Acme Imports (owner)" for console output. A chat may hold several roles.
  describe(chatId: ChatId): string {
    const holders: string[] = [];
    for (const a of this.accounts.values()) {
      for (const role of ROLES) if (a.roles[role]?.includes(chatId)) holders.push(`${a.name} (${role})`);
    }
    return holders.join(", ") || "unregistered chat";
  }
}

export function parseDirectory(json: unknown, allowed: ReadonlySet<ChatId>): FileDirectory {
  const parsed = DirectoryFile.safeParse(json);
  if (!parsed.success) {
    const paths = parsed.error.issues.map((i) => i.path.join(".") || "(root)");
    throw new ConfigError(`BOT_RECIPIENTS_FILE does not validate at: ${[...new Set(paths)].join(", ")}`);
  }
  const accounts = new Map<string, Account>();
  for (const [id, a] of Object.entries(parsed.data.accounts)) {
    for (const role of ROLES) {
      const chats = a.roles[role];
      if (!chats) continue;
      if (!ROLES_BY_KIND[a.kind].includes(role)) throw new ConfigError(`account ${id}: a ${a.kind} account has no ${role}`);
      for (const chat of chats) {
        if (!allowed.has(chat)) throw new ConfigError(`account ${id}: chat ${chat} is not in TELEGRAM_ALLOWED_CHAT_IDS`);
      }
    }
    accounts.set(id, a);
  }
  return new FileDirectory(accounts);
}

export async function loadDirectory(file: string, allowed: ReadonlySet<ChatId>): Promise<FileDirectory> {
  let json: unknown;
  try {
    json = JSON.parse(await readFile(file, "utf8"));
  } catch (err) {
    throw new ConfigError(`cannot read BOT_RECIPIENTS_FILE: ${err instanceof Error ? err.name : "error"}`);
  }
  return parseDirectory(json, allowed);
}
