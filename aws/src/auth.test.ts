import { API_HEADERS, type Hex } from "@keel/schemas";
import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { apiRequestTypedData, authenticate, represents } from "./auth";

const alice = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const bob = privateKeyToAccount("0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba");
const CHAIN = 84532;
const NOW = new Date("2026-10-18T12:00:00Z");
const T = Math.floor(NOW.getTime() / 1000);

async function signed(method: string, path: string, body: string, opts: { issuedAt?: number; signer?: typeof alice; claimed?: Hex } = {}) {
  const issuedAt = opts.issuedAt ?? T;
  const who = opts.signer ?? alice;
  const signature = await who.signTypedData(apiRequestTypedData(CHAIN, method, path, body, issuedAt));
  return {
    method,
    path,
    body,
    headers: { [API_HEADERS.signer]: opts.claimed ?? who.address, [API_HEADERS.signature]: signature, [API_HEADERS.issuedAt]: String(issuedAt) },
  };
}

describe("authenticate", () => {
  it("accepts a fresh signature and returns the signer", async () => {
    expect(await authenticate(await signed("POST", "/proposals", '{"a":1}'), CHAIN, NOW)).toEqual({ ok: true, signer: alice.address });
  });

  it("rejects a body changed after signing", async () => {
    const req = await signed("POST", "/proposals", '{"a":1}');
    expect(await authenticate({ ...req, body: '{"a":2}' }, CHAIN, NOW)).toEqual({ ok: false, reason: "signer_mismatch" });
  });

  it("rejects a signature replayed on another path", async () => {
    const req = await signed("POST", "/orders/0x1/approve-balance", "{}");
    expect(await authenticate({ ...req, path: "/orders/0x2/approve-balance" }, CHAIN, NOW)).toMatchObject({ ok: false });
  });

  it("rejects an old signature", async () => {
    expect(await authenticate(await signed("GET", "/orders", "", { issuedAt: T - 301 }), CHAIN, NOW)).toEqual({ ok: false, reason: "stale_signature" });
  });

  it("rejects a signer that claims to be someone else", async () => {
    expect(await authenticate(await signed("GET", "/orders", "", { signer: bob, claimed: alice.address }), CHAIN, NOW)).toEqual({ ok: false, reason: "signer_mismatch" });
  });

  it("rejects a signature for another chain", async () => {
    expect(await authenticate(await signed("GET", "/orders", ""), 1, NOW)).toMatchObject({ ok: false });
  });

  it("asks for the headers", async () => {
    expect(await authenticate({ method: "GET", path: "/orders", body: "", headers: {} }, CHAIN, NOW)).toEqual({ ok: false, reason: "missing_signature" });
  });
});

describe("represents", () => {
  it("accepts the party itself or a registered representative", () => {
    const safe = "0x366E72921895dBFD7688822418BE43E02551Ee82";
    expect(represents(alice.address, alice.address)).toBe(true);
    expect(represents(alice.address, safe, [alice.address.toLowerCase()])).toBe(true);
    expect(represents(bob.address, safe, [alice.address])).toBe(false);
  });
});
