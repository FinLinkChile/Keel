// The documents bucket (DOCS_BUCKET), behind a port so the handlers are tested without S3.
//   orders/<orderId>/<fileHash>   a Keel Trade document; the key is the identity the uploader signed
//   inbound/<messageHash>.eml     a raw inbound email, as the forwarder posted it
// Objects arrive through a presigned PUT that fixes the key and the exact length; nothing in S3
// checks the content, so the reader recomputes keccak256 before reading (handlers/extractor.ts).
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Hex } from "@keel/schemas";

export interface DocumentObjects {
  // A URL that accepts one PUT of exactly `contentLength` bytes to `key`, for `expiresIn` seconds
  presignPut(key: string, contentLength: number, expiresIn: number): Promise<string>;
  // undefined if there is no such object; `bytes` only when it is at most maxBytes
  get(key: string, maxBytes: number): Promise<{ size: number; bytes?: Uint8Array } | undefined>;
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export const documentKey = (orderId: Hex, fileHash: Hex) => `orders/${orderId.toLowerCase()}/${fileHash.toLowerCase()}`;
export const inboundKey = (messageHash: string) => `inbound/${messageHash}.eml`;

// The inverse of documentKey, or undefined for any other key
export function parseDocumentKey(key: string): { orderId: Hex; fileHash: Hex } | undefined {
  const m = /^orders\/(0x[0-9a-f]{64})\/(0x[0-9a-f]{64})$/.exec(key);
  return m ? { orderId: m[1] as Hex, fileHash: m[2] as Hex } : undefined;
}

// Flexible checksums only when required: otherwise the SDK signs a checksum of the empty body
// into the presigned URL, and every upload of a real file fails
export const S3_CLIENT_CONFIG = { requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED" } as const;

export function s3Objects(bucket: string, client?: S3Client): DocumentObjects {
  const s3 = client ?? new S3Client(S3_CLIENT_CONFIG);
  return {
    presignPut(key, contentLength, expiresIn) {
      return getSignedUrl(s3, new PutObjectCommand({ Bucket: bucket, Key: key, ContentLength: contentLength }), {
        expiresIn,
        // Signed, so S3 refuses a body of any other length
        signableHeaders: new Set(["content-length"]),
      });
    },
    async get(key, maxBytes) {
      try {
        const r = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        const size = Number(r.ContentLength ?? 0);
        if (size > maxBytes || !r.Body) {
          r.Body?.transformToWebStream().cancel().catch(() => {});
          return { size };
        }
        return { size, bytes: await r.Body.transformToByteArray() };
      } catch (e) {
        if ((e as { name?: string }).name === "NoSuchKey") return undefined;
        throw e;
      }
    },
    async put(key, body, contentType) {
      await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }));
    },
    async delete(key) {
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  };
}
