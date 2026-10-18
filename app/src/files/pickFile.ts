import * as DocumentPicker from 'expo-document-picker';

import type { PickedFile } from './pickPdf.types';

// The proforma comes as a PDF or a photo. HEIC is left out: ingest does not read it.
export const PROFORMA_FILE_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

// Web: the browser file input of expo-document-picker. Must run from a tap (user activation).
// Reads the exact bytes of the chosen PDF or image. null when cancelled.
export async function pickFile(): Promise<PickedFile | null> {
  const result = await DocumentPicker.getDocumentAsync({ type: PROFORMA_FILE_TYPES, multiple: false, base64: false });
  const file = result.canceled ? undefined : result.assets?.[0]?.file;
  if (!file) return null;
  return { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) };
}
