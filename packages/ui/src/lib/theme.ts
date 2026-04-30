import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DEFAULT_THEME_ID,
  THEME_DEFINITIONS,
  getThemeCssVariables,
  getThemeDefinition,
  resolveThemeId,
  type ThemeDefinition,
  type ThemeId,
} from "@freed/shared/themes";
import {
  getDocumentAnimationIntensity,
  prefersReducedMotion,
} from "./animation-preferences.js";

export {
  DEFAULT_THEME_ID,
  THEME_DEFINITIONS,
  resolveThemeId,
  type ThemeDefinition,
  type ThemeId,
};

export const THEME_STORAGE_KEY = "freed-theme";
const THEME_TRANSITION_BLUR_OUT_MS = 90;
const THEME_TRANSITION_BLUR_IN_MS = 210;
const THEME_TRANSITION_CLEANUP_BUFFER_MS = 40;
const THEME_TRANSITION_BLUR_AMOUNT = "7px";
const LIGHT_THEME_TRANSITION_MS = 110;

type ThemeTransitionPhase = "blur-out" | "blur-in";

interface ThemeTransitionState {
  cleanupTimer: number | null;
  switchTimer: number | null;
  token: number;
}

interface ThemePreviewControllerOptions {
  committedThemeId: ThemeId;
  onCommitTheme: (themeId: ThemeId) => void;
}

interface ThemePreviewController {
  activeThemeId: ThemeId;
  committedThemeId: ThemeId;
  previewThemeId: ThemeId | null;
  commitTheme: (themeId: ThemeId) => void;
  previewTheme: (themeId: ThemeId) => void;
  revertPreview: () => void;
}

const themeTransitionState: ThemeTransitionState = {
  cleanupTimer: null,
  switchTimer: null,
  token: 0,
};

function getDocumentRoot(): HTMLElement | null {
  if (typeof document === "undefined") {
    return null;
  }
  return document.documentElement;
}

function clearThemeTransitionTimers(): void {
  if (typeof window === "undefined") {
    themeTransitionState.cleanupTimer = null;
    themeTransitionState.switchTimer = null;
    return;
  }

  if (themeTransitionState.switchTimer !== null) {
    window.clearTimeout(themeTransitionState.switchTimer);
    themeTransitionState.switchTimer = null;
  }

  if (themeTransitionState.cleanupTimer !== null) {
    window.clearTimeout(themeTransitionState.cleanupTimer);
    themeTransitionState.cleanupTimer = null;
  }
}

function setThemeTransitionPhase(
  phase: ThemeTransitionPhase,
  durationMs: number,
  blurAmount = THEME_TRANSITION_BLUR_AMOUNT,
): void {
  const root = getDocumentRoot();
  if (!root) {
    return;
  }

  root.dataset.themeTransition = phase;
  root.style.setProperty("--theme-transition-duration", `${durationMs}ms`);
  root.style.setProperty("--theme-transition-blur", blurAmount);
  root.style.setProperty("--theme-transition-opacity", "0.965");
  root.style.setProperty("--theme-transition-saturate", "0.985");
}

function clearThemeTransitionStyles(): void {
  const root = getDocumentRoot();
  if (!root) {
    return;
  }

  root.removeAttribute("data-theme-transition");
  root.style.removeProperty("--theme-transition-duration");
  root.style.removeProperty("--theme-transition-blur");
  root.style.removeProperty("--theme-transition-opacity");
  root.style.removeProperty("--theme-transition-saturate");
}

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

