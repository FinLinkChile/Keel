// MessageSender over the Telegram Bot API (grammY). Plain text, no parse_mode, no link preview.
import { Api, InlineKeyboard } from "grammy";
import type { ChatId, MessageSender } from "../../application/ports";
import type { Message } from "../../domain/message";
import { placeLink, textWithLink } from "./link";

export class TelegramSender implements MessageSender {
  constructor(
    private readonly api: Api,
    private readonly appBaseUrl: string | undefined,
  ) {}

  static fromToken(token: string, appBaseUrl: string | undefined): TelegramSender {
    return new TelegramSender(new Api(token), appBaseUrl);
  }

  async send(chatId: ChatId, message: Message): Promise<void> {
    const placement = placeLink(message, this.appBaseUrl);
    await this.api.sendMessage(chatId, textWithLink(message, placement), {
      link_preview_options: { is_disabled: true },
      ...(placement?.kind === "button" ? { reply_markup: new InlineKeyboard().url(placement.label, placement.url) } : {}),
    });
  }
}
