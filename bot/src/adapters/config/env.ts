// Bot configuration, read once at startup and validated with zod. Fails closed: a missing or
// malformed variable stops the bot before it sends anything.
import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { AccountId } from "../../domain/recipients";

export class ConfigError extends Error {
  override name = "ConfigError";
}

const MIN_TOKEN_LENGTH = 32;

// `VAR=` in a .env file means unset.
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), schema.optional());

// Comma separated, group chats are negative.
const ChatIds = z
  .string()
  .transform((s) => s.split(",").map((x) => x.trim()).filter(Boolean))
  .pipe(z.array(z.string().regex(/^-?[0-9]{1,20}$/).transform(Number)).min(1));

const Env = z.object({
  BOT_SENDER: optional(z.enum(["telegram", "console"])).default("console"),
  TELEGRAM_BOT_TOKEN: optional(z.string().regex(/^[0-9]+:[A-Za-z0-9_-]+$/)),
  TELEGRAM_ALLOWED_CHAT_IDS: ChatIds,
  BOT_RECIPIENTS_FILE: z.string().min(1),
  BOT_ORDERS_FILE: optional(z.string().min(1)),
  APP_BASE_URL: optional(z.url({ protocol: /^https?$/ })),
  BOT_INBOUND_TOKEN: optional(z.string().min(MIN_TOKEN_LENGTH)),
  BOT_INGEST_TOKEN: optional(z.string().min(MIN_TOKEN_LENGTH)),
  BOT_PERSONAL_ACCOUNT_ID: optional(AccountId),
  INGEST_WEBHOOK_TOKEN: optional(z.string()),
  BOT_HOST: optional(z.string()).default("127.0.0.1"),
  BOT_PORT: optional(z.coerce.number().int().min(1).max(65535)).default(8789),
  BOT_MAX_MESSAGES_PER_CHAT_PER_HOUR: optional(z.coerce.number().int().min(1).max(1000)).default(30),
});

export interface BotConfig {
  sender: "telegram" | "console";
  telegramToken?: string;
  allowedChatIds: ReadonlySet<number>;
  recipientsFile: string;
  ordersFile?: string;
  appBaseUrl?: string;
  inboundToken?: string;
  ingestToken?: string;
  personalAccountId?: string;
  host: string;
  port: number;
  maxMessagesPerChatPerHour: number;
}

const digest = (s: string) => createHash("sha256").update(s).digest();

export function loadConfig(env: Record<string, string | undefined>): BotConfig {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    // Variable names only: a value could be a secret.
    const vars = [...new Set(parsed.error.issues.map((i) => String(i.path[0])))];
    throw new ConfigError(`invalid or missing: ${vars.join(", ")}`);
  }
  const e = parsed.data;
  if (e.BOT_SENDER === "telegram" && !e.TELEGRAM_BOT_TOKEN) {
    throw new ConfigError("TELEGRAM_BOT_TOKEN is required when BOT_SENDER=telegram");
  }
  // Each caller has its own token: ingest cannot post bare notices, and the mail forwarder cannot
  // post to the bot at all.
  const same = (a?: string, b?: string) => a !== undefined && b !== undefined && timingSafeEqual(digest(a), digest(b));
  if (same(e.BOT_INBOUND_TOKEN, e.INGEST_WEBHOOK_TOKEN)) throw new ConfigError("BOT_INBOUND_TOKEN must differ from INGEST_WEBHOOK_TOKEN");
  if (same(e.BOT_INGEST_TOKEN, e.INGEST_WEBHOOK_TOKEN)) throw new ConfigError("BOT_INGEST_TOKEN must differ from INGEST_WEBHOOK_TOKEN");
  if (same(e.BOT_INGEST_TOKEN, e.BOT_INBOUND_TOKEN)) throw new ConfigError("BOT_INGEST_TOKEN must differ from BOT_INBOUND_TOKEN");
  return {
    sender: e.BOT_SENDER,
    telegramToken: e.TELEGRAM_BOT_TOKEN,
    allowedChatIds: new Set(e.TELEGRAM_ALLOWED_CHAT_IDS),
    recipientsFile: e.BOT_RECIPIENTS_FILE,
    ordersFile: e.BOT_ORDERS_FILE,
    appBaseUrl: e.APP_BASE_URL?.replace(/\/+$/, ""),
    inboundToken: e.BOT_INBOUND_TOKEN,
    ingestToken: e.BOT_INGEST_TOKEN,
    personalAccountId: e.BOT_PERSONAL_ACCOUNT_ID,
    host: e.BOT_HOST,
    port: e.BOT_PORT,
    maxMessagesPerChatPerHour: e.BOT_MAX_MESSAGES_PER_CHAT_PER_HOUR,
  };
}
