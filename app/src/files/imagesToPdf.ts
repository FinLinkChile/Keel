import { PDFDocument } from 'pdf-lib';

// A4 width in points: every scanned page is scaled to it, keeping its proportions
const PAGE_WIDTH = 595;

// Joins the JPEG pages of a scan into one PDF, one page per image, in scan order. ingest takes
// one file per proforma; a PDF without text goes to the model as a file, like a photo.
export async function imagesToPdf(jpegs: readonly (Uint8Array | string)[]): Promise<Uint8Array> {
  if (jpegs.length === 0) throw new Error('no pages to join');
  const pdf = await PDFDocument.create();
  for (const jpeg of jpegs) {
    const image = await pdf.embedJpg(jpeg);
    const height = (image.height / image.width) * PAGE_WIDTH;
    pdf.addPage([PAGE_WIDTH, height]).drawImage(image, { x: 0, y: 0, width: PAGE_WIDTH, height });
  }
  return pdf.save();
}
