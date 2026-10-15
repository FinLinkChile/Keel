import { describe, expect, it } from 'vitest';

import { addressGroups, formatAddress, formatCompact, formatDay, formatMinor, initials } from './format';

describe('formatMinor', () => {
  it('groups thousands and keeps the minor digits', () => {
    expect(formatMinor(4_800_000n)).toBe('48,000.00');
    expect(formatMinor(13_240_000n)).toBe('132,400.00');
    expect(formatMinor(5n)).toBe('0.05');
    expect(formatMinor(0n)).toBe('0.00');
    expect(formatMinor(-980_000n)).toBe('-9,800.00');
    expect(formatMinor(1_234_567n, 0)).toBe('1,234,567');
  });
});

describe('addresses', () => {
  const a = '0x7A3f91C2b04E6d1A8c3F5e2D9b7A0c4E1f6B55D8';

  it('splits in groups of 4 with 0x on the first group', () => {
    const groups = addressGroups(a);
    expect(groups).toHaveLength(10);
    expect(groups[0]).toBe('0x7A3f');
    expect(groups.join('')).toBe(a);
  });

  it('shows every character in the full form and never drops one silently', () => {
    expect(formatAddress(a, true)).toBe('0x7A3f 91C2 b04E 6d1A 8c3F 5e2D 9b7A 0c4E 1f6B 55D8');
    expect(formatAddress(a, true).replace(/ /g, '')).toBe(a);
  });

  it('marks the cut in the short form', () => {
    expect(formatAddress(a)).toBe('0x7A3f 91C2 … 55D8');
  });
});

describe('initials', () => {
  it('takes the first two capitalised words, without the company suffix', () => {
    expect(initials('Lingnan Hydrocolloids')).toBe('LH');
    expect(initials('Pacífico Foods SpA')).toBe('PF');
    expect(initials('Kowloon Fine Chemicals')).toBe('KF');
  });
});

describe('formatDay and formatCompact', () => {
  it('reads contract dates in UTC', () => {
    expect(formatDay(1795132800)).toBe('Nov 20');
    expect(formatDay(1795132800n)).toBe('Nov 20');
  });

  it('shortens limits', () => {
    expect(formatCompact(4_900_000n)).toBe('49k');
    expect(formatCompact(8_000_000n)).toBe('80k');
    expect(formatCompact(1_250_000_000n)).toBe('12.5M');
    expect(formatCompact(95_000n)).toBe('950');
  });
});
