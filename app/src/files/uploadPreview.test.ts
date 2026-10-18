// Runs in Node (vitest), not in the app

import { describe, expect, it, vi } from 'vitest';

import { MAX_UPLOAD_BYTES } from '../ingest/client';

import { countPdfPages, formatSize, uploadPreview } from './uploadPreview';

vi.mock('expo-crypto', () => ({ getRandomValues: (a: Uint8Array<ArrayBuffer>) => globalThis.crypto.getRandomValues(a) }));

const pdf = (body: string) => new TextEncoder().encode(`%PDF-1.4\n${body}\n%%EOF`);
// A small PDF with a page tree of n leaves, written the plain way
const plain = (n: number) =>
  pdf(
    `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [${Array.from({ length: n }, (_, i) => `${i + 3} 0 R`).join(' ')}] /Count ${n} >>\nendobj\n` +
      Array.from({ length: n }, (_, i) => `${i + 3} 0 obj\n<< /Type /Page /Parent 2 0 R >>\nendobj`).join('\n'),
  );

describe('formatSize', () => {
  it('writes bytes, KB and MB', () => {
    expect(formatSize(900)).toBe('900 B');
    expect(formatSize(250_000)).toBe('244 KB');
    expect(formatSize(1_234_567)).toBe('1.2 MB');
    expect(formatSize(10 * 1024 * 1024)).toBe('10.0 MB');
  });
});

describe('countPdfPages', () => {
  it('counts the pages of a plain PDF and does not mistake /Pages for a page', () => {
    expect(countPdfPages(plain(1))).toBe(1);
    expect(countPdfPages(plain(3))).toBe(3);
  });

  it('gives nothing when the page objects are hidden in compressed streams', () => {
    expect(countPdfPages(pdf('1 0 obj\n<< /Type /ObjStm /N 3 /First 20 >>\nstream\nxxx\nendstream\nendobj'))).toBeUndefined();
  });

  it('gives nothing when the count of the tree and the pages found disagree, or there are none', () => {
    const lying = pdf('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 5 >>\nendobj\n3 0 obj\n<< /Type /Page >>\nendobj');
    expect(countPdfPages(lying)).toBeUndefined();
    expect(countPdfPages(pdf('hello'))).toBeUndefined();
    expect(countPdfPages(new Uint8Array())).toBeUndefined();
  });

  it('reads a large file without running out of arguments', () => {
    const big = new Uint8Array(3 * 1024 * 1024).fill(0x20);
    big.set(plain(2));
    expect(countPdfPages(big)).toBe(2);
  });
});

describe('uploadPreview', () => {
  it('says what is uploaded, for which order, and the size and pages of the file', () => {
    const preview = uploadPreview('BILL_OF_LADING', 'PO-0142', { name: 'bl.pdf', bytes: plain(2) });
    expect(preview).toMatchObject({ title: 'Bill of lading for PO-0142', fileName: 'bl.pdf', tooLarge: false });
    expect(preview.details).toMatch(/^\d+ B, 2 pages$/);
    expect(uploadPreview('COMMERCIAL_INVOICE', 'PO-0150', { name: 'inv.pdf', bytes: plain(1) }).title).toBe('Commercial invoice for PO-0150');
    expect(uploadPreview('COMMERCIAL_INVOICE', 'PO-0150', { name: 'inv.pdf', bytes: plain(1) }).details).toMatch(/, 1 page$/);
  });

  it('omits the pages instead of guessing, and flags a file over the limit', () => {
    const preview = uploadPreview('AIR_WAYBILL', 'PO-0142', { name: 'x.pdf', bytes: new Uint8Array(MAX_UPLOAD_BYTES + 1) });
    expect(preview.details).toBe('10.0 MB');
    expect(preview.tooLarge).toBe(true);
  });
});
