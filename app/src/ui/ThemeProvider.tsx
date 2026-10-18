import { createContext, Fragment, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { themeStore } from './themeStore';
import { applyTheme, type ThemeMode } from './theme';

type Value = { mode: ThemeMode; setMode: (mode: ThemeMode) => void };

const ThemeContext = createContext<Value | null>(null);

const isMode = (value: unknown): value is ThemeMode => value === 'dark' || value === 'light';

// Dark until the saved choice is read; nothing is drawn before that, so a phone set to light
// never flashes dark. The screens below are keyed by the mode: they are drawn again from the
// start with the new palette, since `colors` is read while rendering.
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>('dark');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    themeStore
      .get()
      .then((saved) => {
        if (isMode(saved)) {
          applyTheme(saved);
          setModeState(saved);
        }
      })
      .catch(() => {})
      .finally(() => setReady(true));
  }, []);

  const setMode = useCallback((next: ThemeMode) => {
    applyTheme(next);
    setModeState(next);
    themeStore.save(next).catch(() => {});
  }, []);

  const value = useMemo(() => ({ mode, setMode }), [mode, setMode]);

  if (!ready) return null;
  return (
    <ThemeContext.Provider value={value}>
      <Fragment key={mode}>{children}</Fragment>
    </ThemeContext.Provider>
  );
}

export function useTheme(): Value {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme outside ThemeProvider');
  return value;
}
