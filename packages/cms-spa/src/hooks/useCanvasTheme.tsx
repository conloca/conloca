import { createContext, useCallback, useContext, useState } from 'react';

type CanvasTheme = 'light' | 'dark';

interface CanvasThemeContextValue {
  canvasTheme: CanvasTheme;
  setCanvasTheme: (theme: CanvasTheme) => void;
  toggleCanvasTheme: () => void;
}

const STORAGE_KEY = 'conloca-canvas-theme';

const CanvasThemeContext = createContext<CanvasThemeContextValue | null>(null);

function getStoredTheme(): CanvasTheme {
  if (typeof window === 'undefined') return 'light';
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === 'dark' ? 'dark' : 'light';
}

export function CanvasThemeProvider({ children }: { children: React.ReactNode }) {
  const [canvasTheme, setCanvasThemeState] = useState<CanvasTheme>(getStoredTheme);

  const setCanvasTheme = useCallback((next: CanvasTheme) => {
    setCanvasThemeState(next);
    localStorage.setItem(STORAGE_KEY, next);
  }, []);

  const toggleCanvasTheme = useCallback(() => {
    setCanvasThemeState((current) => {
      const next: CanvasTheme = current === 'light' ? 'dark' : 'light';
      localStorage.setItem(STORAGE_KEY, next);
      return next;
    });
  }, []);

  return (
    <CanvasThemeContext.Provider value={{ canvasTheme, setCanvasTheme, toggleCanvasTheme }}>
      {children}
    </CanvasThemeContext.Provider>
  );
}

const NOOP_CANVAS_THEME: CanvasThemeContextValue = {
  canvasTheme: 'light',
  setCanvasTheme: () => {},
  toggleCanvasTheme: () => {},
};

export function useCanvasTheme(): CanvasThemeContextValue {
  return useContext(CanvasThemeContext) ?? NOOP_CANVAS_THEME;
}
