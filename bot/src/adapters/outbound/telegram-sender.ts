// MessageSender over the Telegram Bot API (grammY). Plain text, no parse_mode, no link preview.
import { Api, GrammyError, HttpError, InlineKeyboard } from "grammy";
import { RetryableSendError, type ChatId, type MessageSender } from "../../application/ports";
import type { Message } from "../../domain/message";
import { placeLink, textWithLink } from "./link";

export const SEND_TIMEOUT_SECONDS = 10;

export class TelegramSender implements MessageSender {
  constructor(
    private readonly api: Api,
    private readonly appBaseUrl: string | undefined,
  ) {}

  static fromToken(token: string, appBaseUrl: string | undefined): TelegramSender {
    // A hung call must fail well before the notify Lambda's own timeout (60 s): grammY turns a
    // timeout into an HttpError, which is retryable.
    return new TelegramSender(new Api(token, { timeoutSeconds: SEND_TIMEOUT_SECONDS }), appBaseUrl);
  }

  async send(chatId: ChatId, message: Message): Promise<void> {
    const placement = placeLink(message, this.appBaseUrl);
    try {
      await this.api.sendMessage(chatId, textWithLink(message, placement), {
        link_preview_options: { is_disabled: true },
        ...(placement?.kind === "button" ? { reply_markup: new InlineKeyboard().url(placement.label, placement.url) } : {}),
      });
    } catch (err) {
      if (isRetryable(err)) throw new RetryableSendError("telegram");
      throw err;
    }
  }
}

// Too many requests, a Telegram outage or the network: the same send may work later. A 400 or
// 403 (chat not found, bot blocked) will not, and is never retried.
export function isRetryable(err: unknown): boolean {
  if (err instanceof HttpError) return true;
  if (err instanceof GrammyError) return err.error_code === 429 || err.error_code >= 500;
  return false;
}
