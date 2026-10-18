import { describe, expect, it } from 'vitest';

import { cleanRut, isCompanyRut, isPersonRut, isValidRut, rutCheckDigit } from './rut';

describe('RUT', () => {
  it('computes the check digit with módulo 11', () => {
    expect(rutCheckDigit('76543210')).toBe('3');
    expect(rutCheckDigit('12345678')).toBe('5');
    // The edge cases: a result of 11 is written 0 and a result of 10 is K
    expect(rutCheckDigit('12000002')).toBe('0');
    expect(rutCheckDigit('12000008')).toBe('K');
  });

  it('accepts a RUT written with or without dots and dash, and rejects a wrong digit', () => {
    expect(isValidRut('76.543.210-3')).toBe(true);
    expect(isValidRut('765432103')).toBe(true);
    expect(isValidRut('12.000.008-k')).toBe(true);
    expect(isValidRut('12.000.002-0')).toBe(true);
    expect(isValidRut('76.543.210-4')).toBe(false);
    expect(isValidRut('12.345.678-9')).toBe(false);
    expect(isValidRut('abc')).toBe(false);
    expect(isValidRut('')).toBe(false);
    expect(cleanRut(' 76.543.210-3 ')).toBe('765432103');
  });

  it('tells a company RUT (from 50,000,000) from a person one', () => {
    expect(isCompanyRut('76.543.210-3')).toBe(true);
    expect(isCompanyRut('12.345.678-5')).toBe(false);
    expect(isPersonRut('12.345.678-5')).toBe(true);
    expect(isPersonRut('76.543.210-3')).toBe(false);
  });
});
