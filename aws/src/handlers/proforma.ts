// POST /trade/proforma: the importer's proforma, read to prefill the order on the review
// screen (T3.9). Same contract as the local server (ingest/src/server.ts):
//   request  { issuedAt, signature, file }   file: the PDF or image, base64
//   reply    200 { status: "read", fileHash, input, proforma, missing }
//            200 { status: "unreadable", reason, fileHash }
//            4xx { status: "rejected", reason }
// The ProformaUpload signature (EIP-712, domain "Keel Ingest") is the authentication, so the
// route takes no ApiRequest signature. The signer must be an importer or the representative of
// an importer Safe in the parties table. Nothing is decided here and the file is not kept.
import { PROFORMA_REJECTION_STATUS, ProformaUploadBody, receiveProforma } from "@keel/ingest";
import type { Hex } from "@keel/schemas";
import { api, parseJson, type Reply, type Request } from "../http";
import { defaultRuntime, withTransfers, type IngestRuntime } from "../ingest/runtime";

export function createProformaHandler(runtime: () => IngestRuntime = () => defaultRuntime()) {
  const proforma = async (req: Request): Promise<Reply> => {
    const rt = runtime();
    const body = parseJson(req, (v) => ProformaUploadBody.parse(v));
    const extractor = await rt.extractor();
    const outcome = await withTransfers(rt.repo, async () =>
      receiveProforma(
        { issuedAt: body.issuedAt, signature: body.signature as Hex, file: new Uint8Array(Buffer.from(body.file, "base64")) },
        rt.importers,
        extractor,
        { store: rt.repo, chainId: req.chainId, now: rt.now() },
      ),
    );
    console.log(
      JSON.stringify({
        at: new Date().toISOString(),
        event: "trade_proforma",
        status: outcome.status,
        ...("reason" in outcome ? { reason: outcome.reason } : {}),
        ...("fileHash" in outcome ? { fileHash: outcome.fileHash } : {}),
      }),
    );
    if (outcome.status === "rejected") return { status: PROFORMA_REJECTION_STATUS[outcome.reason], body: outcome };
    return { body: outcome };
  };
  return api({ "POST /trade/proforma": proforma }, { "POST /trade/proforma": { auth: false } });
}

export const handler = createProformaHandler();