function transitionThemeOnDocument(themeId: ThemeId): void {
  const root = getDocumentRoot();
  if (!root) {
    return;
  }

  const currentThemeId = resolveThemeId(root.dataset.theme || DEFAULT_THEME_ID);
  if (currentThemeId === themeId) {
    clearThemeTransitionTimers();
    clearThemeTransitionStyles();
    return;
  }

  const animationIntensity = getDocumentAnimationIntensity();
  if (animationIntensity === "none" || prefersReducedMotion()) {
    clearThemeTransitionTimers();
    clearThemeTransitionStyles();
    applyThemeToDocument(themeId);
    return;
  }

  if (animationIntensity === "light") {
    clearThemeTransitionTimers();
    themeTransitionState.token += 1;
    const transitionToken = themeTransitionState.token;

    applyThemeToDocument(themeId);
    setThemeTransitionPhase("blur-in", LIGHT_THEME_TRANSITION_MS, "0px");
    root.style.setProperty("--theme-transition-opacity", "1");
    root.style.setProperty("--theme-transition-saturate", "1");

    themeTransitionState.cleanupTimer = window.setTimeout(() => {
      if (themeTransitionState.token !== transitionToken) {
        return;
      }

      clearThemeTransitionStyles();
      themeTransitionState.cleanupTimer = null;
    }, LIGHT_THEME_TRANSITION_MS + THEME_TRANSITION_CLEANUP_BUFFER_MS);
    return;
  }

  clearThemeTransitionTimers();
  themeTransitionState.token += 1;
  const transitionToken = themeTransitionState.token;

  setThemeTransitionPhase("blur-out", THEME_TRANSITION_BLUR_OUT_MS);
  themeTransitionState.switchTimer = window.setTimeout(() => {
    if (themeTransitionState.token !== transitionToken) {
      return;
    }

    applyThemeToDocument(themeId);
    setThemeTransitionPhase("blur-in", THEME_TRANSITION_BLUR_IN_MS);
    root.style.setProperty("--theme-transition-blur", "0px");
    root.style.setProperty("--theme-transition-opacity", "1");
    root.style.setProperty("--theme-transition-saturate", "1");

    themeTransitionState.cleanupTimer = window.setTimeout(() => {
      if (themeTransitionState.token !== transitionToken) {
        return;
      }

      clearThemeTransitionStyles();
      themeTransitionState.cleanupTimer = null;
    }, THEME_TRANSITION_BLUR_IN_MS + THEME_TRANSITION_CLEANUP_BUFFER_MS);

    themeTransitionState.switchTimer = null;
  }, THEME_TRANSITION_BLUR_OUT_MS);
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

export function useThemePreviewController({
  committedThemeId,
  onCommitTheme,
}: ThemePreviewControllerOptions): ThemePreviewController {
  const [previewThemeId, setPreviewThemeId] = useState<ThemeId | null>(null);

  useEffect(() => {
    if (previewThemeId === committedThemeId) {
      setPreviewThemeId(null);
    }
  }, [committedThemeId, previewThemeId]);

  const activeThemeId = previewThemeId ?? committedThemeId;

  const previewTheme = useCallback((themeId: ThemeId) => {
    if (themeId === activeThemeId) {
      return;
    }

    setPreviewThemeId(themeId === committedThemeId ? null : themeId);
    transitionThemeOnDocument(themeId);
  }, [activeThemeId, committedThemeId]);

  const revertPreview = useCallback(() => {
    setPreviewThemeId((currentPreviewThemeId) => {
      if (currentPreviewThemeId === null) {
        return currentPreviewThemeId;
      }

      transitionThemeOnDocument(committedThemeId);
      return null;
    });
  }, [committedThemeId]);

  const commitTheme = useCallback((themeId: ThemeId) => {
    if (themeId !== activeThemeId) {
      transitionThemeOnDocument(themeId);
    }

    setPreviewThemeId(null);
    onCommitTheme(themeId);
  }, [activeThemeId, onCommitTheme]);

  return useMemo(() => ({
    activeThemeId,
    committedThemeId,
    previewThemeId,
    commitTheme,
    previewTheme,
    revertPreview,
  }), [activeThemeId, commitTheme, committedThemeId, previewTheme, previewThemeId, revertPreview]);
}
