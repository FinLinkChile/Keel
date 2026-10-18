import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetDeploymentCache } from "./config";
import { api, MAX_BODY_BYTES } from "./http";

const event = (body: string, isBase64Encoded = false) =>
  ({ routeKey: "POST /x", rawPath: "/x", body, isBase64Encoded, headers: {}, requestContext: { http: { method: "POST" } } }) as never;

describe("api body limit", () => {
  const handler = api({ "POST /x": async () => ({ body: { ok: true } }) }, { "POST /x": { auth: false } });
  const env = { ...process.env };
  beforeEach(() => {
    process.env.KEEL_CONFIG_PREFIX = "/none/";
    resetDeploymentCache();
  });
  afterEach(() => {
    process.env = { ...env };
  });

  it("fits a synchronous Lambda payload: 5.5 MB, under the 6 MB limit with its envelope", () => {
    expect(MAX_BODY_BYTES).toBe(Math.floor(5.5 * 1024 * 1024));
    expect(MAX_BODY_BYTES).toBeLessThan(6 * 1024 * 1024);
  });

  it("answers 413 too_large above the limit, for text and for base64 bodies", async () => {
    const big = "a".repeat(MAX_BODY_BYTES + 1);
    expect(await handler(event(big))).toMatchObject({ statusCode: 413, body: JSON.stringify({ error: "too_large" }) });
    expect(await handler(event(Buffer.from(big).toString("base64"), true))).toMatchObject({ statusCode: 413 });
  });
});
