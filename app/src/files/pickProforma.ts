import { pickImage } from './pickImage';
import type { PickedImage } from './pickImage.types';
import { pickPdf } from './pickPdf';

// The three ways to give the app a proforma. The new order screen shows them as buttons; each
// call has to start from a tap on the web.
export type ProformaSource = 'camera' | 'gallery' | 'pdf';

// The chosen file's exact bytes: a JPEG photo (never HEIC) or a PDF. ingest reads the type from
// the bytes, so nothing here declares it.
export async function pickProforma(source: ProformaSource): Promise<PickedImage> {
  return source === 'pdf' ? pickPdf() : pickImage(source);
}
