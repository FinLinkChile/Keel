import { blNumberHash, bytes32Text, docsHash } from "@keel/schemas/hash";
import { keccak256, toBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { authenticate } from "../src/auth";
import { checkSplit, parseArbiterArgs, remainingOf } from "./arbiter-resolve";
import { buildAttestation, parseCarrierArgs, parseOnBoard } from "./carrier-attest";
import { accountFromEnv, CliError, signedRequest } from "./cli";

const ORDER = `0x${"ab".repeat(32)}`;
// A well-known test key (anvil account 1); never a real wallet
const KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

const carrierArgv = (...extra: string[]) => ["--order", ORDER, "--bl-number", "HLCU1234567", "--on-board", "2026-10-18T09:30:00Z", "--port", "HKHKG", ...extra];

describe("carrier-attest arguments", () => {
  it("parses the attestation fields", () => {
    const a = parseCarrierArgs(carrierArgv("--docs-hash", `0x${"CD".repeat(32)}`, "--dry-run"));
    expect(a).toMatchObject({ orderId: ORDER, blNumber: "HLCU1234567", port: "HKHKG", dateOnly: false, dryRun: true, docs: { hash: `0x${"cd".repeat(32)}` } });
    expect(a.onBoardDate).toBe(BigInt(Date.UTC(2026, 9, 18, 9, 30) / 1000));
  });

  it("takes unix seconds or an ISO instant, and flags a date alone", () => {
    expect(parseOnBoard("1790000000")).toEqual({ seconds: 1_790_000_000n, dateOnly: false });
    expect(parseOnBoard("2026-10-18")).toEqual({ seconds: BigInt(Date.UTC(2026, 9, 18) / 1000), dateOnly: true });
    expect(() => parseOnBoard("yesterday")).toThrow(CliError);
    expect(() => parseOnBoard(undefined)).toThrow(CliError);
  });

  it("refuses malformed input", () => {
    expect(() => parseCarrierArgs(carrierArgv())).toThrow(/--docs-hash or one --file/);
    expect(() => parseCarrierArgs(carrierArgv("--docs-hash", "0x12", "--file", "a.pdf"))).toThrow(CliError);
    expect(() => parseCarrierArgs(carrierArgv("--docs-hash", "0x12"))).toThrow(/bytes32/);
    expect(() => parseCarrierArgs(["--order", "0x12", ...carrierArgv("--docs-hash", ORDER).slice(2)])).toThrow(/--order/);
    expect(() => parseCarrierArgs(carrierArgv("--docs-hash", ORDER, "--port", "hong kong"))).toThrow(/UN\/LOCODE/);
    expect(() => parseCarrierArgs(carrierArgv("--docs-hash", ORDER, "--bl-number", "hl-1"))).toThrow(/--bl-number/);
    expect(() => parseCarrierArgs(carrierArgv("--docs-hash", ORDER, "--private-key", KEY))).toThrow();
  });

  it("builds the attestation with the schemas helpers", () => {
    const carrier = privateKeyToAccount(KEY).address;
    const files: Record<string, Uint8Array> = { "bl.pdf": toBytes("bill of lading"), "inv.pdf": toBytes("invoice") };
    const a = parseCarrierArgs(carrierArgv("--file", "bl.pdf", "--file", "inv.pdf"));
    const att = buildAttestation(a, carrier, (p) => files[p]!);
    expect(att).toEqual({
      orderId: ORDER,
      blNumberHash: blNumberHash(carrier, "HLCU1234567"),
      onBoardDate: a.onBoardDate,
      portOfLoading: bytes32Text("HKHKG"),
      docsHash: docsHash([keccak256(files["bl.pdf"]!), keccak256(files["inv.pdf"]!)]),
    });
  });
});

describe("arbiter-resolve arguments", () => {
  it("parses the split and checks it against the remaining balance", () => {
    const a = parseArbiterArgs(["--order", ORDER, "--to-importer", "3000", "--to-exporter", "4000"]);
    expect(a).toEqual({ orderId: ORDER, toImporter: 3000n, toExporter: 4000n, dryRun: false });
    // 10,000 with a 30% advance leaves 7,000
    expect(remainingOf({ totalAmount: "10000", advanceBps: 3000 })).toBe(7000n);
    expect(() => checkSplit(a, 7000n)).not.toThrow();
    expect(() => checkSplit(a, 7001n)).toThrow(/remaining balance 7001/);
    expect(() => parseArbiterArgs(["--order", ORDER, "--to-importer", "-1", "--to-exporter", "1"])).toThrow(CliError);
    expect(() => parseArbiterArgs(["--order", ORDER, "--to-importer", "1.5", "--to-exporter", "1"])).toThrow(CliError);
    expect(() => parseArbiterArgs(["--order", ORDER, "--to-importer", "1"])).toThrow(/--to-exporter/);
  });
});

describe("cli", () => {
  it("reads the key from the environment only, without echoing it", () => {
    expect(accountFromEnv("K", { K: KEY }).address).toBe(privateKeyToAccount(KEY).address);
    expect(accountFromEnv("K", { K: KEY.slice(2) }).address).toBe(privateKeyToAccount(KEY).address);
    expect(() => accountFromEnv("K", {})).toThrow("K is not set");
    try {
      accountFromEnv("K", { K: `${KEY}00` });
    } catch (e) {
      expect((e as Error).message).not.toContain(KEY.slice(2));
    }
  });

  it("signs requests the API authenticates", async () => {
    const account = privateKeyToAccount(KEY);
    let seen: { url: string; init: RequestInit } | undefined;
    const fetchFn = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as unknown as typeof fetch;
    const now = 1_790_000_000_000;
    await signedRequest("https://api.example", account, 84532, "POST", "/shipments", { a: 1n }, fetchFn, () => now);
    expect(seen!.url).toBe("https://api.example/shipments");
    expect(seen!.init.body).toBe('{"a":"1"}');
    const auth = await authenticate(
      { method: "POST", path: "/shipments", body: seen!.init.body as string, headers: seen!.init.headers as Record<string, string> },
      84532,
      new Date(now),
    );
    expect(auth).toEqual({ ok: true, signer: account.address });
  });
});
