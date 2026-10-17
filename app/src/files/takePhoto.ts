import * as ImagePicker from 'expo-image-picker';

import type { PickedPhoto } from './takePhoto.types';

// Web: the browser file input of expo-image-picker (the camera input opens the camera on a phone).
// Must run from a tap (user activation). Reads the exact bytes of the photo. null when cancelled.
export async function takePhoto(): Promise<PickedPhoto> {
  const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], allowsEditing: false, quality: 0.8, exif: false });
  const asset = result.canceled ? undefined : result.assets?.[0];
  if (!asset?.file) return null;
  return { name: asset.fileName ?? asset.file.name, bytes: new Uint8Array(await asset.file.arrayBuffer()) };
}
