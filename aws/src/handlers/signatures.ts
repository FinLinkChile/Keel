// Closing signatures of an open order, stored for the agent to submit (../orders/closing.ts):
//
//   POST /orders/{orderId}/approve-balance    importer   BalanceApproval{orderId, attestationHash}
//   POST /orders/{orderId}/cancel-signature   either     CancelOrder{orderId, cancelNonceOf(orderId)}
//   POST /disputes/{orderId}/resolution       arbiter    DisputeResolution{orderId, toImporter, toExporter}
//
// Reads: ORDERS_TABLE, PARTIES_TABLE, KEEL_CHAIN_ID or KEEL_CONFIG_PREFIX, and KEEL_RPC_URL or the
// secret `rpc_url` (cancelNonceOf, and ERC-1271 checks of a Safe importer).
import { api, parseJson, signerOf } from "../http";
import { ApproveBalanceBody, approveBalance, CancelBody, cancelSignature, resolution, ResolutionBody } from "../orders/closing";
import { ctxOf } from "../orders/context";

export const handler = api({
  "POST /orders/{orderId}/approve-balance": async (req) => ({
    body: await approveBalance(signerOf(req), req.params.orderId ?? "", parseJson(req, (v) => ApproveBalanceBody.parse(v)), await ctxOf()),
  }),
  "POST /orders/{orderId}/cancel-signature": async (req) => ({
    body: await cancelSignature(signerOf(req), req.params.orderId ?? "", parseJson(req, (v) => CancelBody.parse(v)), await ctxOf()),
  }),
  "POST /disputes/{orderId}/resolution": async (req) => ({
    body: await resolution(signerOf(req), req.params.orderId ?? "", parseJson(req, (v) => ResolutionBody.parse(v)), await ctxOf()),
  }),
});
