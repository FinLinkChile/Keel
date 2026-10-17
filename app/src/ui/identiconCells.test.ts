import { describe, expect, it } from 'vitest';

import { identiconCells, identiconTint } from './identiconCells';

const A = '0x3E9d17aBC40f82E16D0c9F2a4b71A05e0C3d8812';
const B = '0x3E9d17aBC40f82E16D0c9F2a4b71A05e0C3d8813';

describe('identicon', () => {
  it('is a 5 x 5 grid, mirrored left to right, and the same for the same address in any case', () => {
    const cells = identiconCells(A);
    expect(cells.length).toBe(5);
    for (const row of cells) {
      expect(row.length).toBe(5);
      expect(row[0]).toBe(row[4]);
      expect(row[1]).toBe(row[3]);
    }
    expect(identiconCells(A.toLowerCase())).toEqual(cells);
  });

  it('differs for another address in the first digits, and picks a tint inside the palette', () => {
    expect(identiconCells('0x0000000000000000000000000000000000000000').flat().some(Boolean)).toBe(false);
    expect(identiconCells('0xffffffffffffffffffffffffffffffffffffffff').flat().every(Boolean)).toBe(true);
    expect(identiconCells(A)).not.toEqual(identiconCells('0xa1b2c3d4e5f60718293a4b5c6d7e8f9011223344'));
    expect(identiconTint(A, 4)).toBeGreaterThanOrEqual(0);
    expect(identiconTint(A, 4)).toBeLessThan(4);
    expect(identiconTint(B, 4)).not.toBe(identiconTint(A, 4));
  });
});
