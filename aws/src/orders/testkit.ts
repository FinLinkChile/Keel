// For tests: a deployment, parties, a signed order and API Gateway events signed like the app
// signs them. The importer is a Safe whose owner signs through ERC-1271, emulated by a fake RPC
// client that answers isValidSignature the way Safe's CompatibilityFallbackHandler does.
import type { SSMClient } from "@aws-sdk/client-ssm";
import { API_HEADERS, EIP712_TYPES, type Hex, keelDomain, type OrderTerms, type PurchaseOrder, type ShipmentAttestation } from "@keel/schemas";
import { blNumberHash, bytes32Text, requiredDocsHash, termsHash } from "@keel/schemas/hash";
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { encodeAbiParameters, isAddressEqual, recoverTypedDataAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { apiRequestTypedData } from "../auth";
import { deployment, resetDeploymentCache } from "../config";
import { setDdb } from "../db";
import { type ChainDeps, escrowDigest, rpcChainDeps, setChainDeps } from "./chain";
import { fakeKeelDdb, TEST_TABLES } from "./fakeDdb";
import { orderIdOf } from "./rules";

export const CHAIN = 84532;
export const ESCROW = "0x00000000000000000000000000000000000e5c40" as Hex;
export const SAFE = "0x5afe00000000000000000000000000000000cafe" as Hex;
export const TOKEN = "0x0000000000000000000000000000000000007070" as Hex;
export const GATE = "0x0000000000000000000000000000000000006a7e" as Hex;

const key = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hex;
export const owner = privateKeyToAccount(key(0xa11ce)); // representative and owner of the Safe
export const exporter = privateKeyToAccount(key(0xb0b));
export const payout = privateKeyToAccount(key(0x9a7));
export const carrier = privateKeyToAccount(key(0xca44));
export const arbiter = privateKeyToAccount(key(0xa4b));
export const verifier = privateKeyToAccount(key(0x7e41));
export const stranger = privateKeyToAccount(key(0xbad));
export type Account = typeof owner;

export const now = () => Math.floor(Date.now() / 1000);

export function makeOrder(over: Partial<PurchaseOrder> = {}, termsOver: Partial<OrderTerms> = {}) {
  const terms: OrderTerms = {
    orderNumber: "PO0131",
    currency: "USD",
    invoiceAmountMinor: 1_000_000n,
    hsCodes: ["090111"],
    documentHash: `0x${"ab".repeat(32)}`,
    ...termsOver,
  };
  const nonce = over.nonce ?? 1n;
  const po: PurchaseOrder = {
    orderId: orderIdOf(SAFE, exporter.address, nonce),
    importer: SAFE,
    exporter: exporter.address,
    payoutAddress: payout.address,
    token: TOKEN,
    totalAmount: 10_000_000_000n,
    advanceBps: 3000,
    shipmentDeadline: BigInt(now() + 30 * 86400),
    disputeWindow: 7n * 86400n,
    carrier: carrier.address,
    arbiter: arbiter.address,
    documentVerifier: verifier.address,
    incoterm: bytes32Text("CIF"),
    termsHash: termsHash(terms),
    requiredDocsHash: requiredDocsHash(["BILL_OF_LADING", "COMMERCIAL_INVOICE"]),
    nonce,
    ...over,
  };
  return { po, terms };
}

export const json = (v: unknown) => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)));

// ---------------------------------------------------------------- signatures

const domain = keelDomain(CHAIN, ESCROW);
type Struct = "PurchaseOrder" | "ShipmentAttestation" | "CancelOrder" | "BalanceApproval" | "DisputeResolution";

export const signAs = (who: Account, primaryType: Struct, message: object) =>
  who.signTypedData({ domain, types: { [primaryType]: EIP712_TYPES[primaryType] }, primaryType, message } as never);

// An owner's signature for the Safe: the EIP-712 SafeMessage over abi.encode(escrow digest)
const safeMessage = (digest: Hex) => ({
  domain: { chainId: CHAIN, verifyingContract: SAFE },
  types: { SafeMessage: [{ name: "message", type: "bytes" }] },
  primaryType: "SafeMessage" as const,
  message: { message: encodeAbiParameters([{ type: "bytes32" }], [digest]) },
});

export const signAsSafe = (who: Account, primaryType: Struct, message: object): Promise<Hex> =>
  who.signTypedData(safeMessage(escrowDigest(CHAIN, ESCROW, primaryType, message)) as never);

export const chainState = { cancelNonce: 0n, owners: [owner.address as Hex] };

