import type { ProformaLine, ProformaUnit } from '../ingest/proforma';

// Prices per unit of a proforma line, so lines can be compared whatever unit they come in. Only
// equivalent units are converted (a ton to kilos, a dozen to pieces); a carton, a bag or a roll
// has no fixed size, so it is only compared with the same unit.

type Base = { unit: ProformaUnit; factor: number };

// How many base units one unit is
const BASE: Record<ProformaUnit, Base> = {
  KGM: { unit: 'KGM', factor: 1 },
  TNE: { unit: 'KGM', factor: 1000 },
  GRM: { unit: 'KGM', factor: 0.001 },
  LBR: { unit: 'KGM', factor: 0.45359237 },
  PCE: { unit: 'PCE', factor: 1 },
  DZN: { unit: 'PCE', factor: 12 },
  LTR: { unit: 'LTR', factor: 1 },
  MTQ: { unit: 'LTR', factor: 1000 },
  SET: { unit: 'SET', factor: 1 },
  PR: { unit: 'PR', factor: 1 },
  CT: { unit: 'CT', factor: 1 },
  BG: { unit: 'BG', factor: 1 },
  RO: { unit: 'RO', factor: 1 },
  MTR: { unit: 'MTR', factor: 1 },
  MTK: { unit: 'MTK', factor: 1 },
};

export type UnitPrice = { hsCode: string; unit: ProformaUnit; centsPerUnit: number };

// The price per base unit of a line, or undefined when it lacks an HS code or an amount
export function unitPrice(line: ProformaLine): UnitPrice | undefined {
  if (!line.hs_code || line.amount_minor === null) return undefined;
  const base = BASE[line.unit];
  return { hsCode: line.hs_code, unit: base.unit, centsPerUnit: line.amount_minor / (line.quantity * base.factor) };
}

export const UNIT_WORDS: Record<ProformaUnit, string> = {
  KGM: 'kg',
  TNE: 'ton',
  GRM: 'g',
  LBR: 'lb',
  PCE: 'unit',
  SET: 'set',
  PR: 'pair',
  DZN: 'dozen',
  CT: 'carton',
  BG: 'bag',
  RO: 'roll',
  LTR: 'litre',
  MTR: 'metre',
  MTK: 'square metre',
  MTQ: 'cubic metre',
};
