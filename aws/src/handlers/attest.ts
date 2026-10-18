// POST /shipments: the carrier's ShipmentAttestation for an order, checked against the carrier the
// signed PurchaseOrder names and stored for the agent, which submits it (submitShipment) on its
// next pass (../orders/closing.ts). The ApiRequest must come from the carrier too.
//
// Reads: ORDERS_TABLE, PARTIES_TABLE, KEEL_CHAIN_ID or KEEL_CONFIG_PREFIX, and KEEL_RPC_URL or the
// secret `rpc_url` (only when the carrier's signature does not recover by ECDSA: ERC-1271).
import { api, parseJson, signerOf } from "../http";
import { attest, ShipmentBody } from "../orders/closing";
import { ctxOf } from "../orders/context";

export const handler = api({
  "POST /shipments": async (req) => ({ body: await attest(signerOf(req), parseJson(req, (v) => ShipmentBody.parse(v)), await ctxOf()) }),
});
