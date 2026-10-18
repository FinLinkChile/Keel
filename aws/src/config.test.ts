import { GetParametersByPathCommand, type SSMClient } from "@aws-sdk/client-ssm";
import { beforeEach, describe, expect, it } from "vitest";
import { deployment, resetDeploymentCache } from "./config";

const ADDRESS = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;

describe("deployment()", () => {
  beforeEach(resetDeploymentCache);

  it("does not cache a failed read: the next call reads again", async () => {
    let calls = 0;
    const ssm = {
      send: async (c: unknown) => {
        expect(c).toBeInstanceOf(GetParametersByPathCommand);
        if (++calls === 1) throw new Error("ThrottlingException");
        return {
          Parameters: [
            { Name: "/keel/1/chain-id", Value: "1" },
            { Name: "/keel/1/escrow", Value: ADDRESS(1) },
            { Name: "/keel/1/safe", Value: ADDRESS(2) },
          ],
        };
      },
    } as unknown as SSMClient;
    const env = { KEEL_CHAIN_ID: "1" };
    await expect(deployment(env, ssm)).rejects.toThrow("ThrottlingException");
    expect(await deployment(env, ssm)).toMatchObject({ chainId: 1, escrow: ADDRESS(1) });
    // Cached once it works
    await deployment(env, ssm);
    expect(calls).toBe(2);
  });
});
