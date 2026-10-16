// The only things the bot answers: /start and /status, with fixed texts, and only to chats in
// TELEGRAM_ALLOWED_CHAT_IDS. Any other chat is ignored and logged. No command reads wallet
// data or acts: the bot signs nothing and moves no funds.
import { Bot, type Context, type MiddlewareFn } from "grammy";

export const START_TEXT =
  "This is Keel. This chat gets alerts about your payments and orders: deposits, payments, held operations and deadlines. " +
  "This bot never signs and never moves funds. To approve or change anything, open the Keel app. " +
  "It will never ask you for a key, a password or a payment.";

export const STATUS_TEXT = "This chat is registered for Keel alerts. The bot is running. It never signs and never moves funds.";

export type IgnoredLog = (entry: { event: "ignored_chat"; chatId?: number; updateId: number }) => void;

export function allowlist(allowed: ReadonlySet<number>, log: IgnoredLog): MiddlewareFn<Context> {
  return async (ctx, next) => {
    const chatId = ctx.chat?.id;
    if (chatId !== undefined && allowed.has(chatId)) return next();
    log({ event: "ignored_chat", chatId, updateId: ctx.update.update_id });
  };
}

export function installCommands(bot: Bot, allowed: ReadonlySet<number>, log: IgnoredLog): void {
  bot.use(allowlist(allowed, log));
  bot.command("start", (ctx) => ctx.reply(START_TEXT));
  bot.command("status", (ctx) => ctx.reply(STATUS_TEXT));
}
