import { secp256k1 } from "@noble/curves/secp256k1";
import { GetPublicKeyCommand, SignCommand } from "@aws-sdk/client-kms";
import { EIP712_TYPES, type Hex } from "@keel/schemas";
import { KeyError } from "@keel/engine";
import { describe, expect, it } from "vitest";
import { parseTransaction, recoverTransactionAddress, recoverTypedDataAddress, toHex, verifyMessage } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { kmsAccount, parseDerSignature, publicKeyFromSpki, toLowS } from "./kms";
import { loadKeys, restrictToPdr } from "./keys";

const N = secp256k1.CURVE.n;
const PRIV = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as Hex;

// SubjectPublicKeyInfo of a secp256k1 key, as KMS returns it
const SPKI_PREFIX = "3056301006072a8648ce3d020106052b8104000a034200";
function spkiOf(priv: Hex): Uint8Array {
  const point = secp256k1.getPublicKey(priv.slice(2), false);
  return new Uint8Array([...Buffer.from(SPKI_PREFIX, "hex"), ...point]);
}

// A fake KMS for one key. `highS` returns n - s, as a real KMS does about half the time.
function fakeKms(priv: Hex, { highS = false, otherKey }: { highS?: boolean; otherKey?: Hex } = {}) {
  const calls: string[] = [];
  return {
    calls,
    send: async (cmd: unknown) => {
      if (cmd instanceof GetPublicKeyCommand) {
        calls.push("GetPublicKey");
        return { PublicKey: spkiOf(priv), KeySpec: "ECC_SECG_P256K1" };
      }
      if (cmd instanceof SignCommand) {
        calls.push("Sign");
        expect(cmd.input.MessageType).toBe("DIGEST");
        const digest = cmd.input.Message as Uint8Array;
        const sig = secp256k1.sign(digest, (otherKey ?? priv).slice(2), { lowS: true });
        const s = highS ? N - sig.s : sig.s;
        return { Signature: new secp256k1.Signature(sig.r, s).toDERRawBytes() };
      }
      throw new Error("unexpected command");
    },
  };
}

describe("DER and public key parsing", () => {
  it("reads r and s from a DER signature", () => {
    const sig = secp256k1.sign(new Uint8Array(32).fill(7), PRIV.slice(2));
    expect(parseDerSignature(sig.toDERRawBytes())).toEqual({ r: sig.r, s: sig.s });
  });

  it("folds a high s to the lower half", () => {
    expect(toLowS(N - 5n)).toBe(5n);
    expect(toLowS(5n)).toBe(5n);
  });

  it("takes the point from the SPKI", () => {
    expect(publicKeyFromSpki(spkiOf(PRIV))).toBe(toHex(secp256k1.getPublicKey(PRIV.slice(2), false)));
  });
});

describe("kmsAccount", () => {
  const local = privateKeyToAccount(PRIV);

  it("has the address of the key", async () => {
    const account = await kmsAccount({ client: fakeKms(PRIV), keyId: "k" });
    expect(account.address).toBe(local.address);
  });

  for (const highS of [false, true]) {
    it(`signs typed data exactly like the local key (${highS ? "high" : "low"} s from KMS)`, async () => {
      const account = await kmsAccount({ client: fakeKms(PRIV, { highS }), keyId: "k" });
      const typedData = {
        domain: { name: "Keel", version: "1", chainId: 84532 },
        types: { Mail: [{ name: "contents", type: "string" }] },
        primaryType: "Mail" as const,
        message: { contents: "hello" },
      };
      // RFC 6979 is deterministic: the same key and digest give the same signature
      expect(await account.signTypedData(typedData)).toBe(await local.signTypedData(typedData));
      expect(await recoverTypedDataAddress({ ...typedData, signature: await account.signTypedData(typedData) })).toBe(local.address);
    });
  }

  it("signs a transaction the network accepts", async () => {
    const account = await kmsAccount({ client: fakeKms(PRIV, { highS: true }), keyId: "k" });
    const tx = { chainId: 84532, nonce: 3, to: local.address, value: 1n, gas: 21000n, maxFeePerGas: 2n, maxPriorityFeePerGas: 1n, type: "eip1559" as const };
    const signed = await account.signTransaction(tx);
    expect(signed).toBe(await local.signTransaction(tx));
    expect(await recoverTransactionAddress({ serializedTransaction: signed as never })).toBe(local.address);
    expect(parseTransaction(signed).nonce).toBe(3);
  });

  it("signs a message", async () => {
    const account = await kmsAccount({ client: fakeKms(PRIV), keyId: "k" });
    const signature = await account.signMessage({ message: "keel" });
    expect(await verifyMessage({ address: local.address, message: "keel", signature })).toBe(true);
  });

  it("fails when KMS signs with another key", async () => {
    const other = "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba" as Hex;
    const account = await kmsAccount({ client: fakeKms(PRIV, { otherKey: other }), keyId: "k" });
    await expect(account.signMessage({ message: "x" })).rejects.toThrow(/does not recover/);
  });
});

describe("policy key on KMS", () => {
  it("signs a PolicyDecision and refuses anything else", async () => {
    const signer = restrictToPdr(await kmsAccount({ client: fakeKms(PRIV), keyId: "k" }));
    const order = {
      domain: { name: "Keel", version: "1", chainId: 84532 },
      types: EIP712_TYPES,
      primaryType: "PurchaseOrder",
      message: {},
    };
    expect(() => signer.signTypedData(order as never)).toThrow(KeyError);
  });

  it("loadKeys rejects one key for two roles, whatever the source", async () => {
    const kms = fakeKms(PRIV);
    const env = { KEY_SOURCE_RELAYER: "kms", RELAYER_KEY_ID: "a", KEY_SOURCE_POLICY_SIGNER: "ssm" };
    await expect(loadKeys(["relayer", "policySigner"], { env, kms, readSecret: async () => PRIV })).rejects.toThrow(/same key/);
  });

  it("loadKeys rejects a policy key that is not the registered signer", async () => {
    const env = { KEY_SOURCE_POLICY_SIGNER: "kms", POLICY_KEY_ID: "p" };
    await expect(loadKeys(["policySigner"], { env, kms: fakeKms(PRIV) }, "0x0000000000000000000000000000000000000001")).rejects.toThrow(/registered/);
  });

  it("loadKeys reads an SSM key through the engine loaders", async () => {
    const env = { KEY_SOURCE_RELAYER: "ssm" };
    const keys = await loadKeys(["relayer"], { env, readSecret: async (name) => (name === "relayer_private_key" ? PRIV : "") });
    expect(keys.relayer?.address).toBe(privateKeyToAccount(PRIV).address);
  });
});
