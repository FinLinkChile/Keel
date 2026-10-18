// POST /inbound: one raw email from the mail forwarder (Keel Personal), as on the local server.
// Bearer token: the secret ingest_webhook_token. The raw message is kept in DOCS_BUCKET at
// inbound/<sha256>.eml (the bucket's lifecycle decides for how long), then the email pipeline
// runs: authentication (SPF/DKIM/DMARC), duplicates, sender limit, parser, quarantined
// extractor, agreement, alias binding, change requests. The outcome goes to the bot as
// { kind: "ingest_outcome", payload: { source: "email", outcome } }.
// The envelope comes in x-envelope-ip, x-envelope-helo and x-envelope-from. The body is capped at
// MAX_BODY_BYTES (5.5 MB, aws/src/http.ts), below ingest's MAX_EMAIL_BYTES, so a larger email is refused with 413.
import { createHash } from "node:crypto";
import { AliasTableSchema, MAX_EMAIL_BYTES, MIN_TOKEN_LENGTH, receiveEmail, type AliasTable } from "@keel/ingest";
import { api, bearerMatches, HttpError, type Reply, type Request } from "../http";
import { inboundKey } from "../ingest/objects";
import { defaultRuntime, withTransfers, type IngestRuntime } from "../ingest/runtime";
import { secret } from "../secrets";

const header = (req: Request, name: string) => {
  const v = req.headers[name];
  return typeof v === "string" && v.length > 0 && v.length < 256 ? v : undefined;
};

// The Keel Personal alias table, from the ingest table. Without one, no sender is known and
// every email is quarantined.
async function aliasesOf(rt: IngestRuntime): Promise<AliasTable> {
  const raw = await rt.repo.aliasTable();
  if (raw === undefined) return [];
  const parsed = AliasTableSchema.safeParse(raw);
  if (!parsed.success) throw new Error("the alias table in the ingest table is invalid");
  return parsed.data;
}

export function createInboundHandler(
  runtime: () => IngestRuntime = () => defaultRuntime(),
  token: () => Promise<string> = () => secret("ingest_webhook_token"),
) {
  const inbound = async (req: Request): Promise<Reply> => {
    const expected = await token();
    if (expected.length < MIN_TOKEN_LENGTH) throw new Error("ingest_webhook_token is too short");
    if (!bearerMatches(req, expected)) throw new HttpError(401, "unauthorized");
    const raw = req.rawBody;
    if (raw.byteLength === 0) throw new HttpError(400, "bad_request");
    if (raw.byteLength > MAX_EMAIL_BYTES) throw new HttpError(413, "too_large");
    const rt = runtime();
    const messageHash = createHash("sha256").update(raw).digest("hex");
    await rt.objects.put(inboundKey(messageHash), raw, "message/rfc822");
    const { settings: current } = (await rt.settings()).get();
    const extractor = await rt.extractor();
    const outcome = await withTransfers(rt.repo, async () =>
      receiveEmail(
        raw,
        { ip: header(req, "x-envelope-ip"), helo: header(req, "x-envelope-helo"), mailFrom: header(req, "x-envelope-from") },
        await aliasesOf(rt),
        extractor,
        { requireDmarc: current.requireDmarc, store: rt.repo },
      ),
    );
    const reason = "reason" in outcome ? String(outcome.reason) : undefined;
    console.log(
      JSON.stringify({ at: new Date().toISOString(), event: "ingest_email", messageHash: outcome.messageHash, status: outcome.status, reason, auth: outcome.auth }),
    );
    await rt.notify({ kind: "ingest_outcome", payload: { source: "email", outcome } });
    return { body: { status: outcome.status, ...(reason ? { reason } : {}) } };
  };
  return api({ "POST /inbound": inbound }, { "POST /inbound": { auth: false } });
}

export const handler = createInboundHandler();
