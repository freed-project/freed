/**
 * SettingsDialog — unified two-column settings experience.
 *
 * Desktop: left nav (search + section list) + right scrollable column with all
 * sections stacked. Scroll position drives scrollspy so the nav always reflects
 * which section is currently in view.
 *
 * Mobile: single-column. The nav is a full-screen list; tapping any section
 * "pushes" to that section's content with a back button (iOS-style).
 */

import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  formatReleaseVersion,
  RELEASE_CHANNEL_LABELS,
  RELEASE_CHANNELS,
  type ReleaseChannel,
} from "@freed/shared";
import { THEME_DEFINITIONS, type ThemeId } from "@freed/shared/themes";
import { createPortal } from "react-dom";
import { useAppStore, usePlatform } from "../context/PlatformContext.js";
import { describeInstalledBuild, readBuildMetadata } from "../lib/build-info.js";
import { useDebugStore } from "../lib/debug-store.js";
import { useSettingsStore } from "../lib/settings-store.js";
import { refreshSampleLibraryData } from "../lib/sample-library-seed.js";
import {
  applyThemeToDocument,
  persistTheme,
  useThemePreviewController,
} from "../lib/theme.js";
import {
  getProviderStatusLabel,
  getProviderStatusTone,
} from "../lib/provider-status.js";
import { ProviderStatusIndicator } from "./ProviderStatusIndicator.js";
import { toast } from "./Toast.js";
import { UpdateProgressBar } from "./UpdateProgressBar.js";
import {
  BASE_SECTION_METAS,
  UPDATES_SECTION_META,
  DANGER_SECTION_META,
  GOOGLE_CONTACTS_SECTION_META,
  X_SECTION_META,
  FB_SECTION_META,
  IG_SECTION_META,
  LI_SECTION_META,
  type SectionId,
  type SectionMeta,
} from "../lib/settings-sections.js";
import { FeedsSection } from "./settings/FeedsSection.js";
import { SavedSection } from "./settings/SavedSection.js";
import { SettingsToggle } from "./SettingsToggle.js";
import { ReportComposer } from "./report/ReportComposer.js";
import { SearchField } from "./SearchField.js";
import { ThemePreviewButton } from "./ThemePreviewButton.js";
import { Tooltip } from "./Tooltip.js";
import { GoogleContactsIcon } from "./icons.js";
import { useIsMobile } from "../hooks/useIsMobile.js";

const SAMPLE_SEED_FEED_COUNT = 10;
const SAMPLE_SEED_ITEM_COUNT = 155;
const SAMPLE_SEED_FRIEND_COUNT = 25;
// ── Types ─────────────────────────────────────────────────────────────────────

interface Section extends SectionMeta {
  icon: ReactNode;
}

/** A nav group (e.g. "Sources") containing child sections in the left nav. */
interface NavGroup {
  kind: "group";
  label: string;
  icon: ReactNode;
  children: Section[];
}

type NavStructureItem = Section | NavGroup;

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
}

type ProviderSectionId = Extract<SectionId, "x" | "facebook" | "instagram" | "linkedin">;
type ProviderAuthState = {
  isAuthenticated?: boolean;
  lastCaptureError?: string;
};
type ProviderAuthSlices = {
  xAuth?: ProviderAuthState;
  fbAuth?: ProviderAuthState;
  igAuth?: ProviderAuthState;
  liAuth?: ProviderAuthState;
};
const EMPTY_PROVIDER_SECTION_SYNC_COUNTS: Partial<Record<ProviderSectionId, number>> = {};
const INSTALLED_BUILD_PRESENTATION = describeInstalledBuild(readBuildMetadata());

function isProviderSection(sectionId: SectionId): sectionId is ProviderSectionId {
  return (
    sectionId === "x" ||
    sectionId === "facebook" ||
    sectionId === "instagram" ||
    sectionId === "linkedin"
  );
}

function ProviderStatusDot({ sectionId }: { sectionId: ProviderSectionId }) {
  const health = useDebugStore((s) => s.health);
  const providerSyncCounts = useAppStore(
    (s) =>
      ((s as unknown as { providerSyncCounts?: Partial<Record<ProviderSectionId, number>> })
        .providerSyncCounts ?? EMPTY_PROVIDER_SECTION_SYNC_COUNTS) as Partial<Record<ProviderSectionId, number>>,
  );
  const xAuth = useAppStore((s) => (s as unknown as ProviderAuthSlices).xAuth);
  const fbAuth = useAppStore((s) => (s as unknown as ProviderAuthSlices).fbAuth);
  const igAuth = useAppStore((s) => (s as unknown as ProviderAuthSlices).igAuth);
  const liAuth = useAppStore((s) => (s as unknown as ProviderAuthSlices).liAuth);

  const authState =
    sectionId === "x"
      ? xAuth
      : sectionId === "facebook"
        ? fbAuth
        : sectionId === "instagram"
          ? igAuth
          : liAuth;

  const snapshot = health?.providers[sectionId];
  const isConnected = authState?.isAuthenticated === true;
  const authError =
    typeof authState?.lastCaptureError === "string" ? authState.lastCaptureError : undefined;
  const tone = getProviderStatusTone({
    isConnected,
    authError,
    snapshot,
  });

  if (tone === "idle") {
    return null;
  }

  const label = getProviderStatusLabel({
    isConnected,
    authError,
    snapshot,
  });

  return (
    <div className="ml-auto flex h-4 w-4 shrink-0 items-center justify-center pl-2">
      <ProviderStatusIndicator
        tone={tone}
        syncing={(providerSyncCounts[sectionId] ?? 0) > 0}
        label={label}
        testId={`settings-provider-status-${sectionId}`}
        size="xxs"
      />
    </div>
  );
}
// ── Section icons ─────────────────────────────────────────────────────────────

/** Icon for the Sources nav group (not a section itself). */
const ICON_SOURCES = (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
  </svg>
);

const ICONS: Record<SectionId, ReactNode> = {
  legal: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 3l7.5 3v6c0 5.25-3.34 9.922-7.5 11.25C7.84 21.922 4.5 17.25 4.5 12V6L12 3z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 12.75l1.5 1.5 3-3.75" />
    </svg>
  ),
  support: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 8h10M7 12h7m-5 8l-4-4H4a2 2 0 01-2-2V6a2 2 0 012-2h16a2 2 0 012 2v8a2 2 0 01-2 2h-7l-4 4z" />
    </svg>
  ),
  appearance: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
    </svg>
  ),
  ai: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
    </svg>
  ),
  feeds: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 5c7.18 0 13 5.82 13 13M6 11a7 7 0 017 7M6 17a1 1 0 110-2 1 1 0 010 2z" />
    </svg>
  ),
  saved: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
    </svg>
  ),
  sync: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  ),
  updates: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
    </svg>
  ),
  danger: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
    </svg>
  ),
  x: (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.747l7.73-8.835L1.254 2.25H8.08l4.259 5.63 5.905-5.63zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z" />
    </svg>
  ),
  facebook: (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
    </svg>
  ),
  instagram: (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
    </svg>
  ),
  linkedin: (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
    </svg>
  ),
  googleContacts: (
    <GoogleContactsIcon />
  ),
};

