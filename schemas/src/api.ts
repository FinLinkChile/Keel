// Signed requests to the Keel API on AWS (docs/interfaces/autenticacion-api.md).
// Each call to an authenticated route carries an EIP-712 signature of the wallet of the person
// making it, over the method, the path, the hash of the body and the time. It authenticates who
// asks; it moves nothing on chain. Same pattern as the document upload (ingest/src/trade/upload.ts),
// as Area 2's docs/arquitectura/aws-api-y-datos.md proposes: the off-chain domain "Keel Ingest"
// and a 10-minute window. The domain is never "Keel", so a request can never be replayed as one
// of the structs the contracts verify, and its own primary type keeps it apart from an upload.
import type { Hex } from "./index";

export const apiDomain = (chainId: number) => ({ name: "Keel Ingest", version: "1", chainId }) as const;

export const API_EIP712_TYPES = {
  ApiRequest: [
    { name: "method", type: "string" },
    { name: "path", type: "string" },
    { name: "bodyHash", type: "bytes32" },
    { name: "issuedAt", type: "uint64" },
  ],
} as const;

export interface ApiRequest {
  // Upper case: GET, POST, PUT
  method: string;
  // Path without the query string, as API Gateway receives it: /proposals/0xab…
  path: string;
  // keccak256 of the raw body bytes; keccak256 of the empty string for a GET
  bodyHash: Hex;
  // Unix seconds. Accepted within API_MAX_SKEW_SECONDS of the server clock.
  issuedAt: bigint;
}

export const API_MAX_SKEW_SECONDS = 10 * 60;

// Headers that carry the signature
export const API_HEADERS = {
  signer: "x-keel-signer",
  signature: "x-keel-signature",
  issuedAt: "x-keel-timestamp",
} as const;
