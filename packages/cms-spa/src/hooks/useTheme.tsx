import { createContext, useCallback, useContext, useEffect, useState } from 'react';

type ThemePreference = 'light' | 'dark' | 'system';
type ResolvedTheme = 'light' | 'dark';

interface ThemeContextValue {
  theme: ThemePreference;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: ThemePreference) => void;
}

const STORAGE_KEY = 'conloca-theme';

const ThemeContext = createContext<ThemeContextValue | null>(null);

function getSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function getStoredTheme(): ThemePreference {
  if (typeof window === 'undefined') return 'system';
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  return 'system';
}

function applyTheme(resolved: ResolvedTheme) {
  const root = document.documentElement;
  if (resolved === 'dark') {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }
  // Many host frameworks key dark-mode tokens off
  // `:root[data-theme="dark"]` (Starlight, shadcn-style themes,
  // custom setups). Mirror the resolved scheme as `data-theme` on
  // <html> so host CSS reaching the editor surface (via
  // `useFetchedSiteStyles`) resolves dark tokens the same way it does
  // on the published page. Without this, host `:root.dark` rules
  // (Tailwind class convention) fire but `[data-theme="dark"]` rules
  // don't — and any token defined only in the latter falls back to
  // its light value, producing visibly different text colors in the
  // editor vs the live page.
  root.setAttribute('data-theme', resolved);
  root.style.colorScheme = resolved;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemePreference>(getStoredTheme);
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(getSystemTheme);

  const resolvedTheme: ResolvedTheme = theme === 'system' ? systemTheme : theme;

  const setTheme = useCallback((newTheme: ThemePreference) => {
    setThemeState(newTheme);
    localStorage.setItem(STORAGE_KEY, newTheme);
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
