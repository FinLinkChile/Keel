// Operator route for the bot's directory in AWS: account names, chats per account and role, and
// order labels, without editing files or variables. Same shape as the local recipients and orders
// files, checked with the same rules (bot/src/adapters/kv/kv-admin.ts).
//   GET /bot/recipients   the whole directory                    Bearer secret bot_admin_token
//   PUT /bot/recipients   change entries, audited                Bearer secret bot_admin_token
//                         + header x-admin-actor (who changes it, [\w.@+-]{1,64})
// PUT body:   { "accounts"?: { "<accountId>": AccountEntry | null }, "orders"?: { "<orderId>": OrderEntry | null } }
// PUT reply:  200 { changed: false } or { changed: true, at, accounts: [ids], orders: [ids] }
//             400 missing_actor | bad_json | invalid_recipients (with a message naming entries and rules)
// Every change that changes something leaves an audit item in the bot table (actor, time, each
// entry before and after). The log line carries the actor and the ids only.
//
// Environment: BOT_TABLE, KEEL_CHAIN_ID. Secret: bot_admin_token.
import { RecipientsAdmin, RecipientsError } from "@keel/bot";
import { api, HttpError, type Request } from "../http";
import { botRuntime, jsonBody, logJson, requireToken } from "../bot/runtime";

const MAX_BODY_BYTES = 256 * 1024;
// Same rule as ingest's PUT /admin/settings
const ACTOR_RE = /^[\w.@+-]{1,64}$/;

async function read(req: Request) {
  const rt = botRuntime();
  await requireToken(req, rt, "bot_admin_token");
  return { body: await new RecipientsAdmin(rt.kv(), rt.now).view() };
}

async function change(req: Request) {
  const rt = botRuntime();
  await requireToken(req, rt, "bot_admin_token");
  const actor = req.headers["x-admin-actor"];
  if (!actor || !ACTOR_RE.test(actor)) throw new HttpError(400, "missing_actor");
  const json = jsonBody(req, MAX_BODY_BYTES);
  try {
    const audit = await new RecipientsAdmin(rt.kv(), rt.now).apply(json, actor);
    if (!audit) return { body: { changed: false } };
    const accounts = Object.keys(audit.changes.accounts ?? {});
    const orders = Object.keys(audit.changes.orders ?? {});
    logJson({ event: "recipients_changed", actor, accounts, orders });
    return { body: { changed: true, at: audit.at, accounts, orders } };
  } catch (e) {
    if (e instanceof RecipientsError) throw new HttpError(400, "invalid_recipients", { message: e.message });
    throw e;
  }
}

export const handler = api(
  { "GET /bot/recipients": read, "PUT /bot/recipients": change },
  { "GET /bot/recipients": { auth: false }, "PUT /bot/recipients": { auth: false } },
);
