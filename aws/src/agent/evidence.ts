// PDR evidence on S3: the same JSON `keel verify` reads from evidence/pdr/ (engine/src/pdr.ts,
// bigints as strings), one object per PDR at pdr/<pdrHash>.json. The agent awaits the write before
// it sends the call that carries the PDR (AgentDeps.saveEvidence), so a PDR never reaches the chain
// without its evidence; the monitor asks here whether the engine issued a hash it sees on chain.
// The key is the PDR hash, so a retry rewrites the same decision; whether older versions are kept
// is the bucket's configuration (infra), not something this code guarantees.
import { HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import type { Hex } from "@keel/schemas";
import { type PdrEvidence, serializeEvidence } from "@keel/engine";
import { type Sender, s3Client } from "./clients";

export const evidenceKey = (pdrHash: Hex) => `pdr/${pdrHash.toLowerCase()}.json`;

export function s3Evidence(bucket: string, client: Sender = s3Client()): (evidence: PdrEvidence) => Promise<void> {
  return async (evidence) => {
    await client.send(
      new PutObjectCommand({ Bucket: bucket, Key: evidenceKey(evidence.pdrHash), Body: serializeEvidence(evidence), ContentType: "application/json" }),
    );
  };
}

// Whether the engine issued this PDR. Only a missing object is "no": any other failure throws,
// so an S3 outage never turns every legitimate PDR into an incident that pauses the gate.
export function s3EvidenceExists(bucket: string, client: Sender = s3Client()): (hash: Hex) => Promise<boolean> {
  return async (hash) => {
    try {
      await client.send(new HeadObjectCommand({ Bucket: bucket, Key: evidenceKey(hash) }));
      return true;
    } catch (e) {
      const err = e as { name?: string; $metadata?: { httpStatusCode?: number } };
      if (err.name === "NotFound" || err.name === "NoSuchKey" || err.$metadata?.httpStatusCode === 404) return false;
      throw e;
    }
  };
}
