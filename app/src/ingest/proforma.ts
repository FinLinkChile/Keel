import { CURRENCIES, INCOTERMS, type Currency, type Hex, type Incoterm } from '@keel/schemas';
import { keccak256 } from 'viem';

import type { Signer } from '../wallet/signer';

import { toBase64 } from './base64';
import { uploadDomain } from './upload';

// Reading of the exporter's proforma by ingest: POST {ingestUrl}/trade/proforma (interface in
// docs/interfaces/lectura-de-proforma.md, ingest/src/trade/proforma.ts). The reading only prefills
// the order on the review screen; the payout address never comes from it.

// Copy of ingest's PROFORMA_TYPES; a test compares both. Same domain as the document upload, a
// different primary type, so neither signature can be replayed as the other.
export const PROFORMA_TYPES = {
  ProformaUpload: [
    { name: 'fileHash', type: 'bytes32' },
    { name: 'issuedAt', type: 'uint64' },
  ],
} as const;

// A type, not an interface, so it fits the Signer message type
export type ProformaUpload = {
  // keccak256 of the exact bytes that are sent
  fileHash: Hex;
  // Unix seconds; ingest accepts it within 10 minutes of its clock
  issuedAt: bigint;
};

// Same limits as ingest, checked before signing and sending
export const MAX_PROFORMA_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_PROFORMA_PDF_BYTES = 10 * 1024 * 1024;

export type ProformaMediaType = 'application/pdf' | 'image/jpeg' | 'image/png' | 'image/webp';

