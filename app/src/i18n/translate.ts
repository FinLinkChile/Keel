import { es } from './es';

export type Language = 'en' | 'es';

export const LANGUAGES: { code: Language; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
];

export const isLanguage = (value: unknown): value is Language => value === 'en' || value === 'es';

// The text of the screens is written in English and is its own key: a phrase with no entry in
// the Spanish table shows in English, so a missing translation never breaks a screen.
// Variables go in braces: t('Verify {name}', { name }).
export function translate(language: Language, text: string, vars?: Record<string, string | number>): string {
  const phrase = language === 'es' ? (es[text] ?? text) : text;
  return vars ? phrase.replace(/\{(\w+)\}/g, (whole, key: string) => (key in vars ? String(vars[key]) : whole)) : phrase;
}

// The language in use, for code that is not a component (the words of the agent notes, errors).
// The provider keeps it in step; a component that calls it must also use useLanguage so that
// it renders again when the language changes.
let current: Language = 'en';
export const getLanguage = () => current;
export const setCurrentLanguage = (language: Language) => {
  current = language;
};
export const t = (text: string, vars?: Record<string, string | number>) => translate(current, text, vars);
