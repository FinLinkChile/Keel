// Daily (EventBridge schedule). Two summaries instead of a notification each:
//   - the beneficiary change requests created since the last run (T3.2), sent to the bot as
//     { kind: "ingest_outcome", payload: { source: "change_digest", since, requests } };
//   - the transfers of document text to LLM vendors since the last run (Ley 21.719), written
//     to the logs as counts per vendor and purpose (the entries stay in the ingest table).
// Where each summary stopped is persisted (cursor/digest), so a skipped or failed day is
// covered by the next run instead of being lost. The change cursor only moves once the notice
// is queued.
import { changeDigestPayload, DAY_MS } from "@keel/ingest";
import { defaultRuntime, type IngestRuntime } from "../ingest/runtime";

export interface DigestResult {
  changes: number;
  transfers: number;
}

export async function runDigest(rt: IngestRuntime): Promise<DigestResult> {
  const until = rt.now();
  const cursor = await rt.repo.digestCursor();
  const dayAgo = new Date(until.getTime() - DAY_MS);
  const changesSince = cursor.changes ? new Date(cursor.changes) : dayAgo;
  const transfersSince = cursor.transfers ? new Date(cursor.transfers) : dayAgo;

  const payload = await changeDigestPayload((since) => rt.repo.changeDigest(since), changesSince);
  const requests = payload?.source === "change_digest" ? payload.requests.length : 0;
  const sent = payload ? await rt.notify({ kind: "ingest_outcome", payload }) : true;

  const transfers = await rt.repo.transfersSince(transfersSince, until);
  const byDestination: Record<string, number> = {};
  for (const t of transfers) {
    const k = `${String(t.destino ?? "?")}|${String(t.finalidad ?? "?")}`;
    byDestination[k] = (byDestination[k] ?? 0) + 1;
  }
  console.log(
    JSON.stringify({ event: "privacy_transfers", since: transfersSince.toISOString(), until: until.toISOString(), count: transfers.length, byDestination }),
  );

  await rt.repo.saveDigestCursor({
    changes: sent ? until.toISOString() : changesSince.toISOString(),
    transfers: until.toISOString(),
  });
  return { changes: requests, transfers: transfers.length };
}

export function createDigestHandler(runtime: () => IngestRuntime = () => defaultRuntime()) {
  return async (): Promise<DigestResult> => runDigest(runtime());
}

export const handler = createDigestHandler();
