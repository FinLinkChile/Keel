// Proposals API: the PurchaseOrder from the importer's proposal to both signatures. Every route
// takes a signed ApiRequest (../auth.ts); what the signer may do is checked against the parties
// table and the signed order itself (../orders/proposals.ts).
//
// Reads: PROPOSALS_TABLE, PARTIES_TABLE, KEEL_CHAIN_ID or KEEL_CONFIG_PREFIX (deployment), and for
// the signature routes KEEL_RPC_URL or the secret `rpc_url` (ERC-1271 checks of a Safe).
import { api, parseJson, signerOf } from "../http";
import { ctxOf } from "../orders/context";
import {
  CreateBody,
  createProposal,
  ExporterBody,
  exporterSigns,
  getProposal,
  ImporterBody,
  importerSigns,
  listProposals,
  rejectProposal,
} from "../orders/proposals";

export const handler = api({
  "POST /proposals": async (req) => ({ status: 201, body: await createProposal(signerOf(req), parseJson(req, (v) => CreateBody.parse(v)), await ctxOf()) }),
  "GET /proposals": async (req) => ({ body: { proposals: await listProposals(signerOf(req), await ctxOf(), req.query.status) } }),
  "GET /proposals/{orderId}": async (req) => ({ body: await getProposal(signerOf(req), req.params.orderId ?? "", await ctxOf()) }),
  "POST /proposals/{orderId}/exporter-signature": async (req) => ({
    body: await exporterSigns(signerOf(req), req.params.orderId ?? "", parseJson(req, (v) => ExporterBody.parse(v)), await ctxOf()),
  }),
  "POST /proposals/{orderId}/importer-signature": async (req) => ({
    body: await importerSigns(signerOf(req), req.params.orderId ?? "", parseJson(req, (v) => ImporterBody.parse(v)), await ctxOf()),
  }),
  "POST /proposals/{orderId}/reject": async (req) => ({ body: await rejectProposal(signerOf(req), req.params.orderId ?? "", await ctxOf()) }),
});
