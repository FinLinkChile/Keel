import type { RequiredDocType } from '@keel/schemas';

import { MAX_UPLOAD_BYTES } from '../ingest/client';

// What the exporter sees before signing an upload: the file as the phone has it, read locally.
// Nothing here comes from ingest.

const DOC_NAMES: Record<RequiredDocType, string> = {
  BILL_OF_LADING: 'Bill of lading',
  AIR_WAYBILL: 'Air waybill',
  COMMERCIAL_INVOICE: 'Commercial invoice',
};

// 1234567 -> "1.2 MB", 250000 -> "244 KB", 900 -> "900 B"
export function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

// Pages of a PDF, only when they can be counted without guessing. It counts the page objects
// and checks them against the /Count of the page tree; a file that hides its objects in
// compressed streams, or whose two numbers disagree, gives undefined.
export function countPdfPages(bytes: Uint8Array): number | undefined {
  let text = '';
  // Latin-1 keeps one character per byte, in chunks to stay under the argument limit
  for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192));
  if (/\/ObjStm\b/.test(text)) return undefined;
  const leaves = text.match(/\/Type\s*\/Page(?![A-Za-z])/g)?.length ?? 0;
  // The root of the page tree is the node with the highest /Count
  const counts = [...text.matchAll(/\/Type\s*\/Pages\b[^>]*?\/Count\s+(\d+)|\/Count\s+(\d+)[^>]*?\/Type\s*\/Pages\b/g)].map((m) => Number(m[1] ?? m[2]));
  const root = counts.length > 0 ? Math.max(...counts) : 0;
  return leaves > 0 && leaves === root ? leaves : undefined;
}

export type UploadPreview = {
  // "Bill of lading for PO-0142"
  title: string;
  fileName: string;
  // "1.2 MB, 3 pages"
  details: string;
  // The file is over the limit and must not be confirmed
  tooLarge: boolean;
};

export function uploadPreview(docType: RequiredDocType, orderLabel: string, file: { name: string; bytes: Uint8Array }): UploadPreview {
  const pages = countPdfPages(file.bytes);
  const parts = [formatSize(file.bytes.byteLength)];
  if (pages !== undefined) parts.push(pages === 1 ? '1 page' : `${pages} pages`);
  return {
    title: `${DOC_NAMES[docType]} for ${orderLabel}`,
    fileName: file.name,
    details: parts.join(', '),
    tooLarge: file.bytes.byteLength > MAX_UPLOAD_BYTES,
  };
}
