// POST /trade/insights: the agent's analysis of the importer's purchases (ingest/src/trade/
// insights.ts, Area 3). Same contract as the local server:
//   request  { issuedAt, signature, input }   input: the metrics as JSON text, exactly as signed
//   reply    200 { status: "ok", inputHash, findings }
//            200 { status: "failed", reason }
//            4xx { status: "rejected", reason }
// The InsightsRequest signature (EIP-712, domain "Keel Ingest") over the hash of the exact metrics
// is the authentication, so the route takes no ApiRequest signature. The signer must be an
// importer or the representative of an importer Safe in the parties table, within 10 analyses a
// day. The model sees only the aggregated numbers the app computed and signed, never a document,
// an address or a name; its answer is advice the person reads and decides nothing.
import { INSIGHTS_REJECTION_STATUS, InsightsBody, receiveInsights } from "@keel/ingest";
import type { Hex } from "@keel/schemas";
import { api, parseJson, type Reply, type Request } from "../http";
import { defaultRuntime, withTransfers, type IngestRuntime } from "../ingest/runtime";

export function createInsightsHandler(runtime: () => IngestRuntime = () => defaultRuntime()) {
  const insights = async (req: Request): Promise<Reply> => {
    const rt = runtime();
    const body = parseJson(req, (v) => InsightsBody.parse(v));
    const analyst = await rt.extractor();
    const outcome = await withTransfers(rt.repo, async () =>
      receiveInsights({ issuedAt: body.issuedAt, signature: body.signature as Hex, input: body.input }, rt.importers, analyst, {
        store: rt.repo,
        chainId: req.chainId,
        now: rt.now(),
      }),
    );
    console.log(
      JSON.stringify({
        at: new Date().toISOString(),
        event: "trade_insights",
        status: outcome.status,
        ...("reason" in outcome ? { reason: String(outcome.reason) } : {}),
      }),
    );
    if (outcome.status === "rejected") return { status: INSIGHTS_REJECTION_STATUS[outcome.reason], body: outcome };
    return { body: outcome };
  };
  return api({ "POST /trade/insights": insights }, { "POST /trade/insights": { auth: false } });
}

export const handler = createInsightsHandler();
