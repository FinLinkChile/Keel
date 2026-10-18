import { describe, expect, it } from 'vitest';

import { unitPrice } from './unitPrice';

describe('unitPrice', () => {
  it('converts equivalent units to the same base', () => {
    expect(unitPrice({ hs_code: '130231', quantity: 6, unit: 'TNE', amount_minor: 4_800_000 })).toEqual({ hsCode: '130231', unit: 'KGM', centsPerUnit: 800 });
    expect(unitPrice({ hs_code: '130231', quantity: 6000, unit: 'KGM', amount_minor: 4_800_000 })!.centsPerUnit).toBe(800);
    expect(unitPrice({ hs_code: '846721', quantity: 10, unit: 'DZN', amount_minor: 120_000 })).toMatchObject({ unit: 'PCE', centsPerUnit: 1000 });
    expect(unitPrice({ hs_code: '220210', quantity: 2, unit: 'MTQ', amount_minor: 200_000 })).toMatchObject({ unit: 'LTR', centsPerUnit: 100 });
  });

  it('keeps a carton a carton, and needs an HS code and an amount', () => {
    expect(unitPrice({ hs_code: '130231', quantity: 100, unit: 'CT', amount_minor: 960_000 })).toMatchObject({ unit: 'CT', centsPerUnit: 9600 });
    expect(unitPrice({ hs_code: null, quantity: 1, unit: 'KGM', amount_minor: 100 })).toBeUndefined();
    expect(unitPrice({ hs_code: '130231', quantity: 1, unit: 'KGM', amount_minor: null })).toBeUndefined();
  });
});
