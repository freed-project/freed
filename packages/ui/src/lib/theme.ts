import {
  DEFAULT_THEME_ID,
  THEME_DEFINITIONS,
  getThemeCssVariables,
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
  const root = document.documentElement;
  root.dataset.theme = themeId;
  root.style.colorScheme = getThemeDefinition(themeId).surface;
  const cssVariables = getThemeCssVariables(themeId);
  for (const [name, value] of Object.entries(cssVariables)) {
    root.style.setProperty(name, value);
  }

  const computedStyles = getComputedStyle(root);
  const browserThemeColor =
    computedStyles.getPropertyValue("--theme-attached-topbar-background").trim()
    || computedStyles.getPropertyValue("--theme-bg-root").trim();
  if (browserThemeColor) {
    const themeColorMeta = document.querySelector<HTMLMetaElement>(
      'meta[name="theme-color"]',
    );
    if (themeColorMeta) {
      themeColorMeta.content = browserThemeColor;
    }
  }
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
