// A viem account whose private key never leaves AWS KMS (key spec ECC_SECG_P256K1, usage
// SIGN_VERIFY). KMS signs a 32-byte digest and returns a DER signature without the recovery id,
// and with an s that may be in the upper half of the curve order. Ethereum needs low s (EIP-2)
// and the recovery bit, so both are fixed here: s is folded to n - s and the parity is the one
// whose recovered address is the key's address.
import { GetPublicKeyCommand, type KMSClient, SignCommand } from "@aws-sdk/client-kms";
import {
  type Hex,
  hashMessage,
  hashTypedData,
  keccak256,
  type LocalAccount,
  recoverAddress,
  type SerializeTransactionFn,
  serializeSignature,
  serializeTransaction,
  type Signature,
  toHex,
} from "viem";
import { publicKeyToAddress, toAccount } from "viem/accounts";

// Order of the secp256k1 group
const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const HALF_N = N >> 1n;

export class KmsSignerError extends Error {}

// SubjectPublicKeyInfo DER of an EC key: the point is the BIT STRING at the end, 0x04 || x || y
export function publicKeyFromSpki(spki: Uint8Array): Hex {
  if (spki.length < 65) throw new KmsSignerError("public key too short");
  const point = spki.slice(spki.length - 65);
  if (point[0] !== 0x04) throw new KmsSignerError("public key is not an uncompressed secp256k1 point");
  return toHex(point);
}

// DER: 0x30 len 0x02 lenR R 0x02 lenS S
export function parseDerSignature(der: Uint8Array): { r: bigint; s: bigint } {
  let i = 0;
  const expect = (byte: number) => {
    if (der[i++] !== byte) throw new KmsSignerError("malformed DER signature");
  };
  const length = () => {
    let len = der[i++]!;
    if (len & 0x80) {
      const bytes = len & 0x7f;
      len = 0;
      for (let k = 0; k < bytes; k++) len = (len << 8) | der[i++]!;
    }
    return len;
  };
  const integer = () => {
    expect(0x02);
    const len = length();
    const value = der.slice(i, i + len);
    i += len;
    return BigInt(toHex(value));
  };
  expect(0x30);
  length();
  const r = integer();
  const s = integer();
  return { r, s };
}

export const toLowS = (s: bigint) => (s > HALF_N ? N - s : s);

const word = (n: bigint): Hex => toHex(n, { size: 32 });

export interface KmsKey {
  client: Pick<KMSClient, "send">;
  keyId: string;
}

// Address of a KMS key, from its public key
export async function kmsAddress({ client, keyId }: KmsKey): Promise<Hex> {
  const out = await client.send(new GetPublicKeyCommand({ KeyId: keyId }));
  if (!out.PublicKey) throw new KmsSignerError("KMS returned no public key");
  if (out.KeySpec && out.KeySpec !== "ECC_SECG_P256K1") throw new KmsSignerError(`key spec ${out.KeySpec} is not secp256k1`);
  return publicKeyToAddress(publicKeyFromSpki(out.PublicKey));
}

// Signs a 32-byte digest with KMS and returns an Ethereum signature (low s, yParity)
export async function signDigest(key: KmsKey, address: Hex, digest: Hex): Promise<Signature> {
  const out = await key.client.send(
    new SignCommand({
      KeyId: key.keyId,
      Message: Buffer.from(digest.slice(2), "hex"),
      MessageType: "DIGEST",
      SigningAlgorithm: "ECDSA_SHA_256",
    }),
  );
  if (!out.Signature) throw new KmsSignerError("KMS returned no signature");
  const { r, s: rawS } = parseDerSignature(out.Signature);
  const s = toLowS(rawS);
  for (const yParity of [0, 1] as const) {
    const signature = { r: word(r), s: word(s), yParity, v: yParity === 0 ? 27n : 28n };
    const recovered = await recoverAddress({ hash: digest, signature });
    if (recovered.toLowerCase() === address.toLowerCase()) return signature;
  }
  // A key id that points at another key, or a corrupted signature
  throw new KmsSignerError("the KMS signature does not recover to the key address");
}

// A viem LocalAccount backed by KMS: it signs transactions, typed data and messages
export async function kmsAccount(key: KmsKey): Promise<LocalAccount> {
  const address = await kmsAddress(key);
  return toAccount({
    address,
    async signMessage({ message }) {
      return serializeSignature(await signDigest(key, address, hashMessage(message)));
    },
    async signTypedData(typedData) {
      return serializeSignature(await signDigest(key, address, hashTypedData(typedData as never)));
    },
    async signTransaction(transaction, options) {
      const serializer = (options?.serializer ?? serializeTransaction) as SerializeTransactionFn;
      const hash = keccak256(await serializer(transaction));
      return serializer(transaction, await signDigest(key, address, hash));
    },
  });
}
