import {
  DEFAULT_THEME_ID,
  THEME_DEFINITIONS,
  getThemeDefinition,
  resolveThemeId,
  type ThemeDefinition,
  type ThemeId,
} from "@freed/shared/themes";

export {
  DEFAULT_THEME_ID,
  THEME_DEFINITIONS,
  resolveThemeId,
  type ThemeDefinition,
  type ThemeId,
};

export const THEME_STORAGE_KEY = "freed-theme";

export function getStoredThemeId(): ThemeId {
  if (typeof window === "undefined") return DEFAULT_THEME_ID;
  return resolveThemeId(window.localStorage.getItem(THEME_STORAGE_KEY));
}

export function applyThemeToDocument(themeId: ThemeId): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = themeId;
  document.documentElement.style.colorScheme = getThemeDefinition(themeId).surface;
}

export function persistTheme(themeId: ThemeId): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(THEME_STORAGE_KEY, themeId);
}

export function bootstrapDocumentTheme(): ThemeId {
  const themeId = getStoredThemeId();
  applyThemeToDocument(themeId);
  return themeId;
}
