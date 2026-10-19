import type { TextFile } from './proposals';
import { cleanRut, isCompanyRut, isPersonRut } from './rut';
import { t } from '../i18n/translate';

// Sign-up: the country, the company and the person who represents it, the way a Chilean bank asks
// for them. The identity check is SIMULATED: the person ticks that it was done, and nothing is
// captured or checked (no photo of the ID card, no selfie). KYC is future work
// (docs/flujo/alcance.md); the screen says so. These are personal data: they stay on this phone
// and are never sent to ingest or to a model.

// What the company does and how big it is, so the agent's analysis fits it. The brackets are the
// SII's by annual sales in UF.
export const INDUSTRIES = ['food', 'textiles', 'electronics', 'machinery', 'chemicals', 'construction', 'home', 'consumer', 'other'] as const;
export type Industry = (typeof INDUSTRIES)[number];
export const INDUSTRY_WORDS: Record<Industry, string> = {
  food: 'Food and beverages',
  textiles: 'Textiles and apparel',
  electronics: 'Electronics',
  machinery: 'Machinery and tools',
  chemicals: 'Chemicals and plastics',
  construction: 'Construction materials',
  home: 'Furniture and home',
  consumer: 'Other consumer goods',
  other: 'Other',
};
export const SALES_BRACKETS = ['micro', 'small', 'medium', 'large'] as const;
export type SalesBracket = (typeof SALES_BRACKETS)[number];
export const BRACKET_WORDS: Record<SalesBracket, { label: string; range: string }> = {
  micro: { label: 'Micro', range: 'Up to 2,400 UF a year' },
  small: { label: 'Small', range: '2,400 to 25,000 UF a year' },
  medium: { label: 'Medium', range: '25,000 to 100,000 UF a year' },
  large: { label: 'Large', range: 'Over 100,000 UF a year' },
};

export type Onboarding = {
  country: 'CL';
  company: {
    // Without dots or dash, like Party.taxId
    rut: string;
    legalName: string;
    email: string;
    // "+569XXXXXXXX"
    phone: string;
  };
  representative: { name: string; rut: string; pep: boolean };
  // Missing in sign-ups made before it was asked
  profile?: { industry: Industry; salesBracket: SalesBracket };
  // Always true once signed up. Simulated, see above.
  identityValidated: true;
  // Unix seconds
  completedAt: number;
};

export type Draft = {
  companyRut: string;
  legalName: string;
  email: string;
  phone: string;
  industry: Industry | null;
  salesBracket: SalesBracket | null;
  repName: string;
  repRut: string;
  pep: 'yes' | 'no';
  identityChecked: boolean;
};

export type Step = 'country' | 'company' | 'representative' | 'identity';
export const STEPS: readonly Step[] = ['country', 'company', 'representative', 'identity'];

export type DraftField = 'companyRut' | 'legalName' | 'email' | 'phone' | 'industry' | 'salesBracket' | 'repName' | 'repRut' | 'identityChecked';
export type Problems = Partial<Record<DraftField, string>>;

// Prefilled with the company of the demo, whose RUT the documents of the test orders carry. Both
// RUTs are valid; the person and the contact data are fictitious.
export const DEMO_DRAFT: Draft = {
  companyRut: '76.543.210-3',
  legalName: 'Pacífico Foods SpA',
  email: 'compras@pacificofoods.example',
  phone: '+56 9 1234 5678',
  industry: 'food',
  salesBracket: 'small',
  repName: 'Camila Rojas Soto',
  repRut: '12.345.678-5',
  pep: 'no',
  identityChecked: false,
};

// A Chilean mobile is 9 and eight digits, with or without +56. Null when it is not one.
export function normalizePhone(phone: string): string | null {
  const digits = phone.replace(/[\s\-().+]/g, '');
  const local = digits.startsWith('56') ? digits.slice(2) : digits;
  return /^9\d{8}$/.test(local) ? `+56${local}` : null;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// What blocks leaving a step, in words for the person. Empty when the step can be left.
export function checkStep(step: Step, d: Draft): Problems {
  const problems: Problems = {};
  if (step === 'company') {
    if (!isCompanyRut(d.companyRut)) problems.companyRut = t('Check the RUT of the company. It has to be valid and start at 50.000.000.');
    if (d.legalName.trim().length < 3) problems.legalName = t('Write the legal name of the company.');
    if (!EMAIL.test(d.email.trim())) problems.email = t('Write an email like name@company.cl.');
    if (!normalizePhone(d.phone)) problems.phone = t('Write a Chilean mobile, like +56 9 1234 5678.');
    if (!d.industry) problems.industry = t('Choose what your company does.');
    if (!d.salesBracket) problems.salesBracket = t('Choose the size of your company.');
  }
  if (step === 'representative') {
    if (d.repName.trim().split(/\s+/).length < 2) problems.repName = t('Write first name and surname.');
    if (!isPersonRut(d.repRut)) problems.repRut = t('Check the RUT. It has to be valid.');
  }
  if (step === 'identity' && !d.identityChecked) problems.identityChecked = t('Tick the box once you have validated your identity.');
  return problems;
}

export const isComplete = (d: Draft): boolean => STEPS.every((s) => Object.keys(checkStep(s, d)).length === 0);

export function toOnboarding(d: Draft, now: number): Onboarding {
  if (!isComplete(d)) throw new Error('the sign-up is not complete');
  return {
    country: 'CL',
    company: { rut: cleanRut(d.companyRut), legalName: d.legalName.trim(), email: d.email.trim(), phone: normalizePhone(d.phone)! },
    representative: { name: d.repName.trim(), rut: cleanRut(d.repRut), pep: d.pep === 'yes' },
    profile: { industry: d.industry!, salesBracket: d.salesBracket! },
    identityValidated: true,
    completedAt: Math.floor(now),
  };
}

export interface OnboardingStore {
  get(): Promise<Onboarding | null>;
  save(onboarding: Onboarding): Promise<void>;
  clear(): Promise<void>;
}

// A text file, like the proposals: the phone's document directory, localStorage on the web or
// memory in tests. `null` text is a missing file.
export function jsonOnboardingStore(file: TextFile): OnboardingStore {
  return {
    get: async () => {
      const text = await file.read();
      return text ? (JSON.parse(text) as Onboarding) : null;
    },
    save: (onboarding) => file.write(JSON.stringify(onboarding, null, 2)),
    clear: () => file.write(''),
  };
}
