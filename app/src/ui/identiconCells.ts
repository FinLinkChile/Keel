// A small picture that stands for an address, so a changed address looks different at a glance.
// It is not a check: the groups of the address are what the person verifies.

// 5 x 5 cells, mirrored left to right, drawn from the first 15 hex digits of the address
export function identiconCells(address: string): boolean[][] {
  const hex = address.replace(/^0x/i, '').toLowerCase().padEnd(40, '0');
  return Array.from({ length: 5 }, (_, row) =>
    Array.from({ length: 5 }, (_, col) => {
      const half = col < 3 ? col : 4 - col;
      return parseInt(hex[row * 3 + half], 16) >= 8;
    }),
  );
}

// Index into the avatar palette, from the last byte of the address
export const identiconTint = (address: string, palette: number): number =>
  parseInt(address.replace(/^0x/i, '').slice(-2) || '0', 16) % palette;
