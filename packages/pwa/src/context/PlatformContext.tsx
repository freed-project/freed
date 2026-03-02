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
 * A zustand store hook that can be called with a selector.
 * Both `create<PwaState>()` and `create<DesktopState>()` satisfy this
 * as long as their state types extend BaseAppState.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AppStoreHook = <U>(selector: (state: any) => U) => U;

export interface PlatformConfig {
  /** Zustand store hook — both PWA and Desktop stores extend BaseAppState */
  store: AppStoreHook;

  /** Register + fetch a feed by URL */
  addRssFeed: (url: string) => Promise<void>;

  /** Import feeds from parsed OPML entries */
  importOPMLFeeds: (
    feeds: OPMLFeedEntry[],
    onProgress?: (p: ImportProgress) => void,
  ) => Promise<ImportProgress>;

  /** Download subscriptions as OPML */
  exportFeedsAsOPML: () => void;

  // -- Platform behavior flags --

  /** When true, Header becomes a native draggable title bar with traffic light padding */
  headerDragRegion?: boolean;

  // -- Layout slot components (null = not rendered) --

  /** Rendered at top of Sidebar nav (e.g. Desktop Sync card, X Auth card) */
  SidebarConnectionSection: ComponentType | null;

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
