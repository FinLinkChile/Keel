import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';

import type { PickedFile } from './pickPdf.types';

// Lets the person choose one PDF and reads its exact bytes. null when cancelled.
export async function pickPdf(): Promise<PickedFile | null> {
  const result = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true, multiple: false });
  if (result.canceled || !result.assets?.[0]) return null;
  const asset = result.assets[0];
  return { name: asset.name, bytes: await new File(asset.uri).bytes() };
}
