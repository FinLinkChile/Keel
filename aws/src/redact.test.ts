import { describe, expect, it } from "vitest";
import { redactedError, redactUrls, safeMessage } from "./redact";

const viemError = Object.assign(new Error("HTTP request failed.\n\nURL: https://base-sepolia.g.alchemy.com/v2/SECRETKEY\nRequest body: {}"), {
  name: "HttpRequestError",
  shortMessage: "HTTP request failed.",
});

describe("redaction", () => {
  it("removes every URL from a text", () => {
    expect(redactUrls("a https://x.io/v2/KEY?k=1 b wss://y.io/KEY2")).toBe("a [redacted-url] b [redacted-url]");
  });

  it("prefers the short message of a viem error and strips URLs from any other", () => {
    expect(safeMessage(viemError)).toBe("HTTP request failed.");
    expect(safeMessage(new Error("fetch failed for https://rpc.example/KEY"))).toBe("fetch failed for [redacted-url]");
    expect(safeMessage("plain https://rpc.example/KEY")).toBe("plain [redacted-url]");
  });

  it("rebuilds an error without a URL in its message or stack, keeping its name", () => {
    const out = redactedError(new Error("boom https://rpc.example/KEY"));
    expect(`${out.message}\n${out.stack}`).not.toContain("KEY");
    expect(redactedError(viemError).name).toBe("HttpRequestError");
  });
});
