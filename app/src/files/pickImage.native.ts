import { File } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';

import type { ImageSource, PickedImage } from './pickImage.types';

// Always JPEG: ingest does not read HEIC, so iOS is asked for the compatible representation, and
// the quality below usually keeps a photo under ingest's 5 MB image limit. It is not guaranteed
// (a 24-48 MP photo can exceed it): readProforma still refuses a larger file before sending.
const OPTIONS: ImagePicker.ImagePickerOptions = {
  mediaTypes: ['images'],
  allowsEditing: false,
  quality: 0.8,
  exif: false,
  preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
};

// Takes a photo or lets the person choose one from the gallery, and reads its exact bytes.
export async function pickImage(source: ImageSource): Promise<PickedImage> {
  if (source === 'camera') {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return 'denied';
  }
  const result = source === 'camera' ? await ImagePicker.launchCameraAsync(OPTIONS) : await ImagePicker.launchImageLibraryAsync(OPTIONS);
  if (result.canceled || !result.assets?.[0]) return null;
  const asset = result.assets[0];
  return { name: asset.fileName ?? 'proforma.jpg', bytes: await new File(asset.uri).bytes() };
}
