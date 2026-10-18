// Authentication of each API request (docs/interfaces/autenticacion-api.md). The caller signs an
// ApiRequest (schemas/src/api.ts) with the wallet of a person: an EOA. A Safe cannot sign here;
// its owners and representatives sign for it, and the handler checks that the recovered EOA
// represents the party it acts for (`represents` below). Authentication says who asks; what they
// may do is each route's check.
import { API_EIP712_TYPES, API_HEADERS, API_MAX_SKEW_SECONDS, apiDomain, type Hex } from "@keel/schemas";
import { keccak256, recoverTypedDataAddress, toBytes } from "viem";

export type AuthRejection = "missing_signature" | "stale_signature" | "bad_signature" | "signer_mismatch";

export type AuthResult = { ok: true; signer: Hex } | { ok: false; reason: AuthRejection };

export interface SignedRequest {
  method: string;
  path: string;
  // Raw body as received ("" for none)
  body: string;
  headers: Record<string, string | undefined>;
}

export const bodyHash = (body: string): Hex => keccak256(toBytes(body));

export async function authenticate(req: SignedRequest, chainId: number, now: Date = new Date()): Promise<AuthResult> {
  const h = (name: string) => req.headers[name] ?? req.headers[name.toLowerCase()];
  const claimed = h(API_HEADERS.signer);
  const signature = h(API_HEADERS.signature);
  const issuedAtText = h(API_HEADERS.issuedAt);
  if (!claimed || !signature || !issuedAtText || !/^\d+$/.test(issuedAtText)) return { ok: false, reason: "missing_signature" };
  const issuedAt = Number(issuedAtText);
  if (Math.abs(now.getTime() / 1000 - issuedAt) > API_MAX_SKEW_SECONDS) return { ok: false, reason: "stale_signature" };
  let signer: Hex;
  try {
    signer = await recoverTypedDataAddress({
      domain: apiDomain(chainId),
      types: API_EIP712_TYPES,
      primaryType: "ApiRequest",
      message: { method: req.method.toUpperCase(), path: req.path, bodyHash: bodyHash(req.body), issuedAt: BigInt(issuedAt) },
      signature: signature as Hex,
    });
  } catch {
    return { ok: false, reason: "bad_signature" };
  }
  // A body or path changed after signing recovers another address
  if (signer.toLowerCase() !== claimed.toLowerCase()) return { ok: false, reason: "signer_mismatch" };
  return { ok: true, signer };
}

// What the client sends: used by the app (app/src/data/api.ts) and the CLI tools of the carrier
// and the arbiter (aws/scripts/), so both sides build the same message.
export function apiRequestTypedData(chainId: number, method: string, path: string, body: string, issuedAt: number) {
  return {
    domain: apiDomain(chainId),
    types: API_EIP712_TYPES,
    primaryType: "ApiRequest" as const,
    message: { method: method.toUpperCase(), path, bodyHash: bodyHash(body), issuedAt: BigInt(issuedAt) },
  };
}

// Whether `signer` may act for `party`: the party itself (an EOA such as an exporter, carrier or
// arbiter) or one of the representatives registered for it (an importer Safe).
export function represents(signer: Hex, party: string, representatives: readonly string[] = []): boolean {
  const s = signer.toLowerCase();
  return s === party.toLowerCase() || representatives.some((r) => r.toLowerCase() === s);
}
