import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
  applyTheme,
  getStoredTheme,
  getSystemTheme,
  type ResolvedTheme,
  THEME_CHANGED_EVENT,
  THEME_STORAGE_KEY,
  type ThemePreference,
} from '../theme.js';

interface ThemeContextValue {
  theme: ThemePreference;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemePreference>(getStoredTheme);
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(getSystemTheme);

  const resolvedTheme: ResolvedTheme = theme === 'system' ? systemTheme : theme;

  const setTheme = useCallback((newTheme: ThemePreference) => {
    setThemeState(newTheme);
    localStorage.setItem(THEME_STORAGE_KEY, newTheme);
  }, []);

  // Apply theme to DOM whenever resolved theme changes
  useEffect(() => {
    applyTheme(resolvedTheme);
  }, [resolvedTheme]);

  // Listen for OS theme changes
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => {
      setSystemTheme(e.matches ? 'dark' : 'light');
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // A host's own theme toggle writes the same storage key and dispatches
  // `conloca-theme-changed` in the writing tab (storage events don't fire
  // same-tab). Keep React state + data-theme in lockstep.
  useEffect(() => {
    const syncFromStorage = () => {
      setThemeState(getStoredTheme());
      setSystemTheme(getSystemTheme());
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === THEME_STORAGE_KEY || event.key === null) syncFromStorage();
    };
    window.addEventListener(THEME_CHANGED_EVENT, syncFromStorage);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(THEME_CHANGED_EVENT, syncFromStorage);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  return <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme }}>{children}</ThemeContext.Provider>;
}

const NOOP_THEME: ThemeContextValue = {
  theme: 'system',
  resolvedTheme: 'light',
  setTheme: () => {},
};

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext) ?? NOOP_THEME;
}
