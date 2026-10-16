import { Api } from "grammy";
import { describe, expect, it } from "vitest";
import type { Message } from "../../domain/message";
import { ConsoleSender } from "./console-sender";
import { placeLink } from "./link";
import { TelegramSender } from "./telegram-sender";

const message: Message = { text: "Balance paid.", link: { label: "Open the order", path: "/orders/po-0142" } };

describe("placeLink", () => {
  it("uses a button for a public base", () => {
    expect(placeLink(message, "https://keel.example")).toEqual({
      kind: "button",
      label: "Open the order",
      url: "https://keel.example/orders/po-0142",
    });
  });

  it("puts a local or plain http base in the text", () => {
    for (const base of ["http://localhost:5173", "https://127.0.0.1:5173", "http://keel.example"]) {
      expect(placeLink(message, base)?.kind).toBe("text");
    }
  });

  it("omits the link without a base", () => {
    expect(placeLink(message, undefined)).toBeUndefined();
  });
});

function fakeApi() {
  const api = new Api("123:fake");
  const calls: { method: string; payload: Record<string, unknown> }[] = [];
  api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload: payload as Record<string, unknown> });
    return { ok: true, result: { message_id: 1, date: 0, chat: { id: 1, type: "private" } } } as never;
  });
  return { api, calls };
}

describe("TelegramSender", () => {
  it("sends plain text with a button when the base is public", async () => {
    const { api, calls } = fakeApi();
    await new TelegramSender(api, "https://keel.example").send(111, message);
    const [call] = calls;
    expect(call?.method).toBe("sendMessage");
    expect(call?.payload).toMatchObject({ chat_id: 111, text: "Balance paid.", link_preview_options: { is_disabled: true } });
    expect(call?.payload.parse_mode).toBeUndefined();
    expect(JSON.stringify(call?.payload.reply_markup)).toContain("https://keel.example/orders/po-0142");
  });

  it("appends the URL to the text when the base is local, and sends no link without a base", async () => {
    const { api, calls } = fakeApi();
    await new TelegramSender(api, "http://localhost:5173").send(111, message);
    await new TelegramSender(api, undefined).send(111, message);
    expect(calls[0]?.payload.text).toBe("Balance paid.\n\nOpen the order: http://localhost:5173/orders/po-0142");
    expect(calls[0]?.payload.reply_markup).toBeUndefined();
    expect(calls[1]?.payload.text).toBe("Balance paid.");
    expect(calls[1]?.payload.reply_markup).toBeUndefined();
  });
});

describe("ConsoleSender", () => {
  it("prints the recipient, the text and the path", async () => {
    const lines: string[] = [];
    await new ConsoleSender(undefined, () => "Acme Imports (owner)", (l) => lines.push(l)).send(111, message);
    expect(lines[0]).toBe("-> chat 111, Acme Imports (owner)\n  Balance paid.\n  [Open the order] /orders/po-0142\n");
  });
});
