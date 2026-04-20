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
  type ThemeId,
} from "@freed/shared/themes";
import {
  applyThemeToDocument,
  getStoredThemeId,
  useThemePreviewController,
} from "@freed/ui/lib/theme";

interface ThemeContextValue {
  themeId: ThemeId;
  activeThemeId: ThemeId;
  setThemeId: (themeId: ThemeId) => void;
  previewTheme: (themeId: ThemeId) => void;
  revertPreview: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeId, setThemeId] = useState<ThemeId>(DEFAULT_THEME_ID);
  const {
    activeThemeId,
    commitTheme,
    previewTheme,
    revertPreview,
  } = useThemePreviewController({
    committedThemeId: themeId,
    onCommitTheme: setThemeId,
  });

  useEffect(() => {
    const nextTheme = getStoredThemeId();
    setThemeId(nextTheme);
  }, []);

  useEffect(() => {
    applyThemeToDocument(themeId);
    window.localStorage.setItem("freed-theme", themeId);
  }, [themeId]);

  const value = useMemo(
    () => ({
      activeThemeId,
      themeId,
      setThemeId: commitTheme,
      previewTheme,
      revertPreview,
    }),
    [activeThemeId, commitTheme, previewTheme, revertPreview, themeId],
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
