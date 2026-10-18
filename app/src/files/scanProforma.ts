import { takePhoto } from './takePhoto';
import type { PickedPhoto } from './takePhoto.types';

// Web has no document scanner: the camera input takes a photo instead
export const scanProforma = (): Promise<PickedPhoto> => takePhoto();