// The fake chain: SAFE has code and answers isValidSignature like a 1-of-1 Safe
export function fakeChain(): ChainDeps {
  return rpcChainDeps({
    getCode: (async ({ address }: { address: Hex }) => (isAddressEqual(address, SAFE) ? "0x6080" : undefined)) as never,
    readContract: (async ({ address, functionName, args }: { address: Hex; functionName: string; args: [Hex, Hex] }) => {
      if (functionName === "cancelNonceOf") return chainState.cancelNonce;
      if (!isAddressEqual(address, SAFE)) throw new Error("no code");
      try {
        const signer = await recoverTypedDataAddress({ ...safeMessage(args[0]), signature: args[1] } as never);
        return chainState.owners.some((o) => isAddressEqual(o, signer)) ? "0x1626ba7e" : "0xffffffff";
      } catch {
        return "0xffffffff";
      }
    }) as never,
  });
}

export function attestation(orderId: Hex, over: Partial<ShipmentAttestation> = {}): ShipmentAttestation {
  return {
    orderId,
    blNumberHash: blNumberHash(carrier.address, "MSKU1234567"),
    onBoardDate: BigInt(now() - 3600),
    portOfLoading: bytes32Text("CNSHA"),
    docsHash: `0x${"cd".repeat(32)}`,
    ...over,
  };
}

// ---------------------------------------------------------------- environment

export async function setup() {
  Object.assign(process.env, TEST_TABLES, { KEEL_CONFIG_PREFIX: "/keel/test/" });
  const ddb = fakeKeelDdb();
  setDdb(ddb.asClient());
  setChainDeps(fakeChain());
  chainState.cancelNonce = 0n;
  resetDeploymentCache();
  const values: Record<string, string> = { "chain-id": String(CHAIN), escrow: ESCROW, safe: SAFE, token: TOKEN, "funding-gate": GATE, "deploy-block": "100" };
  const ssm = { send: async () => ({ Parameters: Object.entries(values).map(([k, v]) => ({ Name: `/keel/test/${k}`, Value: v })) }) } as unknown as SSMClient;
  await deployment(process.env, ssm);
  ddb.put("parties", { address: SAFE.toLowerCase(), kind: "importer", representatives: [owner.address.toLowerCase()], account: "importer-co" });
  ddb.put("parties", { address: owner.address.toLowerCase(), kind: "representative", safe: SAFE.toLowerCase() });
  return ddb;
}

// ---------------------------------------------------------------- requests

type Handler = (event: APIGatewayProxyEventV2) => Promise<APIGatewayProxyResultV2>;

export interface Call {
  status: number;
  body: any;
}

// An API Gateway HTTP API event signed by `who` (or unsigned)
export async function signedEvent(
  who: Account | null,
  routeKey: string,
  opts: { params?: Record<string, string>; query?: Record<string, string>; body?: unknown; headers?: Record<string, string> } = {},
): Promise<APIGatewayProxyEventV2> {
  const [method, template] = routeKey.split(" ") as [string, string];
  const path = template.replace(/\{(\w+)\}/g, (_m, k: string) => opts.params?.[k] ?? "");
  const body = opts.body === undefined ? "" : JSON.stringify(json(opts.body));
  const headers: Record<string, string> = { ...opts.headers };
  if (who) {
    const issuedAt = now();
    headers[API_HEADERS.signer] = who.address;
    headers[API_HEADERS.issuedAt] = String(issuedAt);
    headers[API_HEADERS.signature] = await who.signTypedData(apiRequestTypedData(CHAIN, method, path, body, issuedAt));
  }
  return {
    routeKey,
    rawPath: path,
    body,
    isBase64Encoded: false,
    headers,
    pathParameters: opts.params,
    queryStringParameters: opts.query,
    requestContext: { http: { method } },
  } as unknown as APIGatewayProxyEventV2;
}

// Sends an event as is: the same event twice is a replay of the same signed request
export async function send(handler: Handler, event: APIGatewayProxyEventV2): Promise<Call> {
  const res = (await handler(event)) as { statusCode: number; body: string };
  return { status: res.statusCode, body: JSON.parse(res.body) };
}

export function resetChainDeps() {
  setChainDeps(undefined);
}

// A fresh signed request, sent and parsed
export async function call(handler: Handler, who: Account | null, routeKey: string, opts: Parameters<typeof signedEvent>[2] = {}): Promise<Call> {
  return send(handler, await signedEvent(who, routeKey, opts));
}