// ── Update check state ────────────────────────────────────────────────────────

type UpdateCheckState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "up-to-date" }
  | { status: "available"; version: string; channel: ReleaseChannel }
  | { status: "error" };

// ── Main component ────────────────────────────────────────────────────────────

export function SettingsDialog({ open, onClose }: SettingsDialogProps) {
  const isMobile = useIsMobile();
  const {
    SettingsExtraSections,
    LegalSettingsContent,
    XSettingsContent,
    FacebookSettingsContent,
    InstagramSettingsContent,
    LinkedInSettingsContent,
    GoogleContactsSettingsContent,
    checkForUpdates,
    applyUpdate,
    headerDragRegion,
    factoryReset,
    activeCloudProviderLabel,
    seedSocialConnections,
    releaseChannel,
    setReleaseChannel,
    updateDownloadProgress,
  } = usePlatform();
  const preferences = useAppStore((s) => s.preferences);
  const updatePreferences = useAppStore((s) => s.updatePreferences);
  const toggleDebug = useDebugStore((s) => s.toggle);
  const themeBlurRestoreTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const themeSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingThemeIdRef = useRef<ThemeId | null>(null);
  const pendingThemeSaveSeqRef = useRef(0);
  const committedThemeIdRef = useRef(preferences.display.themeId);
  const baseSectionById = Object.fromEntries(BASE_SECTION_METAS.map((section) => [section.id, section])) as Record<
    Exclude<SectionId, "ai" | "updates" | "danger" | "googleContacts" | "x" | "facebook" | "instagram" | "linkedin">,
    SectionMeta
  >;

  // Flat section list — drives scrollspy and right-pane rendering.
  // Keywords live in settings-sections.ts so Header's command palette can share them.
  // ── AI section is coming soon -- preserve ICONS.ai, do not delete ──
  const allSections: Section[] = [
    { ...baseSectionById.appearance, icon: ICONS.appearance },
    { ...baseSectionById.sync, icon: ICONS.sync },
    ...(GoogleContactsSettingsContent ? [{ ...GOOGLE_CONTACTS_SECTION_META, icon: ICONS.googleContacts }] : []),
    { ...baseSectionById.saved, icon: ICONS.saved },
    ...(XSettingsContent ? [{ ...X_SECTION_META, icon: ICONS.x }] : []),
    ...(FacebookSettingsContent ? [{ ...FB_SECTION_META, icon: ICONS.facebook }] : []),
    ...(InstagramSettingsContent ? [{ ...IG_SECTION_META, icon: ICONS.instagram }] : []),
    ...(LinkedInSettingsContent ? [{ ...LI_SECTION_META, icon: ICONS.linkedin }] : []),
    { ...baseSectionById.feeds, icon: ICONS.feeds },
    ...(checkForUpdates ? [{ ...UPDATES_SECTION_META, icon: ICONS.updates }] : []),
    { ...baseSectionById.legal, icon: ICONS.legal },
    { ...baseSectionById.support, icon: ICONS.support },
    ...(factoryReset ? [{ ...DANGER_SECTION_META, icon: ICONS.danger }] : []),
  ];

  // Hierarchical nav structure — drives left sidebar rendering only.
  // Re-use the Section objects already defined in allSections so keywords stay in sync.
  const sectionById = Object.fromEntries(allSections.map((s) => [s.id, s])) as Record<SectionId, Section>;
  const navStructure: NavStructureItem[] = [
    sectionById.appearance,
    sectionById.sync,
    ...(GoogleContactsSettingsContent ? [sectionById.googleContacts] : []),
    {
      kind: "group",
      label: "Sources",
      icon: ICON_SOURCES,
      children: [
        sectionById.saved,
        ...(XSettingsContent ? [sectionById.x] : []),
        ...(FacebookSettingsContent ? [sectionById.facebook] : []),
        ...(InstagramSettingsContent ? [sectionById.instagram] : []),
        ...(LinkedInSettingsContent ? [sectionById.linkedin] : []),
        sectionById.feeds,
      ],
    },
    // sectionById.ai, // AI coming soon -- do not delete
    ...(checkForUpdates ? [sectionById.updates] : []),
    sectionById.legal,
    sectionById.support,
    ...(factoryReset ? [sectionById.danger] : []),
  ];

  // ── Preferences state ────────────────────────────────────────────────────
  const [display, setDisplay] = useState(() => preferences.display);
  const [themePreviewHovering, setThemePreviewHovering] = useState(false);
  const [themePreviewTouchActive, setThemePreviewTouchActive] = useState(false);
  const [hasCoarsePointer, setHasCoarsePointer] = useState(false);

  useEffect(() => {
    committedThemeIdRef.current = preferences.display.themeId;
  }, [preferences.display.themeId]);

  const handleDisplayChange = useCallback(
    (update: Partial<typeof display>) => {
      setDisplay((prev) => {
        const next = { ...prev, ...update };
        void updatePreferences({ display: next }).catch(() => {
          toast.error("Could not save settings");
        });
        return next;
      });
    },
    [updatePreferences],
  );

  const handleReadingChange = useCallback(
    (update: Partial<typeof display.reading>) => {
      setDisplay((prev) => {
        const next = { ...prev, reading: { ...prev.reading, ...update } };
        updatePreferences({ display: next });
        return next;
      });
    },
    [updatePreferences],
  );

  useEffect(() => {
    setDisplay(preferences.display);
  }, [preferences.display]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const coarsePointerMedia = window.matchMedia("(pointer: coarse)");
    const hoverCapableMedia = window.matchMedia("(any-hover: hover)");
    const updatePointerMode = () => {
      setHasCoarsePointer(coarsePointerMedia.matches && !hoverCapableMedia.matches);
    };

    updatePointerMode();
    coarsePointerMedia.addEventListener?.("change", updatePointerMode);
    hoverCapableMedia.addEventListener?.("change", updatePointerMode);
    return () => {
      coarsePointerMedia.removeEventListener?.("change", updatePointerMode);
      hoverCapableMedia.removeEventListener?.("change", updatePointerMode);
    };
  }, []);

  const flushPendingThemeSelection = useCallback((themeId: ThemeId, saveSeq: number) => {
    pendingThemeIdRef.current = null;
    void updatePreferences({ display: { themeId } } as Parameters<typeof updatePreferences>[0]).catch(() => {
      if (pendingThemeSaveSeqRef.current !== saveSeq) {
        return;
      }

      const committedThemeId = committedThemeIdRef.current;
      applyThemeToDocument(committedThemeId);
      persistTheme(committedThemeId);
      setDisplay((prev) => ({ ...prev, themeId: committedThemeId }));
      toast.error("Could not save settings");
    });
  }, [updatePreferences]);

  const flushPendingThemeSelectionNow = useCallback(() => {
    if (themeSaveTimerRef.current) {
      clearTimeout(themeSaveTimerRef.current);
      themeSaveTimerRef.current = null;
    }
    const pendingThemeId = pendingThemeIdRef.current;
    if (!pendingThemeId) {
      return;
    }
    flushPendingThemeSelection(pendingThemeId, pendingThemeSaveSeqRef.current);
  }, [flushPendingThemeSelection]);
  useEffect(() => {
    if (open) return;
    setThemePreviewHovering(false);
    setThemePreviewTouchActive(false);
    if (themeBlurRestoreTimerRef.current) {
      clearTimeout(themeBlurRestoreTimerRef.current);
      themeBlurRestoreTimerRef.current = null;
    }
    flushPendingThemeSelectionNow();
  }, [flushPendingThemeSelectionNow, open]);

  useEffect(() => {
    return () => {
      if (themeBlurRestoreTimerRef.current) {
        clearTimeout(themeBlurRestoreTimerRef.current);
      }
      flushPendingThemeSelectionNow();
    };
  }, [flushPendingThemeSelectionNow]);

  const activateTouchThemePreview = useCallback(() => {
    if (!hasCoarsePointer) return;
    setThemePreviewTouchActive(true);
    if (themeBlurRestoreTimerRef.current) {
      clearTimeout(themeBlurRestoreTimerRef.current);
    }
    themeBlurRestoreTimerRef.current = setTimeout(() => {
      setThemePreviewTouchActive(false);
      themeBlurRestoreTimerRef.current = null;
    }, 5000);
  }, [hasCoarsePointer]);

  const handleThemeCommit = useCallback((themeId: ThemeId) => {
    activateTouchThemePreview();
    setDisplay((prev) => (
      prev.themeId === themeId
        ? prev
        : { ...prev, themeId }
    ));
    persistTheme(themeId);

    pendingThemeSaveSeqRef.current += 1;
    const saveSeq = pendingThemeSaveSeqRef.current;
    pendingThemeIdRef.current = themeId;

    if (themeSaveTimerRef.current) {
      clearTimeout(themeSaveTimerRef.current);
    }
    themeSaveTimerRef.current = setTimeout(() => {
      themeSaveTimerRef.current = null;
      const pendingThemeId = pendingThemeIdRef.current;
      if (!pendingThemeId) {
        return;
      }
      flushPendingThemeSelection(pendingThemeId, saveSeq);
    }, 500);
  }, [activateTouchThemePreview, flushPendingThemeSelection]);

  const {
    revertPreview: revertThemePreview,
    previewTheme,
    commitTheme,
  } = useThemePreviewController({
    committedThemeId: display.themeId,
    onCommitTheme: handleThemeCommit,
  });

  const handleThemeCardMouseEnter = useCallback(() => {
    if (hasCoarsePointer) return;
    setThemePreviewHovering(true);
  }, [hasCoarsePointer]);

  const handleThemeCardMouseLeave = useCallback(() => {
    if (hasCoarsePointer) return;
    setThemePreviewHovering(false);
    revertThemePreview();
  }, [hasCoarsePointer, revertThemePreview]);

  const handleThemeCardFocusCapture = useCallback(() => {
    setThemePreviewHovering(true);
  }, []);

  const handleThemeCardBlurCapture = useCallback((event: React.FocusEvent<HTMLDivElement>) => {
    const nextFocused = event.relatedTarget;
    if (nextFocused && event.currentTarget.contains(nextFocused)) {
      return;
    }
    setThemePreviewHovering(false);
    revertThemePreview();
  }, [revertThemePreview]);

  const handleThemeButtonMouseEnter = useCallback((themeId: ThemeId) => {
    if (hasCoarsePointer) {
      return;
    }

    previewTheme(themeId);
  }, [hasCoarsePointer, previewTheme]);

  const handleThemeButtonFocus = useCallback((themeId: ThemeId) => {
    previewTheme(themeId);
  }, [previewTheme]);

  useEffect(() => {
    if (open) {
      return;
    }

    revertThemePreview();
  }, [open, revertThemePreview]);

  useEffect(() => {
    return () => {
      revertThemePreview();
    };
  }, [revertThemePreview]);

  const themeBackdropSuppressed = themePreviewHovering || themePreviewTouchActive;

  // ── Update check ─────────────────────────────────────────────────────────
  const [updateState, setUpdateState] = useState<UpdateCheckState>({ status: "idle" });
  const fadeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const shouldRecheckAfterChannelChangeRef = useRef(false);
  const displayVersion = formatReleaseVersion(__APP_VERSION__, releaseChannel ?? "production");

  const runUpdateCheck = useCallback(async () => {
    if (!checkForUpdates) return;

    setUpdateState({ status: "checking" });
    try {
      const update = await checkForUpdates();
      const next: UpdateCheckState = update
        ? { status: "available", version: update.version, channel: update.channel }
        : { status: "up-to-date" };
      setUpdateState(next);
      if (next.status === "up-to-date") {
        clearTimeout(fadeTimer.current);
        fadeTimer.current = setTimeout(() => setUpdateState({ status: "idle" }), 4000);
      }
    } catch {
      setUpdateState({ status: "error" });
      clearTimeout(fadeTimer.current);
      fadeTimer.current = setTimeout(() => setUpdateState({ status: "idle" }), 4000);
    }
  }, [checkForUpdates]);

  const handleCheckForUpdates = useCallback(async () => {
    await runUpdateCheck();
  }, [runUpdateCheck]);

  useEffect(() => {
    clearTimeout(fadeTimer.current);
    setUpdateState({ status: "idle" });

    if (!shouldRecheckAfterChannelChangeRef.current || !checkForUpdates) {
      return;
    }

    shouldRecheckAfterChannelChangeRef.current = false;
    void runUpdateCheck();
  }, [checkForUpdates, releaseChannel, runUpdateCheck]);

  useEffect(() => {
    return () => clearTimeout(fadeTimer.current);
  }, []);

  // ── Factory reset ─────────────────────────────────────────────────────────
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [deleteFromCloud, setDeleteFromCloud] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [showSampleSeedConfirm, setShowSampleSeedConfirm] = useState(false);

  const handleReset = useCallback(async () => {
    if (!factoryReset) return;
    setResetting(true);
    try {
      await factoryReset(deleteFromCloud);
    } catch {
      setResetting(false);
      setShowResetConfirm(false);
    }
  }, [factoryReset, deleteFromCloud]);

  // ── Seed sample data ───────────────────────────────────────────────────────
  const [seeding, setSeeding] = useState(false);
  const [seedDone, setSeedDone] = useState(false);
  const initialize = useAppStore((s) => s.initialize);
  const isInitialized = useAppStore((s) => s.isInitialized);
  const items = useAppStore((s) => s.items);
  const feeds = useAppStore((s) => s.feeds);
  const friends = useAppStore((s) => s.friends);
  const addFeed = useAppStore((s) => s.addFeed);
  const addItems = useAppStore((s) => s.addItems);
  const addFriends = useAppStore((s) => s.addFriends);
  const existingFeedCount = Object.keys(feeds).length;
  const existingFriendCount = Object.keys(friends).length;
  const existingItemCount = items.length;
  const hasExistingLibraryData =
    existingFeedCount > 0 || existingFriendCount > 0 || existingItemCount > 0;

  const handleSeedSampleData = useCallback(async () => {
    setSeeding(true);
    toast.info("Populating sample data...");
    try {
      await refreshSampleLibraryData({
        initialize,
        isInitialized,
        addFeed,
        addItems,
        addFriends,
        seedSocialConnections,
      });
      setSeedDone(true);
      toast.success(
        `Sample data added: ${SAMPLE_SEED_FEED_COUNT.toLocaleString()} feeds, ${SAMPLE_SEED_ITEM_COUNT.toLocaleString()} items, and ${SAMPLE_SEED_FRIEND_COUNT.toLocaleString()} friends.`
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to populate sample data");
    } finally {
      setSeeding(false);
    }
  }, [
    addFeed,
    addFriends,
    addItems,
    initialize,
    isInitialized,
    seedSocialConnections,
  ]);

  const requestSeedSampleData = useCallback(() => {
    if (hasExistingLibraryData) {
      setShowSampleSeedConfirm(true);
      return;
    }
    void handleSeedSampleData();
  }, [handleSeedSampleData, hasExistingLibraryData]);

  // ── Search ────────────────────────────────────────────────────────────────
  const [search, setSearch] = useState("");
  const searchLower = search.toLowerCase().trim();
  const visibleSections = searchLower
    ? allSections.filter((s) =>
        s.label.toLowerCase().includes(searchLower) ||
        s.keywords.some((k) => k.includes(searchLower)),
      )
    : allSections;

  // ── Scrollspy ────────────────────────────────────────────────────────────
  const [activeSection, setActiveSection] = useState<SectionId>("legal");
  const scrollRef = useRef<HTMLDivElement>(null);

  // Keep a ref in sync with updateState.status so scroll/visibility callbacks
  // always read the current value without needing to be re-created.
  const updateStatusRef = useRef(updateState.status);
  updateStatusRef.current = updateState.status;

  // Ref for the "Check for updates" button element.
  const checkButtonRef = useRef<HTMLDivElement>(null);

  // Auto-check when the button enters the scroll container's visible area.
  // Re-checks each time the button transitions from hidden → visible, so scrolling
  // away and back triggers a fresh check (once the previous check has settled).
  useEffect(() => {
    if (!open || !checkForUpdates) return;
    const root = scrollRef.current;
    if (!root) return;

    let wasVisible = false;
    let debounceTimer: ReturnType<typeof setTimeout> | undefined;

    const check = () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const btn = checkButtonRef.current;
        if (!btn) return;
        const rootRect = root.getBoundingClientRect();
        const btnRect = btn.getBoundingClientRect();
        const isVisible = btnRect.bottom > rootRect.top && btnRect.top < rootRect.bottom;

        if (isVisible && !wasVisible && updateStatusRef.current === "idle") {
          handleCheckForUpdates();
        }
        wasVisible = isVisible;
      }, 120);
    };

    check();
    root.addEventListener("scroll", check, { passive: true });
    return () => {
      clearTimeout(debounceTimer);
      root.removeEventListener("scroll", check);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, checkForUpdates]);
  // While true, scroll-driven updates are suppressed so intermediate sections
  // that drift through the trigger zone during a smooth-scroll animation don't
  // cause nav items to flicker.
  const isScrollingProgrammatically = useRef(false);
  const scrollEndTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // When search is cleared, restore scroll-driven active section detection.
  // When searching, highlight the first visible match.
  useEffect(() => {
    if (searchLower && visibleSections.length > 0) {
      setActiveSection(visibleSections[0].id);
    }
  }, [searchLower, visibleSections]);

  const scrollSectionIntoView = useCallback((id: SectionId, behavior: ScrollBehavior = "smooth") => {
    const container = scrollRef.current;
    if (!container) {
      return;
    }

    const el = container.querySelector<HTMLElement>(`[data-section="${id}"]`);
    if (!el) {
      return;
    }

    const targetTop = Math.max(0, el.offsetTop - 16);

    isScrollingProgrammatically.current = true;
    clearTimeout(scrollEndTimerRef.current);

    if (behavior === "auto") {
      container.scrollTop = targetTop;
      requestAnimationFrame(() => {
        isScrollingProgrammatically.current = false;
      });
      return;
    }

    const clearScrolling = () => {
      isScrollingProgrammatically.current = false;
    };

    container.addEventListener("scrollend", clearScrolling, { once: true });
    scrollEndTimerRef.current = setTimeout(clearScrolling, 800);

    container.scrollTo({ top: targetTop, behavior });
  }, []);

  // ── Mobile nav state ──────────────────────────────────────────────────────
  const [mobileView, setMobileView] = useState<"nav" | "section">("nav");

  useEffect(() => {
    const root = scrollRef.current;
    if (!root || searchLower || (isMobile && mobileView === "nav")) return;

    const updateActiveSectionFromScroll = () => {
      if (isScrollingProgrammatically.current) return;

      const sections = Array.from(
        root.querySelectorAll<HTMLElement>("[data-section]")
      );
      if (sections.length === 0) return;

      const activationOffset = 56;
      const scrollPosition = root.scrollTop + activationOffset;
      let nextActive = sections[0].dataset.section as SectionId;

      for (const section of sections) {
        const id = section.dataset.section as SectionId;
        if (section.offsetTop <= scrollPosition) {
          nextActive = id;
        } else {
          break;
        }
      }

      setActiveSection(nextActive);
    };

    updateActiveSectionFromScroll();
    root.addEventListener("scroll", updateActiveSectionFromScroll, { passive: true });
    window.addEventListener("resize", updateActiveSectionFromScroll);

    return () => {
      root.removeEventListener("scroll", updateActiveSectionFromScroll);
      window.removeEventListener("resize", updateActiveSectionFromScroll);
    };
  }, [isMobile, mobileView, open, searchLower]);

  const scrollToSection = useCallback((id: SectionId) => {
    setActiveSection(id);
    if (isMobile && mobileView === "nav") {
      setMobileView("section");
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          scrollSectionIntoView(id, "auto");
        });
      });
      return;
    }

    scrollSectionIntoView(id, "smooth");
    setMobileView("section");
  }, [isMobile, mobileView, scrollSectionIntoView]);

  // Reset state on close
  useEffect(() => {
    if (!open) {
      setSearch("");
      setMobileView("nav");
    }
  }, [open]);

  // Scroll to a programmatically requested section (e.g. nudge → Sync)
  const { targetSection, clearTarget } = useSettingsStore();
  useEffect(() => {
    if (!open || !targetSection) return;
    const rafId = requestAnimationFrame(() => {
      setActiveSection(targetSection as SectionId);
      setMobileView("section");
      requestAnimationFrame(() => {
        scrollSectionIntoView(targetSection as SectionId, "auto");
      });
      clearTarget();
    });
    return () => cancelAnimationFrame(rafId);
  }, [clearTarget, open, scrollSectionIntoView, targetSection]);

  // Body scroll lock
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  if (!open) return null;

  function CloseButton({
    className = "",
    testId,
  }: {
    className?: string;
    testId: string;
  }) {
    return (
      <button
        type="button"
        onClick={onClose}
        aria-label="Close settings"
        data-testid={testId}
        className={`inline-flex h-10 w-10 items-center justify-center rounded-[28px] text-[var(--theme-text-muted)] transition-colors hover:bg-[var(--theme-bg-muted)] hover:text-[var(--theme-text-primary)] ${className}`}
      >
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    );
  }

  // ── Section content renderer ──────────────────────────────────────────────

  function renderSectionBlock(id: SectionId) {
    const isVisible = visibleSections.some((s) => s.id === id);
    if (!isVisible) return null;

    // SectionContent and this wrapper both stay plain function calls because
    // they are defined inside SettingsDialog. Rendering either as JSX would
    // create a fresh component type on each parent re-render and remount the
    // active subtree, which is visible as periodic flicker in provider sections
    // when sync health updates land.
    return (
      <section data-section={id} className="pb-8 min-h-full flex flex-col">
        {SectionContent({ id })}
      </section>
    );
  }

  function SectionContent({ id }: { id: SectionId }) {
    switch (id) {
      case "appearance":
        return (
          <>
            <SectionHeading label="Appearance" />
            <div className="space-y-5">
              <div
                className="theme-card-soft theme-settings-theme-card rounded-2xl p-4 sm:p-5"
                onMouseEnter={handleThemeCardMouseEnter}
                onMouseLeave={handleThemeCardMouseLeave}
                onFocusCapture={handleThemeCardFocusCapture}
                onBlurCapture={handleThemeCardBlurCapture}
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="theme-settings-theme-card__label text-sm font-semibold text-text-primary">Theme</p>
                  <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
                    {THEME_DEFINITIONS.map((theme) => {
                      const isActive = display.themeId === theme.id;
                      return (
                        <Tooltip
                          key={theme.id}
                          side="top"
                          label={theme.name}
                          description={theme.description}
                          className="h-[2.2rem] items-center"
                        >
                          <ThemePreviewButton
                            theme={theme}
                            active={isActive}
                            variant="compact"
                            onMouseEnter={() => handleThemeButtonMouseEnter(theme.id as ThemeId)}
                            onFocus={() => handleThemeButtonFocus(theme.id as ThemeId)}
                            onClick={() => commitTheme(theme.id as ThemeId)}
                          />
                        </Tooltip>
                      );
                    })}
                  </div>
                </div>
              </div>
              <SettingsToggle
                label="Mark read on scroll"
                checked={display.reading.markReadOnScroll}
                onChange={(v) => handleReadingChange({ markReadOnScroll: v })}
                description="Mark items as read when you scroll past them in the feed"
              />
              <SettingsToggle
                label="Show read in grayscale"
                checked={display.reading.showReadInGrayscale}
                onChange={(v) => handleReadingChange({ showReadInGrayscale: v })}
                description="Desaturate items after they have been marked read"
              />
              <SettingsToggle
                label="Show engagement counts"
                checked={display.showEngagementCounts}
                onChange={(v) => handleDisplayChange({ showEngagementCounts: v })}
                description="Show likes, reposts, and views on posts"
              />
              <SettingsToggle
                label="Focus mode"
                checked={display.reading.focusMode}
                onChange={(v) => handleReadingChange({ focusMode: v })}
                description="Bold word beginnings to aid reading speed"
              />
              {display.reading.focusMode && (
                <div className="space-y-2">
                  <p className="text-sm text-text-secondary">Focus intensity</p>
                  <div className="flex gap-2">
                    {(["light", "normal", "strong"] as const).map((level) => (
                      <button
                        key={level}
                        onClick={() => handleReadingChange({ focusIntensity: level })}
                        className={`flex-1 py-1.5 rounded-lg text-sm capitalize transition-colors border ${
                          display.reading.focusIntensity === level
                            ? "bg-[color:color-mix(in_srgb,var(--theme-accent-secondary)_20%,transparent)] text-[var(--theme-accent-secondary)] border-[color:color-mix(in_srgb,var(--theme-accent-secondary)_30%,transparent)]"
                            : "bg-[color:color-mix(in_srgb,var(--theme-bg-surface)_72%,transparent)] text-text-muted hover:text-text-primary border-transparent"
                        }`}
                      >
                        {level}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm text-text-primary">Delete archived content after</p>
                  <p className="mt-0.5 text-xs text-text-muted">Saved items are never deleted</p>
                </div>
                <select
                  value={display.archivePruneDays ?? 30}
                  onChange={(e) => handleDisplayChange({ archivePruneDays: Number(e.target.value) })}
                  className="theme-input theme-select shrink-0 rounded-xl px-3 py-2 text-sm text-text-primary focus:outline-none"
                >
                  <option value={3}>3 days</option>
                  <option value={7}>7 days</option>
                  <option value={30}>30 days</option>
                  <option value={90}>90 days</option>
                  <option value={0}>Never</option>
                </select>
              </div>
            </div>
          </>
        );

      case "legal":
        return (
          <>
            <SectionHeading label="Legal" />
            {LegalSettingsContent ? <LegalSettingsContent /> : null}
          </>
        );

      case "support":
        return (
          <>
            <SectionHeading label="Support" />
            <ReportComposer />
          </>
        );

      case "x":
        return XSettingsContent ? (
          <>
            <SectionHeading label="X / Twitter" />
            <XSettingsContent surface="settings" />
          </>
        ) : null;

      case "facebook":
        return FacebookSettingsContent ? (
          <>
            <SectionHeading label="Facebook" />
            <FacebookSettingsContent surface="settings" />
          </>
        ) : null;

      case "instagram":
        return InstagramSettingsContent ? (
          <>
            <SectionHeading label="Instagram" />
            <InstagramSettingsContent surface="settings" />
          </>
        ) : null;

      case "linkedin":
        return LinkedInSettingsContent ? (
          <>
            <SectionHeading label="LinkedIn" />
            <LinkedInSettingsContent surface="settings" />
          </>
        ) : null;

      case "googleContacts":
        return GoogleContactsSettingsContent ? (
          <>
            <SectionHeading label="Google Contacts" />
            <GoogleContactsSettingsContent />
          </>
        ) : null;

      case "ai":
        // AI section is coming soon -- AISection component is preserved, do not delete.
        return null;

      case "feeds":
        return (
          <>
            <SectionHeading label="Feeds" />
            <FeedsSection />
          </>
        );

      case "saved":
        return (
          <>
            <SectionHeading label="Saved Content" />
            <SavedSection />
          </>
        );

      case "sync":
        return (
          <div className="flex flex-col flex-1">
            <SectionHeading label="Sync" />
            {SettingsExtraSections && <SettingsExtraSections />}
          </div>
        );

      case "updates":
        return (
          <>
            <SectionHeading label="Updates" />
            <div className="space-y-3">
              <p className="text-xs text-text-muted">
                Installed version:{" "}
                <span className="text-sm font-bold font-mono">v{displayVersion}</span>
              </p>
              {INSTALLED_BUILD_PRESENTATION && (
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="rounded-full bg-[color:color-mix(in_srgb,var(--theme-bg-surface)_88%,transparent)] px-2 py-0.5 font-semibold text-text-primary">
                    {INSTALLED_BUILD_PRESENTATION.badgeLabel}
                  </span>
                  <span className="text-text-muted">{INSTALLED_BUILD_PRESENTATION.detail}</span>
                </div>
              )}
              {releaseChannel && setReleaseChannel && (
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm text-text-primary">Release channel</p>
                    <p className="mt-0.5 text-xs text-text-muted">
                      Changing this affects future update checks. It does not change the installed version until an update is installed. Dev auto-deploys every merge to the dev branch, and snapshot builds keep the last release version with a build label.
                    </p>
                  </div>
                  <select
                    data-testid="settings-release-channel-select"
                    value={releaseChannel}
                    onChange={(event) => {
                      const nextChannel = event.target.value as ReleaseChannel;
                      if (nextChannel === releaseChannel) {
                        return;
                      }
                      shouldRecheckAfterChannelChangeRef.current = true;
                      void setReleaseChannel(nextChannel);
                    }}
                    className="theme-input theme-select shrink-0 rounded-xl px-3 py-2 text-sm text-text-primary focus:outline-none"
                  >
                    {RELEASE_CHANNELS.map((channel) => (
                      <option key={channel} value={channel}>
                        {RELEASE_CHANNEL_LABELS[channel]}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {checkForUpdates && (
                <div ref={checkButtonRef} className="flex items-center gap-3">
                  <button
                    onClick={handleCheckForUpdates}
                    disabled={updateState.status === "checking" || updateDownloadProgress?.phase === "downloading"}
                    className="text-sm px-3 py-1.5 rounded-lg bg-[color:color-mix(in_srgb,var(--theme-bg-surface)_72%,transparent)] hover:bg-[color:color-mix(in_srgb,var(--theme-bg-surface)_88%,transparent)] text-text-secondary hover:text-text-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {updateState.status === "checking" ? (
                      <span className="flex items-center gap-2">
                        <span className="h-3 w-3 animate-spin rounded-full border-2 border-[var(--theme-accent-secondary)] border-t-transparent" />
                        Checking&hellip;
                      </span>
                    ) : (
                      "Check for updates"
                    )}
                  </button>
                  {updateState.status === "up-to-date" && <UpToDateBadge />}
                  {updateState.status === "available" && (
                    <span className="flex items-center gap-2">
                      <span className="text-xs text-[var(--theme-accent-secondary)]">
                        Update available on {RELEASE_CHANNEL_LABELS[updateState.channel]}
                      </span>
                      {applyUpdate && (
                        <button
                          onClick={applyUpdate}
                          disabled={updateDownloadProgress?.phase === "downloading"}
                          className="btn-primary px-2.5 py-1 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {headerDragRegion ? "Install & Restart" : "Reload"}
                        </button>
                      )}
                    </span>
                  )}
                  {updateState.status === "error" && (
                    <span className="theme-feedback-text-danger text-xs">Check failed</span>
                  )}
                </div>
              )}
              {updateDownloadProgress?.phase === "downloading" && (
                <div className="space-y-1.5">
                  <p className="text-xs text-text-secondary">
                    Downloading... {Math.round(updateDownloadProgress.percent)}%
                  </p>
                  <UpdateProgressBar percent={updateDownloadProgress.percent} />
                </div>
              )}
              {updateDownloadProgress?.phase === "error" && (
                <p className="theme-feedback-text-danger text-xs">{updateDownloadProgress.message}</p>
              )}
            </div>
          </>
        );

      case "danger":
        return factoryReset ? (
          <>
            <SectionHeading label="Danger Zone" danger />
            <div className="space-y-6">
              <button
                onClick={() => {
                  onClose();
                  setTimeout(toggleDebug, 150);
                }}
                className="w-full rounded-xl bg-[var(--theme-bg-muted)] px-3 py-2.5 text-left transition-colors hover:bg-[var(--theme-bg-card-hover)]"
              >
                <div>
                  <p className="text-sm text-[var(--theme-text-secondary)]">Open Debug Panel</p>
                  <p className="mt-0.5 text-xs text-[var(--theme-text-soft)]">Sync diagnostics, event log, document inspector</p>
                </div>
                <span className="ml-3 shrink-0 text-[10px] font-mono text-[var(--theme-text-soft)]">⌘⇧D</span>
              </button>
              <button
                onClick={requestSeedSampleData}
                disabled={seeding}
                className="theme-feedback-panel-warning w-full flex items-center justify-between rounded-xl px-3 py-2.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50"
              >
                <div>
                  <p className="theme-feedback-text-warning text-sm">
                    {seedDone ? "Add more sample data" : seeding ? "Populating\u2026" : "Populate sample data"}
                  </p>
                  <p className="theme-feedback-text-warning-muted mt-0.5 text-xs">
                    {seedDone
                      ? `Adds another ${SAMPLE_SEED_FEED_COUNT.toLocaleString()} feeds, ${SAMPLE_SEED_ITEM_COUNT.toLocaleString()} items, ${SAMPLE_SEED_FRIEND_COUNT.toLocaleString()} friends, and map-ready social activity`
                      : `Adds ${SAMPLE_SEED_FEED_COUNT.toLocaleString()} RSS feeds, ${SAMPLE_SEED_ITEM_COUNT.toLocaleString()} items, ${SAMPLE_SEED_FRIEND_COUNT.toLocaleString()} friends, and location-linked social data`}
                  </p>
                </div>
                {seedDone ? (
                  <svg className="theme-feedback-text-warning-muted ml-3 h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                ) : seeding ? (
                  <svg className="theme-feedback-text-warning-muted ml-3 h-4 w-4 shrink-0 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                ) : (
                  <svg className="theme-feedback-text-warning-muted ml-3 h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                )}
              </button>
              <button
                onClick={() => setShowResetConfirm(true)}
                className="theme-feedback-panel-danger w-full flex items-center justify-between rounded-xl px-3 py-2.5 text-left transition-colors"
              >
                <div>
                  <p className="theme-feedback-text-danger text-sm">Reset this device</p>
                  <p className="mt-0.5 text-xs text-[rgb(var(--theme-feedback-danger-rgb)/0.72)]">Wipes all local data and restarts fresh</p>
                </div>
                <svg className="ml-3 h-4 w-4 shrink-0 text-[rgb(var(--theme-feedback-danger-rgb)/0.56)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          </>
        ) : null;
    }
  }

  // ── Left nav ──────────────────────────────────────────────────────────────

  /** Single nav button shared by top-level sections and group children. */
  function NavButton({
    section,
    indented = false,
  }: {
    section: Section;
    indented?: boolean;
  }) {
    const isActive = activeSection === section.id;
    const isDanger = section.id === "danger";
    return (
      <button
        onClick={() => scrollToSection(section.id)}
        aria-current={isActive ? "location" : undefined}
        data-active={isActive ? "true" : "false"}
        className={`w-full flex items-center gap-2 text-left text-xs transition-colors rounded-md ${
          indented ? "pl-7 pr-2 py-2" : "px-2 py-2"
        } ${
          isActive
            ? "bg-[color:color-mix(in_srgb,var(--theme-accent-secondary)_15%,transparent)] text-[var(--theme-accent-secondary)]"
            : isDanger
            ? "text-[rgb(var(--theme-feedback-danger-rgb)/0.72)] hover:text-[rgb(var(--theme-feedback-danger-rgb))] hover:bg-[rgb(var(--theme-feedback-danger-rgb)/0.05)]"
            : "text-text-secondary hover:text-text-primary hover:bg-[color:color-mix(in_srgb,var(--theme-bg-surface)_72%,transparent)]"
        }`}
      >
        <span className={`shrink-0 ${isActive ? "text-[var(--theme-accent-secondary)]" : isDanger ? "text-[rgb(var(--theme-feedback-danger-rgb)/0.64)]" : "text-text-muted"}`}>
          {section.icon}
        </span>
        <span>{section.label}</span>
        {isProviderSection(section.id) ? (
          <ProviderStatusDot sectionId={section.id} />
        ) : null}
      </button>
    );
  }

  const NavList = () => {
    // When searching, collapse to a flat filtered list for simplicity.
    if (searchLower) {
      return (
        <nav className="flex-1 overflow-y-auto py-2 px-3 space-y-1">
          {visibleSections.map((section) => (
            <NavButton key={section.id} section={section} />
          ))}
        </nav>
      );
    }

    return (
      <nav className="flex-1 overflow-y-auto py-2 px-3 space-y-1">
        {navStructure.map((item) => {
          if ("kind" in item) {
            // Group header + indented children
            const isGroupActive = item.children.some((c) => c.id === activeSection);
            return (
              <div key={item.label} className="space-y-0.5">
                {/* Clicking the group header jumps to its first child section */}
        <button
                  onClick={() => scrollToSection(item.children[0].id)}
                  aria-current={isGroupActive ? "location" : undefined}
                  data-active={isGroupActive ? "true" : "false"}
                  className={`w-full flex items-center gap-2 px-2 py-2 text-left text-xs transition-colors rounded-md ${
                    isGroupActive
                      ? "text-[var(--theme-accent-secondary)]"
                      : "text-text-secondary hover:text-text-primary hover:bg-[color:color-mix(in_srgb,var(--theme-bg-surface)_72%,transparent)]"
                  }`}
                >
                  <span className={`shrink-0 ${isGroupActive ? "text-[var(--theme-accent-secondary)]" : "text-text-muted"}`}>
                    {item.icon}
                  </span>
                  <span>{item.label}</span>
                </button>
                {item.children.map((child) => (
                  <NavButton key={child.id} section={child} indented />
                ))}
              </div>
            );
          }
          // Regular top-level section
          return <NavButton key={item.id} section={item} />;
        })}
      </nav>
    );
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-6">
      {/* Backdrop */}
      <div
        className={`theme-settings-overlay absolute inset-0 ${themeBackdropSuppressed ? "theme-settings-overlay-preview-off" : ""}`}
        onClick={onClose}
      />

      {/* Panel */}
      <div
        className={`
          theme-dialog-shell theme-settings-shell relative z-10 flex w-full flex-col
          h-[100dvh] rounded-none
          sm:rounded-[28px]
          sm:flex-row sm:max-w-3xl sm:h-[80vh] sm:max-h-[700px]
        `}
      >
        {/* ── Left column ────────────────────────────────────────────────── */}
        <div
          className={`
            theme-dialog-divider flex shrink-0 flex-col border-b
            sm:w-52 sm:border-b-0 sm:border-r
            ${mobileView === "section" ? "hidden sm:flex" : "flex"}
          `}
        >
          {/* Header */}
          <div className="relative hidden shrink-0 items-center justify-center px-2 pt-4 pb-2 sm:flex">
            <CloseButton
              testId="settings-close-button-sidebar"
              className="absolute left-2"
            />
            <h2 className="text-base font-semibold text-center text-text-primary">Settings</h2>
          </div>

          <div
            className="flex shrink-0 items-center justify-between px-4 pb-1.5 pt-2 sm:hidden"
            style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 0.5rem)" }}
          >
            <h2 className="text-sm font-semibold text-text-primary">Settings</h2>
            <CloseButton
              testId="settings-close-button-sidebar-mobile"
              className="-mr-1"
            />
          </div>

          {/* Search */}
          <div className="px-3 pb-2 pt-1 shrink-0 sm:pt-2">
            <SearchField
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onClear={() => setSearch("")}
              placeholder="Search settings"
              aria-label="Search settings"
              density="compact"
            />
          </div>

          <NavList />

          {/* Footer — desktop sidebar only */}
          <div className="theme-dialog-divider hidden shrink-0 items-center justify-between border-t px-4 py-3 sm:flex">
            {checkForUpdates ? (
              <button
                onClick={() => {
                  setSearch("");
                  scrollToSection("updates");
                }}
                className="text-xs font-mono text-text-muted transition-colors tabular-nums hover:text-text-secondary"
              >
                v{displayVersion}
              </button>
            ) : (
              <span className="text-xs font-mono text-text-muted tabular-nums">
                v{displayVersion}
              </span>
            )}
            <a
              href="https://freed.wtf"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-text-muted transition-colors hover:text-[var(--theme-accent-secondary)]"
            >
              freed.wtf
            </a>
          </div>
        </div>

        {/* ── Right column ────────────────────────────────────────────────── */}
        <div
          className={`
            flex-1 flex flex-col overflow-hidden
            ${mobileView === "nav" ? "hidden sm:flex" : "flex"}
          `}
        >
          {/* Mobile back button + section title */}
          <div
            className="theme-dialog-divider sm:hidden flex shrink-0 items-center justify-between gap-3 border-b px-4 pb-2 pt-2"
            style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 0.5rem)" }}
          >
            <button
              onClick={() => setMobileView("nav")}
              className="-ml-1 flex min-w-0 items-center gap-1.5 rounded-lg px-1.5 py-1.5 text-text-secondary transition-colors hover:bg-[color:color-mix(in_srgb,var(--theme-bg-surface)_72%,transparent)] hover:text-text-primary"
              aria-label="Back to settings"
            >
              <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              <span className="truncate text-sm font-medium text-text-primary">
                {allSections.find((s) => s.id === activeSection)?.label}
              </span>
            </button>
            <CloseButton
              testId="settings-close-button-mobile"
              className="-mr-1 shrink-0"
            />
          </div>

          {/* Scrollable sections */}
          <div
            ref={scrollRef}
            data-testid="settings-scroll-container"
            className="flex-1 overflow-y-auto px-6 pt-6 [&>section+section]:mt-14"
            style={{ paddingBottom: "calc(2rem + env(safe-area-inset-bottom, 0px))" }}
          >
            {searchLower && visibleSections.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center gap-2 pb-16 text-center">
                <svg className="h-8 w-8 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <p className="text-sm text-text-muted">No settings match <span className="text-text-secondary">"{search}"</span></p>
              </div>
            ) : (
              allSections.map((section) => (
                <Fragment key={section.id}>{renderSectionBlock(section.id)}</Fragment>
              ))
            )}

            {/* Footer — mobile + narrow screens */}
            <div className="sm:hidden text-center pb-4">
              <a
                href="https://freed.wtf"
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-text-muted transition-colors hover:text-[var(--theme-accent-secondary)]"
              >
                freed.wtf
              </a>
            </div>
          </div>
        </div>
      </div>

      {/* Factory reset confirmation overlay */}
      {showResetConfirm && (
        <div className="theme-elevated-overlay absolute inset-0 z-20 flex items-start justify-center overflow-y-auto p-4 sm:items-center">
          <div className="theme-dialog-shell my-auto max-h-[calc(100dvh-2rem)] w-full max-w-sm overflow-y-auto p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-[rgb(var(--theme-feedback-danger-rgb)/0.15)]">
                <svg className="h-5 w-5 theme-feedback-text-danger" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-semibold text-text-primary">Reset this device?</p>
                <p className="mt-0.5 text-xs text-text-secondary">
                  Clears all local data on this device only.
                  {!deleteFromCloud && " Cloud sync will re-download your data on next launch."}
                </p>
              </div>
            </div>

            {activeCloudProviderLabel?.() && (
              <label className="flex items-start gap-3 mb-5 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={deleteFromCloud}
                  onChange={(e) => setDeleteFromCloud(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-[var(--theme-border-quiet)] bg-[var(--theme-bg-input)] text-[rgb(var(--theme-feedback-danger-rgb))] focus:ring-[rgb(var(--theme-feedback-danger-rgb))] focus:ring-offset-0"
                />
                <div>
                  <p className="text-sm text-text-secondary transition-colors group-hover:text-text-primary">
                    Also delete from {activeCloudProviderLabel()}
                  </p>
                  <p className="mt-0.5 text-xs text-text-muted">Permanently removes your cloud backup</p>
                </div>
              </label>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => { setShowResetConfirm(false); setDeleteFromCloud(false); }}
                disabled={resetting}
                className="flex-1 rounded-xl bg-[color:color-mix(in_srgb,var(--theme-bg-surface)_72%,transparent)] py-2.5 text-sm text-text-secondary transition-colors hover:bg-[color:color-mix(in_srgb,var(--theme-bg-surface)_90%,transparent)] hover:text-text-primary disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleReset}
                disabled={resetting}
                className="theme-feedback-button-danger flex-1 py-2.5 text-sm font-medium disabled:opacity-50"
              >
                {resetting ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="h-3 w-3 animate-spin rounded-full border-2 border-[rgb(var(--theme-feedback-danger-rgb))] border-t-transparent" />
                    Resetting&hellip;
                  </span>
                ) : (
                  "Reset Device"
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {showSampleSeedConfirm && (
        <div className="theme-elevated-overlay absolute inset-0 z-20 flex items-start justify-center overflow-y-auto p-4 sm:items-center">
          <div className="theme-dialog-shell my-auto max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-[rgb(var(--theme-feedback-warning-rgb)/0.15)]">
                <svg className="h-5 w-5 theme-feedback-text-warning" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3m0 4h.01m-7.938 4h15.876c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L2.33 17c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-semibold text-text-primary">Populate sample data into a non-empty library?</p>
                <p className="mt-0.5 text-xs text-text-secondary">
                  This app already contains data. Sample content will be appended to what is already here, which can make the feed, map, and friends views noisy.
                </p>
              </div>
            </div>

            <div className="theme-feedback-panel-warning mb-5 rounded-xl px-4 py-3">
              <p className="theme-feedback-text-warning text-xs leading-5">
                Existing library contents detected:
                {" "}
                {existingFeedCount.toLocaleString()} feeds,
                {" "}
                {existingItemCount.toLocaleString()} items,
                {" "}
                {existingFriendCount.toLocaleString()} friends.
              </p>
              <p className="theme-feedback-text-warning-muted mt-2 text-xs leading-5">
                Continue only if you intend to append a fresh sample batch on this device.
              </p>
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setShowSampleSeedConfirm(false)}
                className="flex-1 rounded-xl border border-[color:var(--theme-border)] px-4 py-2.5 text-text-secondary transition-colors hover:bg-[color:color-mix(in_srgb,var(--theme-bg-surface)_72%,transparent)] hover:text-text-primary"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowSampleSeedConfirm(false);
                  void handleSeedSampleData();
                }}
                className="theme-feedback-button-warning flex-1 px-4 py-2.5"
              >
                Populate anyway
              </button>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}

// ── Up-to-date badge ──────────────────────────────────────────────────────────

function UpToDateBadge() {
  return (
    <>
      <style>{`
        @keyframes _utd-badge-in {
          from { opacity: 0; transform: translateY(3px) scale(0.94); }
          to   { opacity: 1; transform: translateY(0)  scale(1);    }
        }
        @keyframes _utd-ring {
          0%   { transform: scale(1);   opacity: 0.5; }
          100% { transform: scale(2);   opacity: 0;   }
        }
        @keyframes _utd-check {
          from { stroke-dashoffset: 22; }
          to   { stroke-dashoffset: 0;  }
        }
        ._utd-badge { animation: _utd-badge-in 0.28s cubic-bezier(0.34,1.56,0.64,1) both; }
        ._utd-ring  { animation: _utd-ring  0.55s ease-out 0.08s both; }
        ._utd-check { animation: _utd-check 0.38s ease-out 0.18s both;
                      stroke-dasharray: 22; stroke-dashoffset: 22; }
      `}</style>
      <span className="_utd-badge flex items-center gap-2">
        <span className="relative flex items-center justify-center w-[18px] h-[18px] shrink-0">
          {/* Ripple ring */}
          <span className="_utd-ring absolute inset-0 rounded-full bg-[rgb(var(--theme-feedback-success-rgb)/0.25)]" />
          {/* Circle + animated check */}
          <svg viewBox="0 0 18 18" fill="none" className="w-[18px] h-[18px]">
            <circle cx="9" cy="9" r="8" stroke="rgb(var(--theme-feedback-success-rgb) / 0.35)" strokeWidth="1.5" />
            <path
              d="M5.5 9l2.5 2.5 4.5-5"
              stroke="rgb(var(--theme-feedback-success-rgb))"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="_utd-check"
            />
          </svg>
        </span>
        <span className="text-xs text-[rgb(var(--theme-feedback-success-rgb))]">You're up to date</span>
      </span>
    </>
  );
}

// ── Section heading ───────────────────────────────────────────────────────────

function SectionHeading({ label, danger }: { label: string; danger?: boolean }) {
  return (
    <h3
      className={`text-sm font-semibold uppercase tracking-wide mb-5 ${
        danger ? "text-[rgb(var(--theme-feedback-danger-rgb)/0.64)]" : "text-text-muted"
      }`}
    >
      {label}
    </h3>
  );
}
