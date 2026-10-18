import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { languageStore } from './store';
import { isLanguage, setCurrentLanguage, translate, type Language } from './translate';

export { LANGUAGES, getLanguage, t, type Language } from './translate';

type Value = {
  language: Language;
  setLanguage: (language: Language) => void;
  t: (text: string, vars?: Record<string, string | number>) => string;
};

const LanguageContext = createContext<Value | null>(null);

// English until the saved choice is read, which is also what the jury sees by default.
export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>('en');

  useEffect(() => {
    languageStore
      .get()
      .then((saved) => {
        if (isLanguage(saved)) {
          setCurrentLanguage(saved);
          setLanguageState(saved);
        }
      })
      .catch(() => {});
  }, []);

  const setLanguage = useCallback((next: Language) => {
    setCurrentLanguage(next);
    setLanguageState(next);
    languageStore.save(next).catch(() => {});
  }, []);

  const value = useMemo<Value>(
    () => ({ language, setLanguage, t: (text, vars) => translate(language, text, vars) }),
    [language, setLanguage],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): Value {
  const value = useContext(LanguageContext);
  if (!value) throw new Error('useLanguage outside LanguageProvider');
  return value;
}

// In a component: renders again when the language changes.
export const useT = () => useLanguage().t;
