/**
 * PlatformContext — dependency injection for platform-specific behavior
 *
 * Shared UI components consume this context to access the zustand store
 * and platform-specific capture functions without coupling to a specific
 * package's lib/ imports. Each deployment target (PWA, Desktop) provides
 * its own PlatformConfig at the app root.
 */

import {
  createContext,
  useContext,
  type ComponentType,
  type ReactNode,
} from "react";
import type {
  BaseAppState,
  ContactSyncState,
  BugReportDraft,
  BugReportIssueType,
  BugReportScreenshot,
  GeneratedBugReportBundle,
  ImportProgress,
  ReportPrivacyTier,
} from "@freed/shared";
import type { OPMLFeedEntry, ReleaseChannel } from "@freed/shared";
import type { ImportSummary, ProgressFn } from "../components/LibraryDialog.types.js";
import type { ProviderStatusTone } from "../lib/provider-status.js";

/**
 * Pixel offset reserved for macOS traffic-light window controls when
 * `headerDragRegion` is true. Apply as `paddingLeft` on the first toolbar row.
 */
export const MACOS_TRAFFIC_LIGHT_INSET = 100;

/**
 * A zustand store hook that can be called with a selector.
 * Both `create<PwaState>()` and `create<DesktopState>()` satisfy this
 * as long as their state types extend BaseAppState.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AppStoreHook = <U>(selector: (state: any) => U) => U;

/**
 * Live state of an in-progress update download, surfaced in the Settings card.
 * Only the phases that need UI treatment are included here -- idle/available
 * are represented by `null` (no active download).
 */
export type UpdateDownloadProgress =
  | { phase: "downloading"; percent: number }
  | { phase: "error"; message: string };

export type SyncProviderSectionSurface = "settings" | "debug-card";

export interface SyncProviderSectionProps {
  surface?: SyncProviderSectionSurface;
}

export interface SidebarSourceStatusSummary {
  tone: ProviderStatusTone;
  label: string;
  detail?: string;
  syncing?: boolean;
  paused?: boolean;
}

export interface BugReportingConfig {
  githubRepo: string;
  privateShareEmail?: string;
  createDraft?: (issueType?: BugReportIssueType) => Partial<BugReportDraft>;
  generateBundle: (input: {
    draft: BugReportDraft;
    privacyTier: ReportPrivacyTier;
  }) => Promise<GeneratedBugReportBundle>;
  captureScreenshot?: () => Promise<BugReportScreenshot | null>;
  exportBundle?: (bundle: GeneratedBugReportBundle) => Promise<void>;
  openUrl?: (url: string) => void;
}

export interface PlatformConfig {
  /** Zustand store hook — both PWA and Desktop stores extend BaseAppState */
  store: AppStoreHook;

  /**
   * Controls whether feed cards eagerly render remote media previews.
   * Desktop can force reader-only mode to reduce WebKit renderer pressure.
   */
  feedMediaPreviews?: "inline" | "reader-only";

  /**
   * Register + fetch a feed by URL.
   * Only available on platforms that can fetch RSS (desktop).
   * When absent, feed-add UI is hidden.
   */
  addRssFeed?: (url: string) => Promise<void>;

  /**
   * Import feeds from parsed OPML entries.
   * Only available on platforms that can fetch RSS (desktop).
   * When absent, import UI is hidden.
   */
  importOPMLFeeds?: (
    feeds: OPMLFeedEntry[],
    onProgress?: (p: ImportProgress) => void,
  ) => Promise<ImportProgress>;

  /** Download subscriptions as OPML */
  exportFeedsAsOPML?: () => void;

  // -- Platform behavior flags --

  /** When true, Header becomes a native draggable title bar with traffic light padding */
  headerDragRegion?: boolean;

  // -- Layout slot components (null = not rendered) --

  /** Rendered inline per source button for status indicators (e.g. X auth dot) */
  SourceIndicator: ComponentType<{ sourceId: string }> | null;

  /** Rendered in Header actions area (e.g. sync panel, refresh button) */
  HeaderSyncIndicator: ComponentType | null;

