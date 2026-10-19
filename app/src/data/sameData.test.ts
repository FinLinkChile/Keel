import { describe, expect, it } from 'vitest';

import { sameData } from './sameData';

describe('sameData', () => {
  it('treats the same content as the same data, whatever the objects', () => {
    const a = { id: 1n, list: [{ x: 'a' }, { x: 'b' }], when: new Date(5), who: new Map([['k', { n: 2 }]]), set: new Set([1, 2]) };
    const b = { id: 1n, list: [{ x: 'a' }, { x: 'b' }], when: new Date(5), who: new Map([['k', { n: 2 }]]), set: new Set([2, 1]) };
    expect(sameData(a, b)).toBe(true);
  });

  it('notices any change, including inside a Map and in a bigint', () => {
    expect(sameData({ a: 1n }, { a: 2n })).toBe(false);
    expect(sameData({ a: [1, 2] }, { a: [1, 2, 3] })).toBe(false);
    expect(sameData({ m: new Map([['k', 1]]) }, { m: new Map([['k', 2]]) })).toBe(false);
    expect(sameData({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(sameData(new Set([1]), new Set([2]))).toBe(false);
  });

  it('does not confuse null, undefined, arrays and objects', () => {
    expect(sameData(undefined, undefined)).toBe(true);
    expect(sameData(null, undefined)).toBe(false);
    expect(sameData([], {})).toBe(false);
    expect(sameData({ a: NaN }, { a: NaN })).toBe(true);
  });

  it('reads the new value when it cannot tell, such as two different functions', () => {
    const f = () => 1;
    expect(sameData({ f }, { f })).toBe(true);
    expect(sameData({ f }, { f: () => 1 })).toBe(false);
  });
});
