// Composition: the only place that joins ports and adapters, according to the environment.
//   npm run start -w bot    POST /notices (if BOT_INBOUND_TOKEN is set) and /start, /status
//   npm run notify -w bot   one file of notices, see cli.ts
import { Bot } from "grammy";
import { NotifyService } from "./application/notify";
import type { LogEntry, MessageSender } from "./application/ports";
import { loadConfig, type BotConfig } from "./adapters/config/env";
import { loadDirectory, type FileDirectory } from "./adapters/config/recipients-file";
import { createNoticeHandler, startNoticeServer } from "./adapters/inbound/http-source";
import { ConsoleSender } from "./adapters/outbound/console-sender";
import { TelegramSender } from "./adapters/outbound/telegram-sender";
import { installCommands } from "./adapters/telegram/commands";
import { templateRenderer } from "./presentation/templates";

// Activity log as JSON lines on stderr, so console output of messages stays on stdout.
export const logJson = (entry: LogEntry | object) => console.error(JSON.stringify({ at: new Date().toISOString(), ...entry }));

export interface Composition {
  config: BotConfig;
  directory: FileDirectory;
  service: NotifyService;
}

export async function compose(env: Record<string, string | undefined> = process.env): Promise<Composition> {
  const config = loadConfig(env);
  const directory = await loadDirectory(config.recipientsFile, config.allowedChatIds);
  const sender: MessageSender =
    config.sender === "telegram"
      ? TelegramSender.fromToken(config.telegramToken!, config.appBaseUrl)
      : new ConsoleSender(config.appBaseUrl, (chatId) => directory.describe(chatId));
  const service = new NotifyService(
    { directory, renderer: templateRenderer, sender, clock: { now: () => Date.now() }, logger: { log: logJson } },
    { maxMessagesPerChatPerHour: config.maxMessagesPerChatPerHour },
  );
  return { config, directory, service };
}

export async function main(env: Record<string, string | undefined> = process.env): Promise<void> {
  const { config, service } = await compose(env);

  if (config.inboundToken) {
    await startNoticeServer(createNoticeHandler(config.inboundToken, service), config.host, config.port);
    logJson({ event: "listening", url: `http://${config.host}:${config.port}/notices` });
  } else {
    logJson({ event: "inbound_disabled", reason: "BOT_INBOUND_TOKEN is not set" });
  }

  if (config.sender === "telegram") {
    const bot = new Bot(config.telegramToken!);
    installCommands(bot, config.allowedChatIds, logJson);
    bot.catch((err) => logJson({ event: "telegram_error", error: err.error instanceof Error ? err.error.name : "unknown" }));
    void bot.start({ allowed_updates: ["message"] });
    logJson({ event: "telegram_polling" });
  }
}