// The type is read from the bytes, the way ingest does. HEIC is not accepted: the picker sends JPEG.
export function sniffMediaType(file: Uint8Array): ProformaMediaType | undefined {
  const starts = (...bytes: number[]) => bytes.every((b, i) => file[i] === b);
  if (starts(0x25, 0x50, 0x44, 0x46, 0x2d)) return 'application/pdf';
  if (starts(0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  if (starts(0x52, 0x49, 0x46, 0x46) && String.fromCharCode(...file.slice(8, 12)) === 'WEBP') return 'image/webp';
  return undefined;
}

export type ProformaRejection =
  | 'too_large'
  | 'unsupported_media'
  | 'bad_signature'
  | 'stale_signature'
  | 'not_an_importer'
  | 'rate_limited'
  | 'invalid_request';

const REJECTIONS: readonly ProformaRejection[] = [
  'too_large',
  'unsupported_media',
  'bad_signature',
  'stale_signature',
  'not_an_importer',
  'rate_limited',
  'invalid_request',
];

// Typed fields only, as ingest returns them. A field the proforma does not print is null (or an
// empty list) and is in `missing`.
export type ProformaFields = {
  proforma_number: string | null;
  // Unix seconds, midnight UTC
  issue_date: number | null;
  currency: Currency | null;
  // Currency cents (2 decimals), not token units
  amount_minor: number | null;
  incoterm: Incoterm | null;
  hs_codes: string[];
  latest_shipment_date: number | null;
  // UN/LOCODE; display only
  port_of_loading: string | null;
  port_of_discharge: string | null;
  // Basis points: 3000 = 30%
  advance_bps: number | null;
};

export type ProformaField = keyof ProformaFields;

// The fields of a reading, to count how many the agent read
export const PROFORMA_FIELDS: readonly ProformaField[] = [
  'proforma_number',
  'issue_date',
  'currency',
  'amount_minor',
  'incoterm',
  'hs_codes',
  'latest_shipment_date',
  'port_of_loading',
  'port_of_discharge',
  'advance_bps',
];

// Warnings for the review screen. They never fill a field.
export type ProformaReading = {
  fileHash: Hex;
  input: 'text' | 'file';
  proforma: ProformaFields;
  missing: ProformaField[];
  mentionsAccountChange: boolean;
  hiddenTextDetected: boolean;
};

// Only the outcome and the typed reading. The reason ingest gives for an unreadable file and any
// other field are dropped here; no free text ever reaches a screen.
export type ProformaResult =
  | ({ kind: 'read' } & ProformaReading)
  | { kind: 'unreadable'; fileHash: Hex }
  | { kind: 'rejected'; reason: ProformaRejection }
  | { kind: 'failed'; reason: 'not_configured' | 'network' | 'server' };

const FAILED: ProformaResult = { kind: 'failed', reason: 'server' };

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const hasOnly = (o: Obj, keys: readonly string[]) => Object.keys(o).length === keys.length && keys.every((k) => k in o);
const isUnix = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const isText = (v: unknown, pattern: RegExp): v is string => typeof v === 'string' && pattern.test(v);
const nullable = <T>(v: unknown, ok: (v: unknown) => v is T): v is T | null => v === null || ok(v);

const HASH = /^0x[0-9a-f]{64}$/i;
// The shapes ingest normalizes to: compact reference, HS digits, UN/LOCODE
const REFERENCE = /^[A-Z0-9]{1,20}$/;
const HS_CODE = /^[0-9]{6,10}$/;
const LOCODE = /^[A-Z]{2}[A-Z0-9]{3}$/;
const MAX_HS_CODES = 20;

const isCurrency = (v: unknown): v is Currency => (CURRENCIES as readonly unknown[]).includes(v);
const isIncoterm = (v: unknown): v is Incoterm => (INCOTERMS as readonly unknown[]).includes(v);
const isField = (v: unknown): v is ProformaField => (PROFORMA_FIELDS as readonly unknown[]).includes(v);
const isReference = (v: unknown): v is string => isText(v, REFERENCE);
const isLocode = (v: unknown): v is string => isText(v, LOCODE);
const isBps = (v: unknown): v is number => isUnix(v) && v <= 10_000;

// Strict: any missing, extra or mistyped field makes the whole reading unusable.
function readFields(p: unknown): ProformaFields | undefined {
  if (!isObj(p) || !hasOnly(p, [...PROFORMA_FIELDS, 'mentions_account_change', 'hidden_text_detected'])) return undefined;
  if (typeof p.mentions_account_change !== 'boolean' || typeof p.hidden_text_detected !== 'boolean') return undefined;
  const hs = p.hs_codes;
  if (!Array.isArray(hs) || hs.length > MAX_HS_CODES || !hs.every((c) => isText(c, HS_CODE))) return undefined;
  if (
    !nullable(p.proforma_number, isReference) ||
    !nullable(p.issue_date, isUnix) ||
    !nullable(p.currency, isCurrency) ||
    !nullable(p.amount_minor, isUnix) ||
    !nullable(p.incoterm, isIncoterm) ||
    !nullable(p.latest_shipment_date, isUnix) ||
    !nullable(p.port_of_loading, isLocode) ||
    !nullable(p.port_of_discharge, isLocode) ||
    !nullable(p.advance_bps, isBps)
  ) {
    return undefined;
  }
  return {
    proforma_number: p.proforma_number,
    issue_date: p.issue_date,
    currency: p.currency,
    amount_minor: p.amount_minor,
    incoterm: p.incoterm,
    hs_codes: hs,
    latest_shipment_date: p.latest_shipment_date,
    port_of_loading: p.port_of_loading,
    port_of_discharge: p.port_of_discharge,
    advance_bps: p.advance_bps,
  };
}

// Reads the HTTP status and the body into a result. Anything that is not exactly what the
// interface describes is a server failure.
export function readProformaResponse(httpStatus: number, body: unknown): ProformaResult {
  if (!isObj(body)) return FAILED;
  if (httpStatus === 200) {
    if (body.status === 'unreadable') {
      if (!hasOnly(body, ['status', 'reason', 'fileHash']) || typeof body.reason !== 'string') return FAILED;
      return isText(body.fileHash, HASH) ? { kind: 'unreadable', fileHash: body.fileHash as Hex } : FAILED;
    }
    if (body.status !== 'read' || !hasOnly(body, ['status', 'fileHash', 'input', 'proforma', 'missing'])) return FAILED;
    if (!isText(body.fileHash, HASH) || (body.input !== 'text' && body.input !== 'file')) return FAILED;
    if (!Array.isArray(body.missing) || !body.missing.every(isField)) return FAILED;
    const fields = readFields(body.proforma);
    if (!fields) return FAILED;
    const p = body.proforma as Obj;
    return {
      kind: 'read',
      fileHash: body.fileHash as Hex,
      input: body.input,
      proforma: fields,
      missing: body.missing,
      mentionsAccountChange: p.mentions_account_change as boolean,
      hiddenTextDetected: p.hidden_text_detected as boolean,
    };
  }
  if (httpStatus === 413) return { kind: 'rejected', reason: 'too_large' };
  if (httpStatus === 415) return { kind: 'rejected', reason: 'unsupported_media' };
  // A refusal comes as { status: 'rejected', reason }; a malformed request as { error }
  const reason = (body.reason ?? body.error) as ProformaRejection;
  if (httpStatus >= 400 && httpStatus < 500 && REJECTIONS.includes(reason)) return { kind: 'rejected', reason };
  return FAILED;
}

type Read = {
  ingestUrl: string | undefined;
  chainId: number | undefined;
  signer: Signer;
  file: Uint8Array;
  now?: () => number;
  fetchFn?: typeof fetch;
};

// Signs the exact bytes and sends those same bytes. issuedAt goes as a number in the JSON and as
// a uint64 (bigint) in the signed message. No auth header: the signature is the authentication.
export async function readProforma({ ingestUrl, chainId, signer, file, now = Date.now, fetchFn = fetch }: Read): Promise<ProformaResult> {
  if (!ingestUrl || !chainId) return { kind: 'failed', reason: 'not_configured' };
  const mediaType = sniffMediaType(file);
  if (!mediaType) return { kind: 'rejected', reason: 'unsupported_media' };
  if (file.byteLength > (mediaType === 'application/pdf' ? MAX_PROFORMA_PDF_BYTES : MAX_PROFORMA_IMAGE_BYTES)) {
    return { kind: 'rejected', reason: 'too_large' };
  }

  const issuedAt = Math.floor(now() / 1000);
  const message: ProformaUpload = { fileHash: keccak256(file), issuedAt: BigInt(issuedAt) };
  const signature = await signer.signTypedData(uploadDomain(chainId), PROFORMA_TYPES, 'ProformaUpload', message);

  let res: Response;
  try {
    res = await fetchFn(`${ingestUrl.replace(/\/+$/, '')}/trade/proforma`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ issuedAt, signature, file: toBase64(file) }),
    });
  } catch {
    return { kind: 'failed', reason: 'network' };
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = undefined;
  }
  const result = readProformaResponse(res.status, body);
  // The reading must be of the file that was signed: its hash can become the order's documentHash
  if ((result.kind === 'read' || result.kind === 'unreadable') && result.fileHash.toLowerCase() !== message.fileHash.toLowerCase()) return FAILED;
  return result;
}
