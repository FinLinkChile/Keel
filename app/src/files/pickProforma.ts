import { pickFile } from './pickFile';
import { takePhoto } from './takePhoto';
import type { PickedPhoto } from './takePhoto.types';

// The two ways to give the app a proforma. The new order screen offers them in a sheet; each call
// has to start from a tap on the web.
export type ProformaSource = 'camera' | 'file';

// The chosen file's exact bytes: a JPEG photo (never HEIC), or a PDF or image from the file
// picker. ingest reads the type from the bytes, so nothing here declares it.
export async function pickProforma(source: ProformaSource): Promise<PickedPhoto> {
  return source === 'file' ? pickFile() : takePhoto();
}
