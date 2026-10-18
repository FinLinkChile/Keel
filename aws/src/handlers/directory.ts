// Directory API: the importer's known suppliers, the deployment's public addresses, and the
// operator route that registers a supplier (../orders/directory.ts).
//
//   GET  /suppliers     signed ApiRequest; representatives of an importer Safe
//   GET  /trade-setup   public (the app needs the chainId before it can sign any request)
//   POST /suppliers     operator only: `Authorization: Bearer <directory_admin_token>`
//
// Reads: PARTIES_TABLE, KEEL_CHAIN_ID or KEEL_CONFIG_PREFIX, and the secret `directory_admin_token`
// (its own name, so the token that registers suppliers is not the one that administers ingest).
import { deployment } from "../config";
import { api, bearerMatches, HttpError, parseJson, signerOf } from "../http";
import { addSupplier, listSuppliers, SupplierBody, tradeSetup } from "../orders/directory";
import { secret } from "../secrets";

export const DIRECTORY_ADMIN_SECRET = "directory_admin_token";

export const handler = api(
  {
    "GET /suppliers": async (req) => {
      const { safe } = await deployment();
      return { body: { safes: await listSuppliers(signerOf(req), safe, undefined, req.query.safe) } };
    },
    "GET /trade-setup": async () => ({ body: tradeSetup(await deployment()) }),
    "POST /suppliers": async (req) => {
      if (!bearerMatches(req, await secret(DIRECTORY_ADMIN_SECRET))) throw new HttpError(401, "unauthorized");
      const { safe } = await deployment();
      return { status: 201, body: await addSupplier(parseJson(req, (v) => SupplierBody.parse(v)), safe) };
    },
  },
  { "GET /trade-setup": { auth: false }, "POST /suppliers": { auth: false } },
);
