import DocumentScanner, { ResponseType, ScanDocumentResponseStatus } from 'react-native-document-scanner-plugin';

import { imagesToPdf } from './imagesToPdf';
import type { PickedPhoto } from './takePhoto.types';

// iOS document scanner (VisionKit, the one in Notes): finds the page edges, straightens it and
// lets the person scan several pages. The pages are joined into one PDF. The quality keeps a few
// pages well under ingest's 10 MB PDF limit.
export async function scanProforma(): Promise<PickedPhoto> {
  let result;
  try {
    result = await DocumentScanner.scanDocument({ responseType: ResponseType.Base64, croppedImageQuality: 70 });
  } catch (e) {
    // The scanner rejects when the camera permission is refused
    if (String(e).toLowerCase().includes('permission')) return 'denied';
    throw e;
  }
  const pages = result.scannedImages ?? [];
  if (result.status === ScanDocumentResponseStatus.Cancel || pages.length === 0) return null;
  return { name: 'proforma-scan.pdf', bytes: await imagesToPdf(pages) };
}
