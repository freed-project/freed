/**
 * SettingsDialog — unified two-column settings experience.
 *
 * Desktop: left nav (search + section list) + right scrollable column with all
 * sections stacked. Scroll position drives scrollspy so the nav always reflects
 * which section is currently in view.
 *
 * Mobile: single-column with stacked sections and compact spacing.
 */

import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  formatReleaseVersion,
  RELEASE_CHANNEL_LABELS,
  RELEASE_CHANNELS,
  SAMPLE_SHOWCASE_FEED_COUNT,
  SAMPLE_SHOWCASE_FRIEND_COUNT,
  SAMPLE_SHOWCASE_ITEM_COUNT,
  SAMPLE_SHOWCASE_SOCIAL_IDENTITY_COUNT,
  stripReleaseChannelSuffix,
  type AnimationIntensity,
  type ReleaseChannel,
} from "@freed/shared";
import { THEME_DEFINITIONS, type ThemeId } from "@freed/shared/themes";
import { createPortal } from "react-dom";
import {
  useAppStore,
  usePlatform,
  type ChangelogPreviewRelease,
} from "../context/PlatformContext.js";
import { describeInstalledBuild, readBuildMetadata } from "../lib/build-info.js";
import { useDebugStore } from "../lib/debug-store.js";
import { useSettingsStore } from "../lib/settings-store.js";
import {
  formatSampleDataSummary,
  refreshSampleLibraryData,
  summarizeSampleData,
} from "../lib/sample-library-seed.js";
import {
  applyThemeToDocument,
  persistTheme,
  useThemePreviewController,
} from "../lib/theme.js";
import { animationAwareScrollBehavior } from "../lib/animation-preferences.js";
import {
  getProviderStatusLabel,
  getProviderStatusTone,
} from "../lib/provider-status.js";
import {
  READER_OFFLINE_CACHE_MODE_DESCRIPTIONS,
  READER_OFFLINE_CACHE_MODE_LABELS,
  useReaderOfflineCacheMode,
  type ReaderOfflineCacheMode,
} from "../lib/reader-cache-settings.js";
import { ProviderStatusIndicator } from "./ProviderStatusIndicator.js";
import { toast } from "./Toast.js";
import { UpdateProgressBar } from "./UpdateProgressBar.js";
import {
  buildSettingsSectionMetas,
  type SectionId,
  type SectionMeta,
} from "../lib/settings-sections.js";
import { FeedsSection } from "./settings/FeedsSection.js";
import { SavedSection } from "./settings/SavedSection.js";
import { AISection } from "./settings/AISection.js";
import { StoryWallView } from "./story-wall/StoryWallView.js";
import { SettingsToggle } from "./SettingsToggle.js";
import { ReportComposer } from "./report/ReportComposer.js";
import { SearchField } from "./SearchField.js";
import { ThemePreviewButton } from "./ThemePreviewButton.js";
import { Tooltip } from "./Tooltip.js";
import { ExternalLinkIcon, GoogleContactsIcon, StoryWallIcon } from "./icons.js";
import { useIsMobile } from "../hooks/useIsMobile.js";
import { useHasTouchOnlyPointer } from "../hooks/useHasTouchOnlyPointer.js";

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

type SettingsScrollAnchor = {
  sectionId: SectionId;
  offset: number;
};

const ANIMATION_OPTIONS: ReadonlyArray<{ value: AnimationIntensity; label: string }> = [
  { value: "none", label: "None" },
  { value: "light", label: "Light" },
  { value: "detailed", label: "Detailed" },
];

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
const SETTINGS_OVERVIEW_ROW_TEXT = "text-base sm:text-xs";
const SETTINGS_SCROLL_OPTIMIZATION_RESTORE_MS = 380;
const CHANGELOG_DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
});

function formatChangelogDate(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return CHANGELOG_DATE_FORMATTER.format(date);
}

function inferInstalledReleaseChannelFromChangelog(
  version: string,
  releases: ChangelogPreviewRelease[] | undefined,
): ReleaseChannel | null {
  const baseVersion = stripReleaseChannelSuffix(version);
  let hasDevRelease = false;
  let hasProductionRelease = false;

  for (const release of releases ?? []) {
    if (stripReleaseChannelSuffix(release.version) !== baseVersion) {
      continue;
    }

    if (release.channel === "dev") {
      hasDevRelease = true;
    } else {
      hasProductionRelease = true;
    }
  }

  if (hasDevRelease && !hasProductionRelease) {
    return "dev";
  }

  if (hasProductionRelease && !hasDevRelease) {
    return "production";
  }

  return null;
}

function getSettingsChangelogUrl(channel: ReleaseChannel): string {
  return channel === "dev"
    ? "https://freed.wtf/changelog/all"
    : "https://freed.wtf/changelog";
}

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

