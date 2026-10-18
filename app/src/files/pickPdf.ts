import * as DocumentPicker from 'expo-document-picker';

import type { PickedFile } from './pickPdf.types';

// Web: the browser file input of expo-document-picker. Must run from a tap (user activation).
// Reads the exact bytes of the chosen PDF. null when cancelled.
export async function pickPdf(): Promise<PickedFile | null> {
  const result = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', multiple: false, base64: false });
  const file = result.canceled ? undefined : result.assets?.[0]?.file;
  if (!file) return null;
  return { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) };
}
