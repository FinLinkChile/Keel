import { GetParameterCommand, type SSMClient } from "@aws-sdk/client-ssm";
import { beforeEach, describe, expect, it } from "vitest";
import { resetSecretCache, secret, SecretMissingError } from "./secrets";

const env = { KEEL_CHAIN_ID: "84532" };
const ssmThat = (answer: (cmd: GetParameterCommand) => Promise<unknown>) => ({ send: answer }) as unknown as SSMClient;

beforeEach(resetSecretCache);

describe("secret", () => {
  it("reads the SecureString under /keel-secrets/<chainId>/", async () => {
    let asked = "";
    const ssm = ssmThat(async (cmd) => {
      asked = cmd.input.Name!;
      return { Parameter: { Value: "https://rpc.example" } };
    });
    expect(await secret("rpc_url", env, ssm)).toBe("https://rpc.example");
    expect(asked).toBe("/keel-secrets/84532/rpc_url");
  });

  it("a missing parameter names the secret to create, instead of SSM's bare UnknownError", async () => {
    const ssm = ssmThat(async () => {
      throw Object.assign(new Error("UnknownError"), { name: "ParameterNotFound" });
    });
    const failure = secret("rpc_url", env, ssm);
    await expect(failure).rejects.toBeInstanceOf(SecretMissingError);
    await expect(secret("rpc_url", env, ssm)).rejects.toThrow("create the SecureString /keel-secrets/84532/rpc_url");
  });

  it("a placeholder value is missing too, and its value never appears in the error", async () => {
    const ssm = ssmThat(async () => ({ Parameter: { Value: "CAMBIAR" } }));
    await expect(secret("pauser_private_key", env, ssm)).rejects.toThrow("secret pauser_private_key is not loaded");
  });

  it("any other failure passes through unchanged, and a failed read is retried later", async () => {
    let calls = 0;
    const ssm = ssmThat(async () => {
      calls++;
      if (calls === 1) throw Object.assign(new Error("denied"), { name: "AccessDeniedException" });
      return { Parameter: { Value: "ok" } };
    });
    await expect(secret("llm_keys", env, ssm)).rejects.toThrow("denied");
    expect(await secret("llm_keys", env, ssm)).toBe("ok");
  });
});
