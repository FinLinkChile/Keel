import type { PickedFile } from './pickPdf.types';

export type ImageSource = 'camera' | 'gallery';

// 'denied' when the person refused the camera permission; null when cancelled
export type PickedImage = PickedFile | 'denied' | null;
