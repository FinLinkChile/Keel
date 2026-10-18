// The Chilean RUT: a number and a check digit (módulo 11), written 76.543.210-3.

export const cleanRut = (rut: string): string => rut.replace(/[.\-\s]/g, '').toUpperCase();

// Check digit of the number part: weights 2 to 7 from the right, 11 minus the remainder
export function rutCheckDigit(body: string): string {
  let sum = 0;
  let weight = 2;
  for (let i = body.length - 1; i >= 0; i--) {
    sum += Number(body[i]) * weight;
    weight = weight === 7 ? 2 : weight + 1;
  }
  const digit = 11 - (sum % 11);
  return digit === 11 ? '0' : digit === 10 ? 'K' : String(digit);
}

export function isValidRut(rut: string): boolean {
  const clean = cleanRut(rut);
  return /^\d{7,8}[\dK]$/.test(clean) && rutCheckDigit(clean.slice(0, -1)) === clean.slice(-1);
}

// The SII gives companies numbers from 50,000,000; people have lower ones
export const isCompanyRut = (rut: string): boolean => isValidRut(rut) && Number(cleanRut(rut).slice(0, -1)) >= 50_000_000;
export const isPersonRut = (rut: string): boolean => isValidRut(rut) && Number(cleanRut(rut).slice(0, -1)) < 50_000_000;
