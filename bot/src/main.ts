// Composition: the only place that joins ports and adapters, according to the environment.
//   npm run start -w bot    POST /notices (if BOT_INBOUND_TOKEN is set), POST /ingest/outcomes
//                           (if BOT_INGEST_TOKEN is set) and /start, /status
//   npm run notify -w bot   one file of notices, see cli.ts
import { Bot } from "grammy";
import { NotifyService } from "./application/notify";
import type { LogEntry, MessageSender } from "./application/ports";
import { ConfigError, loadConfig, type BotConfig } from "./adapters/config/env";
import { loadOrders, type OrderBook } from "./adapters/config/orders-file";
import { loadDirectory, type FileDirectory } from "./adapters/config/recipients-file";
import { createHttpHandler, startHttpServer } from "./adapters/inbound/http-source";
import { ingestRoute } from "./adapters/inbound/ingest-source";
import { ConsoleSender } from "./adapters/outbound/console-sender";
import { TelegramSender } from "./adapters/outbound/telegram-sender";
import { installCommands } from "./adapters/telegram/commands";
import { templateRenderer } from "./presentation/templates";

// Activity log as JSON lines on stderr, so console output of messages stays on stdout.
export const logJson = (entry: LogEntry | object) => console.error(JSON.stringify({ at: new Date().toISOString(), ...entry }));

export interface Composition {
  config: BotConfig;
  directory: FileDirectory;
  orders?: OrderBook;
  service: NotifyService;
}

export async function compose(env: Record<string, string | undefined> = process.env): Promise<Composition> {
  const config = loadConfig(env);
  const directory = await loadDirectory(config.recipientsFile, config.allowedChatIds);
  const exists = (a: string) => directory.name(a) !== undefined;
  const orders = config.ordersFile ? await loadOrders(config.ordersFile, exists) : undefined;
  if (config.personalAccountId && !exists(config.personalAccountId)) {
    throw new ConfigError("BOT_PERSONAL_ACCOUNT_ID is not in BOT_RECIPIENTS_FILE");
  }
  const sender: MessageSender =
    config.sender === "telegram"
      ? TelegramSender.fromToken(config.telegramToken!, config.appBaseUrl)
      : new ConsoleSender(config.appBaseUrl, (chatId) => directory.describe(chatId));
  const service = new NotifyService(
    { directory, renderer: templateRenderer, sender, clock: { now: () => Date.now() }, logger: { log: logJson } },
    { maxMessagesPerChatPerHour: config.maxMessagesPerChatPerHour },
  );
  return { config, directory, orders, service };
}

export async function main(env: Record<string, string | undefined> = process.env): Promise<void> {
  const { config, orders, service } = await compose(env);

  const handler = createHttpHandler({
    ...(config.inboundToken ? { notices: { token: config.inboundToken, sink: service } } : {}),
    ...(config.ingestToken
      ? {
          ingest: {
            token: config.ingestToken,
            route: ingestRoute({
              sink: service,
              personalAccountId: config.personalAccountId,
              orders,
              now: () => Date.now(),
              log: logJson,
            }),
          },
        }
      : {}),
  });
  if (config.inboundToken || config.ingestToken) {
    await startHttpServer(handler, config.host, config.port);
    logJson({
      event: "listening",
      host: config.host,
      port: config.port,
      notices: Boolean(config.inboundToken),
      ingest: Boolean(config.ingestToken),
      personal: Boolean(config.personalAccountId),
      trade: Boolean(orders),
    });
  } else {
    logJson({ event: "inbound_disabled", reason: "neither BOT_INBOUND_TOKEN nor BOT_INGEST_TOKEN is set" });
  }

  if (config.sender === "telegram") {
    const bot = new Bot(config.telegramToken!);
    installCommands(bot, config.allowedChatIds, logJson);
    bot.catch((err) => logJson({ event: "telegram_error", error: err.error instanceof Error ? err.error.name : "unknown" }));
    void bot.start({ allowed_updates: ["message"] });
    logJson({ event: "telegram_polling" });
  }
}
