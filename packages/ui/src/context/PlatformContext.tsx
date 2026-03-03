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
  ImportProgress,
} from "@freed/shared";
import type { OPMLFeedEntry } from "@freed/shared";

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

export interface PlatformConfig {
  /** Zustand store hook — both PWA and Desktop stores extend BaseAppState */
  store: AppStoreHook;

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

  /** Replaces default "All caught up" empty state when feeds exist but no items */
  FeedEmptyState: ComponentType | null;

  /** Manual update check. Returns version string if available, null if up-to-date. */
  checkForUpdates?: () => Promise<string | null>;

  /** Apply a detected update (PWA: reload, Desktop: handled by UpdateNotification). */
  applyUpdate?: () => void;

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
