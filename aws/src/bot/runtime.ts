// What the bot handlers (botNotify, noticesIn, botAdmin) take from the platform: the store, the
// Telegram sender, secrets and the clock. Built from the environment by default; tests replace any
// part with setBotRuntime, so no test reaches AWS or Telegram.
//
// In AWS the bot only sends: it receives nothing from Telegram (no webhook, no polling), so the
// Telegram token is the only Telegram secret, and only botNotify reads it.
import { createHash, timingSafeEqual } from "node:crypto";
import { TelegramSender, type KeyValueStore, type MessageSender } from "@keel/bot";
import { type Env, table } from "../config";
import { HttpError, type Request } from "../http";
import { secret } from "../secrets";
import { DynamoKeyValueStore } from "./dynamo-kv";

export interface BotRuntime {
  kv: () => KeyValueStore;
  sender: () => Promise<MessageSender>;
  secret: (name: "telegram_bot_token" | "bot_inbound_token" | "bot_admin_token") => Promise<string>;
  // Unix ms
  now: () => number;
}

let override: Partial<BotRuntime> = {};
let sender: Promise<MessageSender> | undefined;

// For tests
export function setBotRuntime(r: Partial<BotRuntime> | undefined) {
  override = r ?? {};
  sender = undefined;
}

export function botRuntime(env: Env = process.env): BotRuntime {
  const now = override.now ?? (() => Date.now());
  const read = override.secret ?? ((name: string) => secret(name, env));
  return {
    kv: override.kv ?? (() => new DynamoKeyValueStore(table("bot", env), undefined, now)),
    // One per container: the token is read once
    sender:
      override.sender ??
      (() => {
        sender ??= read("telegram_bot_token").then((token) => TelegramSender.fromToken(token, env.APP_BASE_URL?.replace(/\/+$/, "")));
        sender.catch(() => (sender = undefined));
        return sender;
      }),
    secret: read,
    now,
  };
}

// Activity log as JSON lines. Entries carry ids, kinds and codes only, never a notice's values.
export const logJson = (entry: object) => console.log(JSON.stringify({ at: new Date().toISOString(), ...entry }));

const digest = (s: string) => createHash("sha256").update(s).digest();

// Bearer token compared in constant time, length included (both sides are hashed first)
export function tokenMatches(req: Request, token: string): boolean {
  const header = req.headers.authorization ?? req.headers.Authorization ?? "";
  if (!/^Bearer\s+/i.test(header)) return false;
  return timingSafeEqual(digest(header.replace(/^Bearer\s+/i, "")), digest(token));
}

export async function requireToken(req: Request, rt: BotRuntime, name: "bot_inbound_token" | "bot_admin_token"): Promise<void> {
  if (!tokenMatches(req, await rt.secret(name))) throw new HttpError(401, "unauthorized");
}

// The raw body, refused past `max` bytes, parsed as JSON
export function jsonBody(req: Request, max: number): unknown {
  if (Buffer.byteLength(req.body) > max) throw new HttpError(413, "too_large");
  try {
    return JSON.parse(req.body);
  } catch {
    throw new HttpError(400, "bad_json");
  }
}