function ChangelogPreviewList({
  releases,
  fullChangelogUrl,
  openUrl,
}: {
  releases: ChangelogPreviewRelease[];
  fullChangelogUrl: string;
  openUrl?: (url: string) => void;
}) {
  if (releases.length === 0) {
    return null;
  }

  const linkClassName = "btn-secondary inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold";

  return (
    <section
      className="space-y-2 pt-5"
      aria-label="Recent releases"
      data-testid="settings-changelog-preview"
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-text-primary">Recent releases</p>
        </div>
        {openUrl ? (
          <button
            type="button"
            onClick={() => openUrl(fullChangelogUrl)}
            className={linkClassName}
          >
            Show full changelog
            <ExternalLinkIcon className="h-3.5 w-3.5" />
          </button>
        ) : (
          <a
            href={fullChangelogUrl}
            target="_blank"
            rel="noreferrer"
            className={linkClassName}
          >
            Show full changelog
            <ExternalLinkIcon className="h-3.5 w-3.5" />
          </a>
        )}
      </div>
      <div className="max-h-96 space-y-2 overflow-y-auto pr-1">
        {releases.map((release) => {
          const dateLabel = formatChangelogDate(release.date);

          return (
            <article
              key={`${release.channel}:${release.version}`}
              className="rounded-lg border border-[var(--theme-border-subtle)] bg-[color:color-mix(in_srgb,var(--theme-bg-surface)_68%,transparent)] px-3 py-2.5"
            >
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                <span className="font-mono font-semibold text-text-primary">
                  v{formatReleaseVersion(release.version, release.channel)}
                </span>
                <span className="rounded-full bg-[var(--theme-bg-muted)] px-2 py-0.5 font-semibold text-text-muted">
                  {RELEASE_CHANNEL_LABELS[release.channel]}
                </span>
                {dateLabel && <span className="text-text-muted">{dateLabel}</span>}
              </div>
              <p className="mt-1.5 text-sm leading-5 text-text-primary">{release.summary}</p>
              {release.items.length > 0 && (
                <ul className="mt-2 space-y-1 text-xs leading-5 text-text-muted">
                  {release.items.map((item) => (
                    <li key={item} className="flex gap-2">
                      <span aria-hidden="true" className="mt-2 h-1 w-1 shrink-0 rounded-full bg-current" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
// ── Section icons ─────────────────────────────────────────────────────────────

/** Icon for the Sources nav group (not a section itself). */
const ICON_SOURCES = (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
  </svg>
);

/** Icon for the Beta nav group (not a section itself). */
const ICON_BETA = (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 3.5l1.6 4.9 5.1 1.1-3.5 3.7.5 5.2-4.7-2.2-4.7 2.2.5-5.2-3.5-3.7 5.1-1.1L12 3.5z" />
  </svg>
);

const ICONS: Record<SectionId, ReactNode> = {
  legal: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 3l7.5 3v6c0 5.25-3.34 9.922-7.5 11.25C7.84 21.922 4.5 17.25 4.5 12V6L12 3z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 12.75l1.5 1.5 3-3.75" />
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
  storyWall: (
    <StoryWallIcon />
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
    FeedsSettingsContent,
    addRssFeed,
    importOPMLFeeds,
    exportFeedsAsOPML,
    googleContacts,
    secureStorage,
    localAIModels,
    checkForUpdates,
    changelogPreview,
    applyUpdate,
    headerDragRegion,
    factoryReset,
    activeCloudProviderLabel,
    openUrl,
    seedSocialConnections,
    releaseChannel,
    installedReleaseChannel,
    setReleaseChannel,
    updateDownloadProgress,
  } = usePlatform();
  const preferences = useAppStore((s) => s.preferences);
  const updatePreferences = useAppStore((s) => s.updatePreferences);
  const toggleDebug = useDebugStore((s) => s.toggle);
  const themeBlurRestoreTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollOptimizationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const themeSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingThemeIdRef = useRef<ThemeId | null>(null);
  const pendingThemeSaveSeqRef = useRef(0);
  const committedThemeIdRef = useRef(preferences.display.themeId);
  const settingsShellRef = useRef<HTMLDivElement>(null);
  const settingsOverlayRef = useRef<HTMLDivElement>(null);
  const [readerOfflineCacheMode, setReaderOfflineCacheMode] = useReaderOfflineCacheMode();
  // Flat section list — drives scrollspy and right-pane rendering.
  // Keywords live in settings-sections.ts so Header's command palette can share them.
  const allSections: Section[] = useMemo(
    () =>
      buildSettingsSectionMetas({
        hasFeedManagement: !!(addRssFeed || importOPMLFeeds || exportFeedsAsOPML),
        hasGoogleContacts: !!GoogleContactsSettingsContent,
        hasGoogleContactsManagement: !!googleContacts,
        hasAISettings: !!(secureStorage || localAIModels),
        hasX: !!XSettingsContent,
        hasFacebook: !!FacebookSettingsContent,
        hasInstagram: !!InstagramSettingsContent,
        hasLinkedIn: !!LinkedInSettingsContent,
        hasUpdateChecks: !!checkForUpdates,
        hasFactoryReset: !!factoryReset,
      }).map((section) => ({
        ...section,
        icon: ICONS[section.id],
      })),
    [
      addRssFeed,
      importOPMLFeeds,
      exportFeedsAsOPML,
      GoogleContactsSettingsContent,
      XSettingsContent,
      FacebookSettingsContent,
      InstagramSettingsContent,
      LinkedInSettingsContent,
      checkForUpdates,
      factoryReset,
      googleContacts,
      localAIModels,
      secureStorage,
    ],
  );

  // Hierarchical nav structure — drives left sidebar rendering only.
  // Re-use the Section objects already defined in allSections so keywords stay in sync.
  const sectionById = useMemo(
    () => Object.fromEntries(allSections.map((s) => [s.id, s])) as Partial<Record<SectionId, Section>>,
    [allSections],
  );
  const navStructure: NavStructureItem[] = useMemo(
    () => [
      sectionById.appearance!,
      sectionById.sync!,
      {
        kind: "group",
        label: "Sources",
        icon: ICON_SOURCES,
        children: [
          sectionById.saved!,
          ...(sectionById.googleContacts ? [sectionById.googleContacts] : []),
          ...(sectionById.x ? [sectionById.x] : []),
          ...(sectionById.facebook ? [sectionById.facebook] : []),
          ...(sectionById.instagram ? [sectionById.instagram] : []),
          ...(sectionById.linkedin ? [sectionById.linkedin] : []),
          sectionById.feeds!,
        ],
      },
      {
        kind: "group",
        label: "Beta",
        icon: ICON_BETA,
        children: [
          ...(sectionById.ai ? [sectionById.ai] : []),
          ...(sectionById.storyWall ? [sectionById.storyWall] : []),
        ],
      },
      ...(sectionById.updates ? [sectionById.updates] : []),
      sectionById.legal!,
      ...(sectionById.danger ? [sectionById.danger] : []),
    ],
    [
      sectionById,
    ],
  );
  // ── Preferences state ────────────────────────────────────────────────────
  const [display, setDisplay] = useState(() => preferences.display);
  const [themePreviewHovering, setThemePreviewHovering] = useState(false);
  const [themePreviewTouchActive, setThemePreviewTouchActive] = useState(false);
  const hasCoarsePointer = useHasTouchOnlyPointer();

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
    delete settingsShellRef.current?.dataset.moving;
    delete settingsOverlayRef.current?.dataset.moving;
    if (themeBlurRestoreTimerRef.current) {
      clearTimeout(themeBlurRestoreTimerRef.current);
      themeBlurRestoreTimerRef.current = null;
    }
    if (scrollOptimizationTimerRef.current) {
      clearTimeout(scrollOptimizationTimerRef.current);
      scrollOptimizationTimerRef.current = null;
    }
    flushPendingThemeSelectionNow();
  }, [flushPendingThemeSelectionNow, open]);

  useEffect(() => {
    return () => {
      if (themeBlurRestoreTimerRef.current) {
        clearTimeout(themeBlurRestoreTimerRef.current);
      }
      if (scrollOptimizationTimerRef.current) {
        clearTimeout(scrollOptimizationTimerRef.current);
      }
      delete settingsShellRef.current?.dataset.moving;
      delete settingsOverlayRef.current?.dataset.moving;
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

  const suppressSettingsChromeDuringScroll = useCallback(() => {
    const shell = settingsShellRef.current;
    if (shell && shell.dataset.moving !== "true") {
      shell.dataset.moving = "true";
    }
    const overlay = settingsOverlayRef.current;
    if (overlay && overlay.dataset.moving !== "true") {
      overlay.dataset.moving = "true";
    }

    if (scrollOptimizationTimerRef.current) {
      clearTimeout(scrollOptimizationTimerRef.current);
    }
    scrollOptimizationTimerRef.current = setTimeout(() => {
      delete settingsShellRef.current?.dataset.moving;
      delete settingsOverlayRef.current?.dataset.moving;
      scrollOptimizationTimerRef.current = null;
    }, SETTINGS_SCROLL_OPTIMIZATION_RESTORE_MS);
  }, []);

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
  // Keep a ref in sync with updateState.status so scroll/visibility callbacks
  // always read the current value without needing to be re-created.
  const updateStatusRef = useRef(updateState.status);
  updateStatusRef.current = updateState.status;
  const fadeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const shouldRecheckAfterChannelChangeRef = useRef(false);
  const inferredInstalledReleaseChannel = inferInstalledReleaseChannelFromChangelog(
    __APP_VERSION__,
    changelogPreview,
  );
  const resolvedInstalledReleaseChannel =
    installedReleaseChannel === "dev"
      ? installedReleaseChannel
      : inferredInstalledReleaseChannel ?? installedReleaseChannel ?? releaseChannel;
  const displayVersion = formatReleaseVersion(
    __APP_VERSION__,
    resolvedInstalledReleaseChannel,
  );
  const selectedReleaseChannel = releaseChannel ?? "production";
  const fullChangelogUrl = getSettingsChangelogUrl(selectedReleaseChannel);
  const visibleChangelogPreview = (changelogPreview ?? [])
    .filter((release) => selectedReleaseChannel === "dev" || release.channel === "production")
    .slice(0, 5);

  const runUpdateCheck = useCallback(async () => {
    if (!checkForUpdates) return;

    updateStatusRef.current = "checking";
    setUpdateState({ status: "checking" });
    try {
      const update = await checkForUpdates();
      const next: UpdateCheckState = update
        ? { status: "available", version: update.version, channel: update.channel }
        : { status: "up-to-date" };
      updateStatusRef.current = next.status;
      setUpdateState(next);
      if (next.status === "up-to-date") {
        clearTimeout(fadeTimer.current);
        fadeTimer.current = setTimeout(() => {
          updateStatusRef.current = "idle";
          setUpdateState({ status: "idle" });
        }, 4000);
      }
    } catch {
      updateStatusRef.current = "error";
      setUpdateState({ status: "error" });
      clearTimeout(fadeTimer.current);
      fadeTimer.current = setTimeout(() => {
        updateStatusRef.current = "idle";
        setUpdateState({ status: "idle" });
      }, 4000);
    }
  }, [checkForUpdates]);

  const handleCheckForUpdates = useCallback(async () => {
    if (updateStatusRef.current !== "idle") {
      return;
    }

    await runUpdateCheck();
  }, [runUpdateCheck]);

  useEffect(() => {
    clearTimeout(fadeTimer.current);
    updateStatusRef.current = "idle";
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
  const [showSampleClearConfirm, setShowSampleClearConfirm] = useState(false);
  const [supportModalOpen, setSupportModalOpen] = useState(false);

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
  const persons = useAppStore((s) => s.persons);
  const accounts = useAppStore((s) => s.accounts);
  const addSampleLibraryData = useAppStore((s) => s.addSampleLibraryData);
  const clearSampleData = useAppStore((s) => s.clearSampleData);
  const [clearingSampleData, setClearingSampleData] = useState(false);
  const existingFeedCount = Object.keys(feeds).length;
  const existingFriendCount = Object.keys(friends).length;
  const existingItemCount = items.length;
  const sampleDataSummary = useMemo(
    () => summarizeSampleData({ items, feeds, persons, accounts }),
    [accounts, feeds, items, persons],
  );
  const hasSampleData = sampleDataSummary.total > 0;
  const hasExistingLibraryData =
    existingFeedCount > 0 || existingFriendCount > 0 || existingItemCount > 0;

  const handleSeedSampleData = useCallback(async () => {
    setSeeding(true);
    toast.info("Populating sample data...");
    try {
      await refreshSampleLibraryData({
        initialize,
        isInitialized,
        addSampleLibraryData,
        seedSocialConnections,
      });
      setSeedDone(true);
      toast.success(
        `Sample data added: ${SAMPLE_SHOWCASE_FEED_COUNT.toLocaleString()} feeds, ${SAMPLE_SHOWCASE_ITEM_COUNT.toLocaleString()} items, ${SAMPLE_SHOWCASE_FRIEND_COUNT.toLocaleString()} friends, and ${SAMPLE_SHOWCASE_SOCIAL_IDENTITY_COUNT.toLocaleString()} social identities.`
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to populate sample data");
    } finally {
      setSeeding(false);
    }
  }, [
    addSampleLibraryData,
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

  const handleClearSampleData = useCallback(async () => {
    setClearingSampleData(true);
    toast.info("Clearing sample data...");
    try {
      const summary = await clearSampleData();
      setSeedDone(false);
      setShowSampleClearConfirm(false);
      toast.success(`Sample data cleared: ${formatSampleDataSummary(summary)}.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to clear sample data");
    } finally {
      setClearingSampleData(false);
    }
  }, [clearSampleData]);

  // ── Search ────────────────────────────────────────────────────────────────
  const [search, setSearch] = useState("");
  const searchLower = search.toLowerCase().trim();
  const visibleSections = useMemo(
    () =>
      searchLower
        ? allSections.filter((s) =>
            s.label.toLowerCase().includes(searchLower) ||
            s.keywords.some((k) => k.includes(searchLower)),
          )
        : allSections,
    [allSections, searchLower],
  );

  // ── Scrollspy ────────────────────────────────────────────────────────────
  const [activeSection, setActiveSection] = useState<SectionId>("appearance");
  const [mobileView, setMobileView] = useState<"nav" | "section">("nav");
  const [scrollportHeight, setScrollportHeight] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeSectionBreadcrumb = useMemo(() => {
    const section = allSections.find((candidate) => candidate.id === activeSection);
    if (!section) return ["Freed Settings"];

    for (const item of navStructure) {
      if ("kind" in item && item.children.some((child) => child.id === section.id)) {
        return ["Freed Settings", item.label, section.label];
      }
    }

    return ["Freed Settings", section.label];
  }, [activeSection, allSections, navStructure]);
  const activeSectionRef = useRef(activeSection);
  const scrollAnchorRef = useRef<SettingsScrollAnchor>({ sectionId: "appearance", offset: 0 });
  const renderedSectionIds = useMemo(() => {
    if (isMobile || searchLower) {
      return new Set(visibleSections.map((section) => section.id));
    }

    const activeIndex = Math.max(0, allSections.findIndex((section) => section.id === activeSection));
    const ids = new Set<SectionId>();
    for (let index = Math.max(0, activeIndex - 1); index <= Math.min(allSections.length - 1, activeIndex + 1); index += 1) {
      ids.add(allSections[index].id);
    }
    return ids;
  }, [activeSection, allSections, isMobile, searchLower, visibleSections]);

  // Ref for the "Check for updates" button element.
  const checkButtonRef = useRef<HTMLDivElement>(null);
  const MOBILE_CONTENT_TOP_INSET = 20;
  const DESKTOP_SECTION_TOP_INSET = 20;
  const scrollContainerBottomPadding = isMobile
    ? "calc(2rem + env(safe-area-inset-bottom, 0px))"
    : "calc(8rem + env(safe-area-inset-bottom, 0px))";
  const desktopSectionMinHeight = scrollportHeight > 0
    ? `${scrollportHeight}px`
    : "calc(100dvh - 8rem)";

  useEffect(() => {
    activeSectionRef.current = activeSection;
  }, [activeSection]);

  // Auto-check when the button enters the scroll container's visible area.
  // Re-checks each time the button transitions from hidden → visible, so scrolling
  // away and back triggers a fresh check (once the previous check has settled).
  useEffect(() => {
    if (!open || !checkForUpdates) return;
    const root = scrollRef.current;
    if (!root) return;

    let wasVisible = false;
    let debounceTimer: ReturnType<typeof setTimeout> | undefined;

    const setVisible = (isVisible: boolean) => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        if (isVisible && !wasVisible && updateStatusRef.current === "idle") {
          handleCheckForUpdates();
        }
        wasVisible = isVisible;
      }, 120);
    };

    const checkNow = () => {
      const btn = checkButtonRef.current;
      if (!btn) return;
      const rootRect = root.getBoundingClientRect();
      const btnRect = btn.getBoundingClientRect();
      setVisible(btnRect.bottom > rootRect.top && btnRect.top < rootRect.bottom);
    };

    if (typeof IntersectionObserver === "undefined") {
      checkNow();
      root.addEventListener("scroll", checkNow, { passive: true });
      return () => {
        clearTimeout(debounceTimer);
        root.removeEventListener("scroll", checkNow);
      };
    }

    const btn = checkButtonRef.current;
    if (!btn) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        setVisible(entry?.isIntersecting === true);
      },
      { root, threshold: 0 },
    );
    observer.observe(btn);
    return () => {
      clearTimeout(debounceTimer);
      observer.disconnect();
    };
  }, [activeSection, checkForUpdates, handleCheckForUpdates, open, renderedSectionIds]);
  // While true, scroll-driven updates are suppressed so intermediate sections
  // that drift through the trigger zone during a smooth-scroll animation don't
  // cause nav items to flicker.
  const isScrollingProgrammatically = useRef(false);
  const scrollEndTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const updateScrollAnchorFromPosition = useCallback((): SectionId | null => {
    const container = scrollRef.current;
    if (!container) {
      return null;
    }

    const sections = Array.from(container.querySelectorAll<HTMLElement>("[data-section]"));
    if (sections.length === 0) {
      return null;
    }

    const scrollPosition = container.scrollTop + 56;
    let anchorSection = sections[0];
    for (const section of sections) {
      if (section.offsetTop <= scrollPosition) {
        anchorSection = section;
      } else {
        break;
      }
    }

    const sectionId = anchorSection.dataset.section as SectionId;
    scrollAnchorRef.current = {
      sectionId,
      offset: container.scrollTop - anchorSection.offsetTop,
    };
    return sectionId;
  }, []);

  const setScrollAnchorForSection = useCallback((id: SectionId, scrollTop?: number) => {
    const container = scrollRef.current;
    if (!container) {
      scrollAnchorRef.current = { sectionId: id, offset: 0 };
      return;
    }

    const section = container.querySelector<HTMLElement>(`[data-section="${id}"]`);
    scrollAnchorRef.current = {
      sectionId: id,
      offset: section ? (scrollTop ?? container.scrollTop) - section.offsetTop : 0,
    };
  }, []);

  const restoreScrollAnchor = useCallback(() => {
    if (isMobile || searchLower) {
      return;
    }

    const container = scrollRef.current;
    if (!container) {
      return;
    }

    const { sectionId, offset } = scrollAnchorRef.current;
    const section = container.querySelector<HTMLElement>(`[data-section="${sectionId}"]`);
    if (!section) {
      return;
    }

    const nextScrollTop = Math.max(0, section.offsetTop + offset);
    if (Math.abs(container.scrollTop - nextScrollTop) < 1) {
      return;
    }

    isScrollingProgrammatically.current = true;
    clearTimeout(scrollEndTimerRef.current);
    container.scrollTop = nextScrollTop;
    scrollEndTimerRef.current = setTimeout(() => {
      isScrollingProgrammatically.current = false;
    }, 120);
  }, [isMobile, searchLower]);

  // When search is cleared, restore scroll-driven active section detection.
  // When searching, highlight the first visible match.
  useEffect(() => {
    if (searchLower && visibleSections.length > 0) {
      setActiveSection(visibleSections[0].id);
    }
  }, [searchLower, visibleSections]);

  const resolveSectionScrollTarget = useCallback((id: SectionId) => {
    const container = scrollRef.current;
    if (!container) {
      return null;
    }

    const el = container.querySelector<HTMLElement>(`[data-section="${id}"]`);
    if (!el) {
      return null;
    }

    const contentAnchor = el.querySelector<HTMLElement>(":scope > :nth-child(2)");
    const targetNode = isMobile ? (contentAnchor ?? el) : el;
    const topInset = isMobile ? MOBILE_CONTENT_TOP_INSET : DESKTOP_SECTION_TOP_INSET;
    const containerRect = container.getBoundingClientRect();
    const targetRect = targetNode.getBoundingClientRect();
    const targetTop = Math.max(
      0,
      container.scrollTop + (targetRect.top - containerRect.top) - topInset,
    );

    return { container, targetTop };
  }, [isMobile]);

  const scrollSectionIntoView = useCallback((id: SectionId, behavior: ScrollBehavior = "smooth") => {
    const target = resolveSectionScrollTarget(id);
    if (!target) {
      return;
    }

    const { container, targetTop } = target;

    setScrollAnchorForSection(id, targetTop);
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
      const settledTarget = resolveSectionScrollTarget(id);
      if (settledTarget) {
        const delta = Math.abs(settledTarget.container.scrollTop - settledTarget.targetTop);
        if (delta > 1) {
          settledTarget.container.scrollTop = settledTarget.targetTop;
        }
      }
      isScrollingProgrammatically.current = false;
      clearTimeout(scrollEndTimerRef.current);
    };

    container.addEventListener("scrollend", clearScrolling, { once: true });
    scrollEndTimerRef.current = setTimeout(clearScrolling, 800);

    container.scrollTo({ top: targetTop, behavior: animationAwareScrollBehavior(behavior) });
  }, [resolveSectionScrollTarget, setScrollAnchorForSection]);

  useEffect(() => {
    const root = scrollRef.current;
    if (!root || searchLower || (isMobile && mobileView === "nav")) return;
    let scrollIdleTimer: ReturnType<typeof setTimeout> | undefined;
    const supportsScrollEnd = "onscrollend" in root;

    const updateActiveSectionFromScroll = () => {
      if (isScrollingProgrammatically.current) return;

      const nextActive = updateScrollAnchorFromPosition();
      if (!nextActive) return;

      if (nextActive !== activeSectionRef.current) {
        activeSectionRef.current = nextActive;
        setActiveSection(nextActive);
      }
    };

    const scheduleActiveSectionUpdate = () => {
      suppressSettingsChromeDuringScroll();
      clearTimeout(scrollIdleTimer);
      scrollIdleTimer = setTimeout(() => {
        if (isScrollingProgrammatically.current) {
          updateScrollAnchorFromPosition();
          return;
        }
        updateActiveSectionFromScroll();
      }, 140);
    };

    updateActiveSectionFromScroll();
    root.addEventListener("scroll", scheduleActiveSectionUpdate, { passive: true });
    if (supportsScrollEnd) {
      root.addEventListener("scrollend", updateActiveSectionFromScroll);
    }

    return () => {
      clearTimeout(scrollIdleTimer);
      root.removeEventListener("scroll", scheduleActiveSectionUpdate);
      if (supportsScrollEnd) {
        root.removeEventListener("scrollend", updateActiveSectionFromScroll);
      }
    };
  }, [isMobile, mobileView, open, searchLower, suppressSettingsChromeDuringScroll, updateScrollAnchorFromPosition]);

  useEffect(() => {
    if (!open || isMobile || searchLower) {
      return;
    }

    const container = scrollRef.current;
    if (!container) {
      return;
    }

    const updateMeasuredHeight = (height: number) => {
      setScrollportHeight((currentHeight) =>
        Math.abs(currentHeight - height) < 1 ? currentHeight : height,
      );
    };

    let previousHeight = container.clientHeight;
    updateMeasuredHeight(previousHeight);

    const scheduleRestore = () => {
      const nextHeight = container.clientHeight;
      if (Math.abs(nextHeight - previousHeight) < 1) {
        return;
      }
      previousHeight = nextHeight;
      updateMeasuredHeight(nextHeight);

      restoreScrollAnchor();
    };

    const observer = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(scheduleRestore);
    observer?.observe(container);
    window.addEventListener("resize", scheduleRestore);

    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", scheduleRestore);
    };
  }, [isMobile, open, restoreScrollAnchor, searchLower]);

  useLayoutEffect(() => {
    if (!open || isMobile || searchLower || scrollportHeight <= 0) {
      return;
    }

    restoreScrollAnchor();
  }, [isMobile, open, restoreScrollAnchor, scrollportHeight, searchLower]);

  const scrollToSection = useCallback((id: SectionId) => {
    setActiveSection(id);
    activeSectionRef.current = id;
    if (isMobile && mobileView === "nav") {
      isScrollingProgrammatically.current = true;
      clearTimeout(scrollEndTimerRef.current);
      setMobileView("section");
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          scrollSectionIntoView(id, "auto");
          setActiveSection(id);
        });
      });
      return;
    }

    scrollSectionIntoView(id, "smooth");
    setMobileView("section");
  }, [isMobile, mobileView, scrollSectionIntoView]);

  const jumpToUpdatesFromVersion = useCallback(() => {
    if (!checkForUpdates) {
      return;
    }

    setSearch("");
    void handleCheckForUpdates();
    if (!searchLower) {
      scrollToSection("updates");
      return;
    }

    setActiveSection("updates");
    activeSectionRef.current = "updates";
    setMobileView("section");
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        scrollSectionIntoView("updates", "smooth");
      });
    });
  }, [checkForUpdates, handleCheckForUpdates, scrollSectionIntoView, scrollToSection, searchLower]);

  // Reset state on close
  useEffect(() => {
    if (!open) {
      setSearch("");
      setMobileView("nav");
      setSupportModalOpen(false);
      scrollAnchorRef.current = { sectionId: "appearance", offset: 0 };
    }
  }, [open]);

  // Scroll to a programmatically requested section.
  const { targetSection, clearTarget } = useSettingsStore();
  useEffect(() => {
    if (!open || !targetSection) return;
    if (targetSection === "support") {
      setSupportModalOpen(true);
      clearTarget();
      return;
    }
    if (!allSections.some((section) => section.id === targetSection)) {
      clearTarget();
      return;
    }
    const rafId = requestAnimationFrame(() => {
      setActiveSection(targetSection as SectionId);
      activeSectionRef.current = targetSection as SectionId;
      isScrollingProgrammatically.current = true;
      clearTimeout(scrollEndTimerRef.current);
      setMobileView("section");
      requestAnimationFrame(() => {
        scrollSectionIntoView(targetSection as SectionId, "auto");
        setActiveSection(targetSection as SectionId);
      });
      clearTarget();
    });
    return () => cancelAnimationFrame(rafId);
  }, [allSections, clearTarget, open, scrollSectionIntoView, targetSection]);

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
    testId?: string;
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
    const sectionStyle: CSSProperties | undefined = isMobile
      ? undefined
      : {
          minHeight: desktopSectionMinHeight,
          contain: "layout paint style",
        };
    const shouldRenderContent = renderedSectionIds.has(id);

    // SectionContent and this wrapper both stay plain function calls because
    // they are defined inside SettingsDialog. Rendering either as JSX would
    // create a fresh component type on each parent re-render and remount the
    // active subtree, which is visible as periodic flicker in provider sections
    // when sync health updates land.
    return (
      <section
        data-section={id}
        className={isMobile ? "flex flex-col pb-2" : "flex flex-col pb-8"}
        style={sectionStyle}
      >
        {shouldRenderContent ? SectionContent({ id }) : null}
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
              <div className="space-y-2">
                <p className="text-sm text-text-secondary">Animations</p>
                <div className="flex gap-2">
                  {ANIMATION_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => handleDisplayChange({ animationIntensity: option.value })}
                      className={`flex-1 rounded-lg border py-1.5 text-sm transition-colors ${
                        display.animationIntensity === option.value
                          ? "bg-[color:color-mix(in_srgb,var(--theme-accent-secondary)_20%,transparent)] text-[var(--theme-accent-secondary)] border-[color:color-mix(in_srgb,var(--theme-accent-secondary)_30%,transparent)]"
                          : "bg-[color:color-mix(in_srgb,var(--theme-bg-surface)_72%,transparent)] text-text-muted hover:text-text-primary border-transparent"
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm text-text-primary">Offline reader cache</p>
                  <p className="mt-0.5 text-xs text-text-muted">
                    {READER_OFFLINE_CACHE_MODE_DESCRIPTIONS[readerOfflineCacheMode]} This setting stays on this device.
                  </p>
                </div>
                <select
                  value={readerOfflineCacheMode}
                  onChange={(e) => setReaderOfflineCacheMode(e.target.value as ReaderOfflineCacheMode)}
                  className="theme-input theme-select shrink-0 rounded-xl px-3 py-2 text-sm text-text-primary focus:outline-none"
                >
                  {Object.entries(READER_OFFLINE_CACHE_MODE_LABELS).map(([mode, label]) => (
                    <option key={mode} value={mode}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
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
        return (
          <>
            <AISection />
          </>
        );

      case "feeds":
        return (
          <>
            <SectionHeading label="Feeds" />
            {FeedsSettingsContent ? <FeedsSettingsContent /> : <FeedsSection />}
          </>
        );

      case "saved":
        return (
          <>
            <SectionHeading label="Saved Content" />
            <SavedSection />
          </>
        );

      case "storyWall":
        return (
          <>
            <SectionHeading label="Story Wall" />
            <StoryWallView variant="settings" />
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
                    className="btn-primary rounded-lg px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
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
              <ChangelogPreviewList
                releases={visibleChangelogPreview}
                fullChangelogUrl={fullChangelogUrl}
                openUrl={openUrl}
              />
            </div>
          </>
        );

      case "danger":
        return factoryReset ? (
          <>
            <SectionHeading label="Danger Zone" danger />
            <div className="space-y-3 sm:space-y-6">
              <button
                onClick={() => setSupportModalOpen(true)}
                className="w-full rounded-xl bg-[var(--theme-bg-muted)] px-3 py-2.5 text-left transition-colors hover:bg-[var(--theme-bg-card-hover)]"
              >
                <div>
                  <p className="text-sm text-[var(--theme-text-secondary)]">Submit support ticket</p>
                  <p className="mt-0.5 text-xs text-[var(--theme-text-soft)]">Share diagnostics and describe what broke</p>
                </div>
              </button>
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
                    {seedDone ? "Add more sample data" : seeding ? "Populating..." : "Populate sample data"}
                  </p>
                  <p className="theme-feedback-text-warning-muted mt-0.5 text-xs">
                    {seedDone
                      ? `Adds another ${SAMPLE_SHOWCASE_FEED_COUNT.toLocaleString()} feeds, ${SAMPLE_SHOWCASE_ITEM_COUNT.toLocaleString()} items, ${SAMPLE_SHOWCASE_FRIEND_COUNT.toLocaleString()} friends, ${SAMPLE_SHOWCASE_SOCIAL_IDENTITY_COUNT.toLocaleString()} social identities, and map-ready activity`
                      : `Adds ${SAMPLE_SHOWCASE_FEED_COUNT.toLocaleString()} RSS feeds, ${SAMPLE_SHOWCASE_ITEM_COUNT.toLocaleString()} items, ${SAMPLE_SHOWCASE_FRIEND_COUNT.toLocaleString()} friends, ${SAMPLE_SHOWCASE_SOCIAL_IDENTITY_COUNT.toLocaleString()} social identities, and location-linked data`}
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
              {hasSampleData && (
                <button
                  onClick={() => setShowSampleClearConfirm(true)}
                  disabled={clearingSampleData}
                  className="theme-feedback-panel-danger w-full flex items-center justify-between rounded-xl px-3 py-2.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <div>
                    <p className="theme-feedback-text-danger text-sm">
                      {clearingSampleData ? "Clearing sample data..." : "Clear sample data"}
                    </p>
                    <p className="mt-0.5 text-xs text-[rgb(var(--theme-feedback-danger-rgb)/0.72)]">
                      Removes only internally marked sample records: {formatSampleDataSummary(sampleDataSummary)}
                    </p>
                  </div>
                  <svg className="ml-3 h-4 w-4 shrink-0 text-[rgb(var(--theme-feedback-danger-rgb)/0.56)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3m-8 0h10" />
                  </svg>
                </button>
              )}
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
        className={`w-full flex items-center gap-2 text-left ${SETTINGS_OVERVIEW_ROW_TEXT} transition-colors rounded-md ${
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
                  className={`w-full flex items-center gap-2 px-2 py-2 text-left ${SETTINGS_OVERVIEW_ROW_TEXT} transition-colors rounded-md ${
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
        ref={settingsOverlayRef}
        className={`theme-settings-overlay absolute inset-0 ${themeBackdropSuppressed ? "theme-settings-overlay-preview-off" : ""}`}
        onClick={onClose}
      />

      {/* Panel */}
      <div
        ref={settingsShellRef}
        className={`
          theme-dialog-shell theme-settings-shell relative z-10 flex w-full flex-col
          h-[100dvh] rounded-none
          sm:rounded-[28px]
          sm:flex-row sm:w-[clamp(48rem,78vw,70rem)] sm:max-w-none sm:h-[min(85dvh,65rem)] sm:max-h-none
        `}
        style={{
          "--settings-inner-list-max-height": isMobile
            ? "50dvh"
            : "min(42.5dvh, 32.5rem)",
        } as CSSProperties}
      >
        {/* ── Left column ────────────────────────────────────────────────── */}
        <div
          data-testid="settings-nav-panel"
          className={`
            theme-dialog-divider flex shrink-0 flex-col
            sm:w-52 sm:border-r
            ${mobileView === "section" ? "hidden sm:flex" : "flex"}
          `}
        >
          {/* Header */}
          <div className="relative hidden shrink-0 items-center justify-center px-2 pt-4 pb-2 sm:flex">
            <CloseButton
              testId={isMobile ? undefined : "settings-close-button-sidebar"}
              className="absolute left-2"
            />
            <h2 className="text-base font-semibold text-center text-text-primary">Settings</h2>
          </div>

          <div
            className="flex shrink-0 items-center justify-between px-4 pb-1.5 pt-2 sm:hidden"
            style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 0.5rem)" }}
          >
            <h2 className="text-base font-semibold text-text-primary">Freed Settings</h2>
            <CloseButton
              testId={isMobile && mobileView === "nav" ? "settings-close-button-mobile" : undefined}
              className="-mr-2"
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
              inputClassName="h-10 text-base sm:h-auto sm:text-sm"
            />
          </div>

          <NavList />

          {/* Footer — desktop sidebar only */}
          <div className="theme-dialog-divider hidden shrink-0 items-center justify-between border-t px-4 py-3 sm:flex">
            {checkForUpdates ? (
              <button
                onClick={jumpToUpdatesFromVersion}
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
              <span
                className="flex min-w-0 items-center gap-1.5 truncate text-sm font-medium text-text-primary"
                data-testid="settings-mobile-section-title"
              >
                {activeSectionBreadcrumb.map((label, index) => (
                  <Fragment key={`${label}-${index}`}>
                    {index > 0 ? (
                      <svg
                        aria-hidden="true"
                        className="h-2.5 w-2.5 shrink-0 text-[color:color-mix(in_srgb,var(--theme-text-muted)_72%,transparent)]"
                        data-testid="settings-mobile-breadcrumb-caret"
                        fill="none"
                        viewBox="0 0 12 12"
                      >
                        <path
                          d="M4.5 2.75 7.25 6 4.5 9.25"
                          stroke="currentColor"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="1.6"
                        />
                      </svg>
                    ) : null}
                    <span className="truncate">{label}</span>
                  </Fragment>
                ))}
              </span>
            </button>
            <CloseButton
              testId={isMobile && mobileView === "section" ? "settings-close-button-mobile" : undefined}
              className="-mr-2 shrink-0"
            />
          </div>

          <div
            ref={scrollRef}
            data-testid="settings-scroll-container"
            className="theme-settings-scrollport flex-1 overflow-y-auto px-4 pt-2 text-base sm:px-6 sm:pt-6 sm:text-sm sm:[&>section+section]:mt-24 [&>section+section]:mt-6"
            style={{
              paddingBottom: scrollContainerBottomPadding,
            }}
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

      {showSampleClearConfirm && (
        <div className="theme-elevated-overlay absolute inset-0 z-20 flex items-start justify-center overflow-y-auto p-4 sm:items-center">
          <div className="theme-dialog-shell my-auto max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-[rgb(var(--theme-feedback-danger-rgb)/0.15)]">
                <svg className="h-5 w-5 theme-feedback-text-danger" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3m0 4h.01m-7.938 4h15.876c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L2.33 17c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-semibold text-text-primary">Clear sample data?</p>
                <p className="mt-0.5 text-xs text-text-secondary">
                  Only records with Freed's internal sample-data marker will be removed. Real library data is ignored.
                </p>
              </div>
            </div>

            <div className="theme-feedback-panel-danger mb-5 rounded-xl px-4 py-3">
              <p className="theme-feedback-text-danger text-xs leading-5">
                Ready to remove {formatSampleDataSummary(sampleDataSummary)}.
              </p>
              <p className="mt-2 text-xs leading-5 text-[rgb(var(--theme-feedback-danger-rgb)/0.72)]">
                Older unmarked sample data will stay in place.
              </p>
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setShowSampleClearConfirm(false)}
                disabled={clearingSampleData}
                className="flex-1 rounded-xl border border-[color:var(--theme-border)] px-4 py-2.5 text-text-secondary transition-colors hover:bg-[color:color-mix(in_srgb,var(--theme-bg-surface)_72%,transparent)] hover:text-text-primary disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  void handleClearSampleData();
                }}
                disabled={clearingSampleData}
                className="theme-feedback-button-danger flex-1 px-4 py-2.5 disabled:opacity-50"
              >
                {clearingSampleData ? "Clearing..." : "Clear sample data"}
              </button>
            </div>
          </div>
        </div>
      )}

      {supportModalOpen && (
        <div className="theme-elevated-overlay absolute inset-0 z-20 flex items-start justify-center overflow-y-auto p-4 sm:items-center">
          <div className="theme-dialog-shell theme-settings-shell my-auto flex max-h-[calc(100dvh-2rem)] w-full max-w-2xl flex-col overflow-hidden">
            <div className="theme-dialog-divider flex shrink-0 items-center justify-between border-b px-4 py-3">
              <h2 className="text-base font-semibold text-text-primary">Support</h2>
              <button
                type="button"
                onClick={() => setSupportModalOpen(false)}
                aria-label="Close support"
                className="inline-flex h-10 w-10 items-center justify-center rounded-[28px] text-[var(--theme-text-muted)] transition-colors hover:bg-[var(--theme-bg-muted)] hover:text-[var(--theme-text-primary)]"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="minimal-scroll flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-6">
              <ReportComposer />
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
      className={`mb-4 text-base font-semibold uppercase tracking-wide sm:mb-5 sm:text-sm ${
        danger ? "text-[rgb(var(--theme-feedback-danger-rgb)/0.64)]" : "text-text-muted"
      }`}
    >
      {label}
    </h3>
  );
}