  /** Rendered after built-in settings sections (e.g. Mobile Sync tab) */
  SettingsExtraSections: ComponentType | null;

  /** Rendered inside Settings > Legal for local consent details. */
  LegalSettingsContent: ComponentType | null;

  /** Replaces default "All caught up" empty state when feeds exist but no items */
  FeedEmptyState: ComponentType | null;

  /**
   * Content rendered in the Settings > Sources > X section.
   * When null, the X section is omitted from settings entirely (e.g. PWA).
   */
  XSettingsContent: ComponentType<SyncProviderSectionProps> | null;

  /**
   * Content rendered in the Settings > Sources > Facebook section.
   * When null, the Facebook section is omitted from settings entirely (e.g. PWA).
   */
  FacebookSettingsContent: ComponentType<SyncProviderSectionProps> | null;

  /**
   * Content rendered in the Settings > Sources > Instagram section.
   * When null, the Instagram section is omitted from settings entirely (e.g. PWA).
   */
  InstagramSettingsContent: ComponentType<SyncProviderSectionProps> | null;

  /**
   * Content rendered in the Settings > Sources > LinkedIn section.
   * When null, the LinkedIn section is omitted from settings entirely (e.g. PWA).
   */
  LinkedInSettingsContent: ComponentType<SyncProviderSectionProps> | null;

  /**
   * Content rendered in the Settings > Sources > Google Contacts section.
   * When null, the Google Contacts section is omitted from settings entirely.
   */
  GoogleContactsSettingsContent: ComponentType | null;

  /** Manual update check. Returns version string if available, null if up-to-date. */
  checkForUpdates?: () => Promise<string | null>;

  /** Apply a detected update (PWA: reload, Desktop: handled by UpdateNotification). */
  applyUpdate?: () => void;

  /** Current locally-selected update channel for this install or browser. */
  releaseChannel?: ReleaseChannel;

  /** Persist a new update channel for this install or browser. */
  setReleaseChannel?: (channel: ReleaseChannel) => Promise<void> | void;

  /**
   * Live download progress when an update is being installed.
   * Null when no download is active. Desktop only.
   */
  updateDownloadProgress?: UpdateDownloadProgress | null;

  /**
   * Fake-authenticate all social providers (X, Facebook, Instagram) for local
   * testing. Writes stub credentials to localStorage and updates store auth
   * state so the purple connection dots appear in the sidebar without needing
   * a real login flow. Desktop only -- absent on PWA.
   */
  seedSocialConnections?: () => void;

  /**
   * Perform a factory reset on this device.
   * Wipes IndexedDB + localStorage. When `deleteFromCloud` is true, also
   * deletes the sync file from the active cloud provider before clearing.
   * Always ends with `location.reload()`.
   */
  factoryReset?: (deleteFromCloud: boolean) => Promise<void>;

  /**
   * Return a human-readable label for the currently active cloud provider
   * (e.g. "Google Drive", "Dropbox"), or null when no cloud sync is connected.
   * Called lazily in the Danger Zone UI so it reflects live state.
   */
  activeCloudProviderLabel?: () => string | null;

  /**
   * Open a URL in the system browser.
   * Desktop: calls @tauri-apps/plugin-shell open().
   * PWA: calls window.open().
   * If absent, FeedView falls back to window.open().
   */
  openUrl?: (url: string) => void;

  /**
   * Fetch full preserved article text for a specific item from local platform
   * storage when the live feed state only carries a truncated preview.
   * Desktop only.
   */
  getLocalPreservedText?: (globalId: string) => Promise<string | null>;

  /**
   * Save a URL to the local library with full content extraction.
   * Desktop: fetches HTML via Tauri IPC, extracts content, writes to cache.
   * PWA: writes a stub item; desktop picks it up via relay and fetches content.
   */
  saveUrl?: (url: string, options?: { tags?: string[] }) => Promise<void>;

