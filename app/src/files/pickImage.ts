import * as ImagePicker from 'expo-image-picker';

import type { ImageSource, PickedImage } from './pickImage.types';

// Web: the browser file input of expo-image-picker (the camera input opens the camera on a phone).
// Must run from a tap (user activation). Reads the exact bytes of the chosen image. null when
// cancelled.
export async function pickImage(source: ImageSource): Promise<PickedImage> {
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], allowsEditing: false, quality: 0.8, exif: false };
  const result = source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
  const asset = result.canceled ? undefined : result.assets?.[0];
  if (!asset?.file) return null;
  return { name: asset.fileName ?? asset.file.name, bytes: new Uint8Array(await asset.file.arrayBuffer()) };
}
