// Runs in Node (vitest), not in the app

import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import { imagesToPdf } from './imagesToPdf';

// Smallest valid baseline JPEG (1x1): SOI, DQT, SOF0, DHT, SOS, EOI
const JPEG_1x1 =
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';

describe('imagesToPdf', () => {
  it('joins the scanned pages into one PDF, one page each, in order', async () => {
    const bytes = await imagesToPdf([JPEG_1x1, JPEG_1x1, JPEG_1x1]);
    expect(String.fromCharCode(...bytes.slice(0, 5))).toBe('%PDF-');
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(3);
    expect(pdf.getPage(0).getWidth()).toBe(595);
  });

  it('refuses an empty scan', async () => {
    await expect(imagesToPdf([])).rejects.toThrow();
  });
});
