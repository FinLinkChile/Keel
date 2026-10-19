// Orders API, read-only: the caller's orders, one order, what needs the caller now and the Safe's
// wallet. Everything comes from DynamoDB (orders, proposals, parties); the escrow state is the
// indexer's mirror. Nothing here changes anything (../orders/views.ts). The one chain read is the
// Safe's token balance in GET /wallet, left out when the RPC does not answer.
//
// Reads: ORDERS_TABLE, PROPOSALS_TABLE, PARTIES_TABLE, KEEL_CHAIN_ID or KEEL_CONFIG_PREFIX; the
// secret rpc_url (or KEEL_RPC_URL) for that balance.
import { api, signerOf } from "../http";
import { ctxOf } from "../orders/context";
import { getOrder, listOrders, needsYou, wallet } from "../orders/views";

export const handler = api({
  "GET /orders": async (req) => {
    const orders = await listOrders(signerOf(req), await ctxOf());
    return { body: { orders: req.query.state ? orders.filter((o) => o.state === req.query.state) : orders } };
  },
  "GET /orders/{orderId}": async (req) => ({ body: await getOrder(signerOf(req), req.params.orderId ?? "") }),
  "GET /needs-you": async (req) => ({ body: { needs: await needsYou(signerOf(req), await ctxOf()) } }),
  "GET /wallet": async (req) => ({ body: { wallets: await wallet(signerOf(req), await ctxOf(), req.query.safe) } }),
});
