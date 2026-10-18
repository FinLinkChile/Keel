// Wrapper for API Gateway HTTP API (payload 2.0) handlers. It decodes the body, enforces the size
// limit, authenticates when the route asks for it and turns thrown HttpErrors into JSON replies.
// Error bodies carry a code from docs/interfaces/eventos-y-errores.md and never echo input.
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import type { Hex } from "@keel/schemas";
import { type AuthRejection, authenticate } from "./auth";
import { deployment } from "./config";

export const MAX_BODY_BYTES = 10 * 1024 * 1024;

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly extra?: Record<string, unknown>,
  ) {
    super(code);
  }
}

export interface Request {
  method: string;
  path: string;
  // Route key as configured, such as "POST /proposals/{orderId}/reject"
  route: string;
  params: Record<string, string>;
  query: Record<string, string>;
  headers: Record<string, string | undefined>;
  body: string;
  // The body bytes exactly as received, for a route whose body is not UTF-8 text (a raw email:
  // re-encoding it would break its DKIM signature)
  rawBody: Buffer;
  // Present when the route requires a signed request
  signer?: Hex;
  chainId: number;
}

export type Reply = { status?: number; body: unknown; headers?: Record<string, string> };

export interface RouteOptions {
  // Signed ApiRequest required (default true)
  auth?: boolean;
}

export type Route = (req: Request) => Promise<Reply>;

const json = (status: number, body: unknown, headers: Record<string, string> = {}): APIGatewayProxyResultV2 => ({
  statusCode: status,
  headers: { "content-type": "application/json", ...headers },
  body: JSON.stringify(body, (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
});

const AUTH_STATUS: Record<AuthRejection, number> = {
  missing_signature: 401,
  stale_signature: 401,
  bad_signature: 401,
  signer_mismatch: 401,
};

// One Lambda serves several routes: `routes` is keyed by the API Gateway route key
export function api(routes: Record<string, Route>, options: Record<string, RouteOptions> = {}) {
  return async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
    try {
      const route = routes[event.routeKey];
      if (!route) return json(404, { error: "not_found" });
      const raw = event.body ?? "";
      const rawBody = event.isBase64Encoded ? Buffer.from(raw, "base64") : Buffer.from(raw, "utf8");
      const body = rawBody.toString("utf8");
      if (rawBody.byteLength > MAX_BODY_BYTES) return json(413, { error: "too_large" });
      const { chainId } = await deployment();
      const req: Request = {
        method: event.requestContext.http.method,
        path: event.rawPath,
        route: event.routeKey,
        params: (event.pathParameters ?? {}) as Record<string, string>,
        query: (event.queryStringParameters ?? {}) as Record<string, string>,
        headers: event.headers ?? {},
        body,
        rawBody,
        chainId,
      };
      if (options[event.routeKey]?.auth !== false) {
        const auth = await authenticate({ method: req.method, path: req.path, body, headers: req.headers }, chainId);
        if (!auth.ok) return json(AUTH_STATUS[auth.reason], { error: auth.reason });
        req.signer = auth.signer;
      }
      const reply = await route(req);
      return json(reply.status ?? 200, reply.body, reply.headers);
    } catch (e) {
      if (e instanceof HttpError) return json(e.status, { error: e.code, ...e.extra });
      // The message stays in the logs, never in the reply
      console.error(JSON.stringify({ event: "api_error", route: event.routeKey, error: (e as Error).message }));
      return json(500, { error: "internal" });
    }
  };
}

export function parseJson<T>(req: Request, parse: (v: unknown) => T): T {
  let value: unknown;
  try {
    value = JSON.parse(req.body || "null");
  } catch {
    throw new HttpError(400, "bad_json");
  }
  try {
    return parse(value);
  } catch {
    throw new HttpError(400, "bad_request");
  }
}

export function signerOf(req: Request): Hex {
  if (!req.signer) throw new HttpError(401, "missing_signature");
  return req.signer;
}

// Constant-time comparison of bearer tokens (operator and webhook routes)
export function bearerMatches(req: Request, token: string): boolean {
  const header = req.headers.authorization ?? req.headers.Authorization ?? "";
  const given = Buffer.from(header.replace(/^Bearer\s+/i, ""));
  const expected = Buffer.from(token);
  if (given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given[i]! ^ expected[i]!;
  return diff === 0;
}
