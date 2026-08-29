import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
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
const THEME_LEGACY_MIGRATION_KEY = "freed-theme-legacy-migration-v1";
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
type ThemePreferenceListener = () => void;
type AppliedThemeListener = () => void;

// Theme is installation-local. Historical synchronized values are migration
// input only, so a remote checkpoint cannot repaint this device.
const themePreferenceListeners = new Set<ThemePreferenceListener>();
const appliedThemeListeners = new Set<AppliedThemeListener>();
let currentThemeId = DEFAULT_THEME_ID;
let currentAppliedThemeId = DEFAULT_THEME_ID;
let themePreferenceHydrated = false;
let themeStorageListenerInstalled = false;

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

function emitThemePreferenceChange(): void {
  for (const listener of themePreferenceListeners) listener();
}

function emitAppliedThemeChange(): void {
  for (const listener of appliedThemeListeners) listener();
}

function installThemeStorageListener(): void {
  if (themeStorageListenerInstalled || typeof window === "undefined") return;
  themeStorageListenerInstalled = true;
  window.addEventListener("storage", (event) => {
    if (event.key !== THEME_STORAGE_KEY) return;
    const nextThemeId = resolveThemeId(event.newValue);
    themePreferenceHydrated = true;
    if (nextThemeId === currentThemeId) return;
    currentThemeId = nextThemeId;
    applyThemeToDocument(nextThemeId);
    emitThemePreferenceChange();
  });
}

export function getStoredThemeId(): ThemeId {
  if (!themePreferenceHydrated) {
    currentThemeId = typeof window === "undefined"
      ? DEFAULT_THEME_ID
      : resolveThemeId(window.localStorage.getItem(THEME_STORAGE_KEY));
    themePreferenceHydrated = true;
  }
  installThemeStorageListener();
  return currentThemeId;
}

export function applyThemeToDocument(themeId: ThemeId): void {
  if (typeof document === "undefined") return;
  const appliedThemeChanged = currentAppliedThemeId !== themeId;
  currentAppliedThemeId = themeId;
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

  if (appliedThemeChanged) emitAppliedThemeChange();
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

export function setThemePreference(themeId: ThemeId): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, themeId);
  } catch {
    return false;
  }
  const changed = currentThemeId !== themeId || !themePreferenceHydrated;
  currentThemeId = themeId;
  themePreferenceHydrated = true;
  installThemeStorageListener();
  if (changed) emitThemePreferenceChange();
  return true;
}

export function migrateLegacyThemePreference(value: unknown): boolean {
  if (typeof window === "undefined") return false;
  if (
    window.localStorage.getItem(THEME_STORAGE_KEY) !== null
    || window.localStorage.getItem(THEME_LEGACY_MIGRATION_KEY) === "complete"
  ) return false;
  const historicalTheme = typeof value === "object" && value !== null
    ? (value as Record<string, unknown>).themeId
    : value;
  const migratedThemeId = resolveThemeId(
    typeof historicalTheme === "string" ? historicalTheme : undefined,
  );
  if (!setThemePreference(migratedThemeId)) return false;
  window.localStorage.setItem(THEME_LEGACY_MIGRATION_KEY, "complete");
  applyThemeToDocument(migratedThemeId);
  return true;
}

function subscribeToThemePreference(listener: ThemePreferenceListener): () => void {
  themePreferenceListeners.add(listener);
  installThemeStorageListener();
  return () => themePreferenceListeners.delete(listener);
}

function subscribeToAppliedTheme(listener: AppliedThemeListener): () => void {
  appliedThemeListeners.add(listener);
  return () => appliedThemeListeners.delete(listener);
}

export function useThemePreference(): readonly [ThemeId, (themeId: ThemeId) => boolean] {
  const themeId = useSyncExternalStore(
    subscribeToThemePreference,
    getStoredThemeId,
    () => DEFAULT_THEME_ID,
  );
  return [themeId, setThemePreference] as const;
}

/** The theme currently painted on the document, including a transient preview. */
export function useAppliedThemeId(): ThemeId {
  return useSyncExternalStore(
    subscribeToAppliedTheme,
    () => currentAppliedThemeId,
    () => DEFAULT_THEME_ID,
  );
}

/** Remove this device's theme choice during a destructive local reset. */
export function resetThemePreference(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(THEME_STORAGE_KEY);
  // A reset must not let the obsolete synchronized value resurrect on restart.
  window.localStorage.setItem(THEME_LEGACY_MIGRATION_KEY, "complete");
  currentThemeId = DEFAULT_THEME_ID;
  themePreferenceHydrated = true;
  emitThemePreferenceChange();
}

export function resetThemePreferenceForTests(): void {
  currentThemeId = DEFAULT_THEME_ID;
  currentAppliedThemeId = DEFAULT_THEME_ID;
  themePreferenceHydrated = false;
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
  const previewThemeIdRef = useRef<ThemeId | null>(null);

  useEffect(() => {
    if (previewThemeId === committedThemeId) {
      previewThemeIdRef.current = null;
      setPreviewThemeId(null);
    }
  }, [committedThemeId, previewThemeId]);

  const activeThemeId = previewThemeId ?? committedThemeId;

  const previewTheme = useCallback((themeId: ThemeId) => {
    if (themeId === activeThemeId) {
      return;
    }

    const nextPreviewThemeId = themeId === committedThemeId ? null : themeId;
    previewThemeIdRef.current = nextPreviewThemeId;
    setPreviewThemeId(nextPreviewThemeId);
    transitionThemeOnDocument(themeId);
  }, [activeThemeId, committedThemeId]);

  const revertPreview = useCallback(() => {
    if (previewThemeIdRef.current === null) {
      return;
    }

    previewThemeIdRef.current = null;
    setPreviewThemeId(null);
    transitionThemeOnDocument(committedThemeId);
  }, [committedThemeId]);

  const commitTheme = useCallback((themeId: ThemeId) => {
    previewThemeIdRef.current = null;
    setPreviewThemeId(null);
    transitionThemeOnDocument(themeId);
    onCommitTheme(themeId);
  }, [onCommitTheme]);

  return useMemo(() => ({
    activeThemeId,
    committedThemeId,
    previewThemeId,
    commitTheme,
    previewTheme,
    revertPreview,
  }), [activeThemeId, commitTheme, committedThemeId, previewTheme, previewThemeId, revertPreview]);
}
