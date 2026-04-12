"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  DEFAULT_THEME_ID,
  THEME_DEFINITIONS,
  getThemeDefinition,
  resolveThemeId,
  type ThemeId,
} from "@freed/shared/themes";

const THEME_STORAGE_KEY = "freed-theme";

interface ThemeContextValue {
  themeId: ThemeId;
  setThemeId: (themeId: ThemeId) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeId, setThemeId] = useState<ThemeId>(DEFAULT_THEME_ID);

  useEffect(() => {
    const nextTheme = resolveThemeId(window.localStorage.getItem(THEME_STORAGE_KEY));
    setThemeId(nextTheme);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = themeId;
    document.documentElement.style.colorScheme = getThemeDefinition(themeId).surface;
    window.localStorage.setItem(THEME_STORAGE_KEY, themeId);
  }, [themeId]);

  const value = useMemo(
    () => ({
      themeId,
      setThemeId,
    }),
    [themeId],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}

export { THEME_DEFINITIONS };
