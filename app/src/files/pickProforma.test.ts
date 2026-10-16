// Runs in Node (vitest), not in the app

import { describe, expect, it, vi } from 'vitest';

import { pickImage } from './pickImage';
import { pickPdf } from './pickPdf';
import { pickProforma } from './pickProforma';

// The pickers need a device; only the choice between them is tested here
vi.mock('./pickImage', () => ({ pickImage: vi.fn(async () => ({ name: 'photo.jpg', bytes: new Uint8Array([0xff, 0xd8, 0xff]) })) }));
vi.mock('./pickPdf', () => ({ pickPdf: vi.fn(async () => ({ name: 'proforma.pdf', bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]) })) }));

describe('pickProforma', () => {
  it('opens the camera or the gallery for a photo and the PDF picker for a PDF', async () => {
    expect(await pickProforma('camera')).toMatchObject({ name: 'photo.jpg' });
    expect(pickImage).toHaveBeenLastCalledWith('camera');
    await pickProforma('gallery');
    expect(pickImage).toHaveBeenLastCalledWith('gallery');
    expect(pickPdf).not.toHaveBeenCalled();
    expect(await pickProforma('pdf')).toMatchObject({ name: 'proforma.pdf' });
    expect(pickPdf).toHaveBeenCalledTimes(1);
  });

  it('passes on a cancelled pick and a refused camera permission', async () => {
    vi.mocked(pickImage).mockResolvedValueOnce(null).mockResolvedValueOnce('denied');
    expect(await pickProforma('gallery')).toBeNull();
    expect(await pickProforma('camera')).toBe('denied');
  });
});
