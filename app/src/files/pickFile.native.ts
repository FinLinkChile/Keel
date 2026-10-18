import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';

import type { PickedFile } from './pickPdf.types';

// The proforma comes as a PDF or a photo. HEIC is left out: ingest does not read it.
export const PROFORMA_FILE_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

// Lets the person choose one PDF or image and reads its exact bytes. null when cancelled. On
// Android the picker reaches Photos and files; on iOS it opens Files.
export async function pickFile(): Promise<PickedFile | null> {
  const result = await DocumentPicker.getDocumentAsync({ type: PROFORMA_FILE_TYPES, copyToCacheDirectory: true, multiple: false });
  if (result.canceled || !result.assets?.[0]) return null;
  const asset = result.assets[0];
  return { name: asset.name, bytes: await new File(asset.uri).bytes() };
}
