// An in-memory documents bucket for tests. A presigned URL is honoured the way S3 honours the
// real one: one key, exactly the signed length, until it expires.
import type { DocumentObjects } from "../ingest/objects";

export interface FakeObjects extends DocumentObjects {
  readonly objects: Map<string, Uint8Array>;
  // What a client does with a presigned URL. Throws like S3 refuses: unknown, expired or wrong length.
  clientPut(url: string, bytes: Uint8Array, nowSeconds?: number): string;
}

export function fakeObjects(clock: () => number = () => Date.now()): FakeObjects {
  const objects = new Map<string, Uint8Array>();
  const grants = new Map<string, { length: number; expires: number }>();
  let n = 0;
  return {
    objects,
    async presignPut(key, contentLength, expiresIn) {
      const token = `t${n++}`;
      grants.set(token, { length: contentLength, expires: Math.floor(clock() / 1000) + expiresIn });
      return `https://docs.example/${key}?X-Amz-Expires=${expiresIn}&X-Amz-SignedHeaders=content-length%3Bhost&token=${token}`;
    },
    clientPut(url, bytes, nowSeconds = Math.floor(clock() / 1000)) {
      const u = new URL(url);
      const grant = grants.get(u.searchParams.get("token") ?? "");
      if (!grant) throw new Error("SignatureDoesNotMatch");
      if (nowSeconds > grant.expires) throw new Error("AccessDenied: request has expired");
      if (bytes.byteLength !== grant.length) throw new Error("SignatureDoesNotMatch: content-length");
      const key = decodeURIComponent(u.pathname.slice(1));
      objects.set(key, bytes);
      return key;
    },
    async get(key, maxBytes) {
      const b = objects.get(key);
      if (!b) return undefined;
      return b.byteLength > maxBytes ? { size: b.byteLength } : { size: b.byteLength, bytes: b };
    },
    async put(key, body) {
      objects.set(key, body);
    },
    async delete(key) {
      objects.delete(key);
    },
  };
}