  /**
   * Import Freed Markdown archive files into the library.
   * Desktop only -- the PWA has no filesystem access.
   */
  importMarkdown?: (files: FileList, onProgress: ProgressFn) => Promise<ImportSummary>;

  /**
   * Export the entire library as a zipped Freed Markdown archive.
   * Desktop only (triggers a file download).
   */
  exportMarkdown?: () => Promise<void>;

  /** Restart the current cloud sync loop for a provider without re-auth. */
  retryCloudProvider?: (provider: "gdrive" | "dropbox") => Promise<void>;

  /** Force a disconnect and re-auth flow for a cloud provider. */
  reconnectCloudProvider?: (provider: "gdrive" | "dropbox") => Promise<void>;

  /** Remove a feed's local health history after it is unsubscribed. */
  forgetRssFeedHealth?: (feedUrl: string) => Promise<void>;

  /** Trigger an immediate RSS refresh run. */
  syncRssNow?: () => Promise<void>;

  /** Trigger an immediate sync run for a specific source provider. */
  syncSourceNow?: (sourceId: string) => Promise<void>;

  /** Return the current status summary for a source row in the sidebar. */
  getSourceStatus?: (sourceId: string | undefined) => SidebarSourceStatusSummary | null;

  /**
   * Retrieve cached article HTML for a globalId from the device-local store.
   * Desktop: reads from Tauri FS content cache.
   * PWA: reads from the Workbox Cache API.
   * Returns null when no cached content exists.
   */
  getLocalContent?: (globalId: string) => Promise<string | null>;

  /**
   * Encrypted device-local API key store (desktop only).
   * Used by the AI settings UI to read/write/clear API keys.
   */
  secureStorage?: {
    getApiKey: (provider: string) => Promise<string | null>;
    setApiKey: (provider: string, key: string) => Promise<void>;
    clearApiKey: (provider: string) => Promise<void>;
  };

  /**
   * Google Contacts API integration.
   * Provides a token accessor for the People API.
   * When absent, Google Contacts import is unavailable in FriendsView.
   */
  googleContacts?: {
    /** Return the current Google OAuth access token, or null when not authenticated. */
    getToken: () => string | null;
    /** Start or refresh the Google OAuth flow so contacts scope is granted. */
    connect: () => Promise<void>;
  };

  /**
   * Present the platform's native contact picker and return the selected
   * contact's details for importing into a Friend record.
   *
   * - Desktop: uses the macOS CNContactStore native picker via a Tauri command.
   * - PWA (iOS/Android): uses the Web Contact Picker API (navigator.contacts).
   * - PWA (desktop browsers): absent -- FriendEditor falls back to a manual form.
   *
   * Returns null when the user cancels the picker.
   */
  pickContact?: () => Promise<{
    name: string;
    phone?: string;
    email?: string;
    address?: string;
    nativeId?: string;
  } | null>;

  /** Shared bug report composer hooks and platform-specific collectors. */
  bugReporting?: BugReportingConfig;
}

export interface ContactSyncActions {
  syncNow: () => Promise<ContactSyncState>;
  dismissMatch: (contactResourceName: string, friendIdOrAuthorId: string) => void;
  openReview: () => Promise<void>;
}

const PlatformCtx = createContext<PlatformConfig | null>(null);

export function PlatformProvider({
  value,
  children,
}: {
  value: PlatformConfig;
  children: ReactNode;
}) {
  return (
    <PlatformCtx.Provider value={value}>{children}</PlatformCtx.Provider>
  );
}

/** Access the full platform config (capture functions + layout slots). */
export function usePlatform(): PlatformConfig {
  const ctx = useContext(PlatformCtx);
  if (!ctx) {
    throw new Error("usePlatform() requires a <PlatformProvider>");
  }
  return ctx;
}

/**
 * Convenience selector hook over the platform-provided zustand store.
 * The selector receives BaseAppState, giving shared components type-safe
 * access to the common state interface without knowing the platform.
 */
export function useAppStore<T>(selector: (state: BaseAppState) => T): T {
  const { store } = usePlatform();
  return store(selector);
}
