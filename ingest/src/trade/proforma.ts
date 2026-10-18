// Proforma reading for Keel Trade. T3.9, issue #59.
// Step 0 of the flow: before the purchase order exists, the importer uploads the exporter's
// proforma from the app and ingest returns its typed fields, so the app can prefill the order
// on the review screen. The people check every field and both parties sign the order; the
// payout address comes from the verified supplier, never from here. Nothing is decided and
// the file is not kept: only its hash and the typed reading, so a repeated upload costs no
// second call to the model.
import { recoverTypedDataAddress, type Hex as ViemHex } from "viem";
import type { Hex } from "@keel/schemas";
import type { AttachmentType, ExtractorProvider } from "../extractor/contract";
import { ExtractionError, extractProforma, MAX_IMAGE_BYTES } from "../extractor";
import { missingFields, type ProformaReading } from "../extractor/proforma";
import { MAX_PDF_BYTES, pdfHeaderOffset } from "../pdf/text";
import type { IngestRepo } from "../repo";
import { fileHash, uploadDomain, UPLOAD_MAX_SKEW_SECONDS } from "./upload";

// Same domain as the document upload; a different primary type, so neither signature can be
// replayed as the other
export const PROFORMA_TYPES = {
  ProformaUpload: [
    { name: "fileHash", type: "bytes32" },
    { name: "issuedAt", type: "uint64" },
  ],
} as const;

export const MAX_PROFORMAS_PER_IMPORTER_PER_DAY = 20;

// The importers' representatives who may upload a proforma. In the prototype: the importer
// uploaders of the orders file plus INGEST_IMPORTERS_FILE.
export interface ImporterRegistry {
  has(address: Hex): boolean | Promise<boolean>;
}

export const staticImporters = (addresses: readonly Hex[]): ImporterRegistry => {
  const set = new Set(addresses.map((a) => a.toLowerCase()));
  return { has: (address) => set.has(address.toLowerCase()) };
};

// The type is read from the bytes, not from what the client declares. HEIC (the iPhone's
// default) is not accepted: the app sends JPEG.
export function sniffMediaType(file: Uint8Array): AttachmentType | undefined {
  const starts = (...bytes: number[]) => bytes.every((b, i) => file[i] === b);
  if (pdfHeaderOffset(file) >= 0) return "application/pdf";
  if (starts(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (starts(0x52, 0x49, 0x46, 0x46) && String.fromCharCode(...file.slice(8, 12)) === "WEBP") return "image/webp";
  return undefined;
}

export const PROFORMA_REJECTIONS = [
  "too_large",
  "unsupported_media",
  "bad_signature",
  "stale_signature",
  "not_an_importer",
  "rate_limited",
] as const;
export type ProformaRejection = (typeof PROFORMA_REJECTIONS)[number];

export interface ProformaRequest {
  issuedAt: number;
  signature: Hex;
  file: Uint8Array;
}

export type ProformaOutcome =
  | { status: "rejected"; reason: ProformaRejection }
  // The model could not read it (refused, invalid output, provider down): the importer fills
  // the order by hand
  | { status: "unreadable"; reason: ExtractionError["reason"]; fileHash: Hex }
  | {
      status: "read";
      fileHash: Hex;
      // "file" when a photo or scan went to the model unredacted
      input: "text" | "file";
      proforma: ProformaReading;
      // Fields the proforma does not print: the importer fills them in
      missing: string[];
    };

// Cheapest checks first: the model is reached only by a signed, fresh, in-limit upload of a
// supported file by a registered importer.
export async function receiveProforma(
  req: ProformaRequest,
  importers: ImporterRegistry,
  extractor: ExtractorProvider,
  opts: { store: IngestRepo; chainId: number; now?: Date },
): Promise<ProformaOutcome> {
  const now = opts.now ?? new Date();
  const mediaType = sniffMediaType(req.file);
  if (!mediaType) return { status: "rejected", reason: "unsupported_media" };
  if (req.file.length > (mediaType === "application/pdf" ? MAX_PDF_BYTES : MAX_IMAGE_BYTES)) {
    return { status: "rejected", reason: "too_large" };
  }
  if (Math.abs(now.getTime() / 1000 - req.issuedAt) > UPLOAD_MAX_SKEW_SECONDS) {
    return { status: "rejected", reason: "stale_signature" };
  }
  const hash = fileHash(req.file);
  let signer: Hex;
  try {
    signer = await recoverTypedDataAddress({
      domain: uploadDomain(opts.chainId),
      types: PROFORMA_TYPES,
      primaryType: "ProformaUpload",
      message: { fileHash: hash, issuedAt: BigInt(req.issuedAt) },
      signature: req.signature as ViemHex,
    });
  } catch {
    return { status: "rejected", reason: "bad_signature" };
  }
  // A file swapped after signing recovers another address and lands here
  if (!(await importers.has(signer))) return { status: "rejected", reason: "not_an_importer" };

  const cached = await opts.store.proformaReading<{ input: "text" | "file"; proforma: ProformaReading }>(signer, hash);
  if (cached) return { status: "read", fileHash: hash, ...cached, missing: missingFields(cached.proforma) };
  if ((await opts.store.proformaUploadsToday(signer)) >= MAX_PROFORMAS_PER_IMPORTER_PER_DAY) {
    return { status: "rejected", reason: "rate_limited" };
  }
  await opts.store.recordProformaUpload(signer, hash);

  try {
    const { reading, input } = await extractProforma(req.file, mediaType, extractor);
    await opts.store.saveProformaReading(signer, hash, { input, proforma: reading });
    return { status: "read", fileHash: hash, input, proforma: reading, missing: missingFields(reading) };
  } catch (e) {
    if (e instanceof ExtractionError) return { status: "unreadable", reason: e.reason, fileHash: hash };
    throw e;
  }
}
