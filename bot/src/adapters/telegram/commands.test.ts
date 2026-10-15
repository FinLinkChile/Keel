import { Bot } from "grammy";
import type { Update, UserFromGetMe } from "grammy/types";
import { describe, expect, it } from "vitest";
import { installCommands, START_TEXT, STATUS_TEXT } from "./commands";

const botInfo: UserFromGetMe = {
  id: 42,
  is_bot: true,
  first_name: "Keel",
  username: "keel_test_bot",
  can_join_groups: false,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
} as UserFromGetMe;

function setup(allowed: number[]) {
  const bot = new Bot("123:fake", { botInfo });
  const replies: { chatId: unknown; text: unknown }[] = [];
  bot.api.config.use(async (_prev, method, payload) => {
    const p = payload as { chat_id?: unknown; text?: unknown };
    if (method === "sendMessage") replies.push({ chatId: p.chat_id, text: p.text });
    return { ok: true, result: true } as never;
  });
  const ignored: unknown[] = [];
  installCommands(bot, new Set(allowed), (e) => ignored.push(e));
  return { bot, replies, ignored };
}

const command = (chatId: number, text: string, updateId = 1): Update => ({
  update_id: updateId,
  message: {
    message_id: 1,
    date: 0,
    chat: { id: chatId, type: "private", first_name: "x" },
    from: { id: chatId, is_bot: false, first_name: "x" },
    text,
    entities: [{ type: "bot_command", offset: 0, length: text.length }],
  },
});

describe("commands", () => {
  it("answers /start and /status with fixed texts to a registered chat", async () => {
    const { bot, replies } = setup([111]);
    await bot.handleUpdate(command(111, "/start"));
    await bot.handleUpdate(command(111, "/status"));
    expect(replies).toEqual([
      { chatId: 111, text: START_TEXT },
      { chatId: 111, text: STATUS_TEXT },
    ]);
  });

  it("does not answer an unregistered chat, and logs it", async () => {
    const { bot, replies, ignored } = setup([111]);
    await bot.handleUpdate(command(999, "/start", 7));
    expect(replies).toHaveLength(0);
    expect(ignored).toEqual([{ event: "ignored_chat", chatId: 999, updateId: 7 }]);
  });

  it("ignores anything that is not a command", async () => {
    const { bot, replies } = setup([111]);
    await bot.handleUpdate({ ...command(111, "pay 0xabc now"), message: { ...command(111, "x").message!, text: "pay 0xabc now", entities: [] } });
    expect(replies).toHaveLength(0);
  });
});
