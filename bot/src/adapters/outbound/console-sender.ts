// MessageSender that prints, for development, tests and the demo dry run.
import type { ChatId, MessageSender } from "../../application/ports";
import type { Message } from "../../domain/message";
import { placeLink } from "./link";

export class ConsoleSender implements MessageSender {
  constructor(
    private readonly appBaseUrl: string | undefined,
    // Who holds the chat, e.g. "Acme Imports (owner)"
    private readonly describe: (chatId: ChatId) => string = String,
    private readonly write: (line: string) => void = (line) => console.log(line),
  ) {}

  async send(chatId: ChatId, message: Message): Promise<void> {
    const placement = placeLink(message, this.appBaseUrl);
    const link = message.link ? `\n  [${message.link.label}] ${placement?.url ?? message.link.path}` : "";
    this.write(`-> chat ${chatId}, ${this.describe(chatId)}\n  ${message.text}${link}\n`);
  }
}
