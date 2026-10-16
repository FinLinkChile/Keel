// Runs in Node (vitest), not in the app

import { describe, expect, it, vi } from 'vitest';

import { pickFile } from './pickFile';
import { pickProforma } from './pickProforma';
import { takePhoto } from './takePhoto';

// The pickers need a device; only the choice between them is tested here
vi.mock('./takePhoto', () => ({ takePhoto: vi.fn(async () => ({ name: 'photo.jpg', bytes: new Uint8Array([0xff, 0xd8, 0xff]) })) }));
vi.mock('./pickFile', () => ({ pickFile: vi.fn(async () => ({ name: 'proforma.pdf', bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]) })) }));

describe('pickProforma', () => {
  it('opens the camera for a photo and the file picker for a PDF or image', async () => {
    expect(await pickProforma('camera')).toMatchObject({ name: 'photo.jpg' });
    expect(takePhoto).toHaveBeenCalledTimes(1);
    expect(pickFile).not.toHaveBeenCalled();
    expect(await pickProforma('file')).toMatchObject({ name: 'proforma.pdf' });
    expect(pickFile).toHaveBeenCalledTimes(1);
  });

  it('passes on a cancelled pick and a refused camera permission', async () => {
    vi.mocked(takePhoto).mockResolvedValueOnce('denied');
    vi.mocked(pickFile).mockResolvedValueOnce(null);
    expect(await pickProforma('camera')).toBe('denied');
    expect(await pickProforma('file')).toBeNull();
  });
});
