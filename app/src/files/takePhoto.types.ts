import type { PickedFile } from './pickPdf.types';

// 'denied' when the person refused the camera permission; null when cancelled
export type PickedPhoto = PickedFile | 'denied' | null;
