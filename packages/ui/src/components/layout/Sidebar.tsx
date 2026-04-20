import { useState, useCallback, useEffect, useRef, useMemo, type ReactNode } from "react";

import {
  countAuthorsWithRecentLocationUpdates,
  countFriendsWithRecentLocationUpdates,
  getDefaultMapMode,
  type FilterOptions,
  type RssFeed,
  type SidebarMode,
} from "@freed/shared";
import { useAppStore, usePlatform, type SidebarSourceStatusSummary } from "../../context/PlatformContext.js";
import { ProviderStatusIndicator } from "../ProviderStatusIndicator.js";
import { SettingsDialog } from "../SettingsDialog.js";
import { toast } from "../Toast.js";
import { Tooltip } from "../Tooltip.js";
import { useDebugStore } from "../../lib/debug-store.js";
import { useSettingsStore } from "../../lib/settings-store.js";
import { MapPinIcon, RssIcon, BookmarkIcon, ArchiveIcon, UsersIcon } from "../icons.js";
import { TOP_SOURCE_ITEMS, type SourceNavigationItem } from "../../lib/source-navigation.js";
import { useIsMobile } from "../../hooks/useIsMobile.js";
import { SearchJumpField } from "./SearchJumpField.js";
import {
  PRIMARY_SIDEBAR_GAP_WIDTH_PX,
  px,
} from "./layoutConstants.js";

const compactNumberFormatter = new Intl.NumberFormat(undefined, {
  notation: "compact",
  maximumFractionDigits: 1,
});
const EMPTY_PROVIDER_SYNC_COUNTS: Partial<Record<string, number>> = {};

function fmt(n: number): string {
  return compactNumberFormatter.format(n);
}

const FEEDS_PAGE_SIZE = 10;

function scoreFeedMatch(feed: RssFeed, queryTerms: string[]): number {
  if (queryTerms.length === 0) return 0;

  const title = feed.title.toLocaleLowerCase();
  const siteUrl = feed.siteUrl?.toLocaleLowerCase() ?? "";
  const url = feed.url.toLocaleLowerCase();
  const folder = feed.folder?.toLocaleLowerCase() ?? "";

  let score = 0;
  for (const term of queryTerms) {
    if (title === term) score += 120;
    else if (title.startsWith(term)) score += 90;
    else if (title.includes(term)) score += 60;

    if (folder.startsWith(term)) score += 40;
    else if (folder.includes(term)) score += 24;

    if (siteUrl.startsWith(term) || url.startsWith(term)) score += 36;
    else if (siteUrl.includes(term) || url.includes(term)) score += 18;
  }

  return score;
}

interface SidebarProps {
  mobileOpen: boolean;
  onMobileClose: () => void;
  onMobileToggle: () => void;
  desktopMode: SidebarMode;
  onDesktopModeChange: (nextMode: SidebarMode) => void;
}

function SidebarSection({
  title,
  defaultOpen = true,
  count,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  count?: number;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="shrink-0 mb-2">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center px-3 py-1.5 rounded-lg border border-transparent group hover:bg-[color:var(--theme-bg-muted)] transition-colors"
      >
        <span className="text-xs font-semibold text-[color:var(--theme-text-muted)] uppercase tracking-wider flex-1 text-left leading-5">
          {title}
        </span>
        {!open && count !== undefined && count > 0 && (
          <span className="text-[10px] tabular-nums text-[color:var(--theme-text-soft)] mr-1.5">{count}</span>
        )}
        <svg
          className={`w-3 h-3 text-[color:var(--theme-text-soft)] transition-transform shrink-0 ${open ? "rotate-90" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </button>
      {open && <div className="mt-1">{children}</div>}
    </div>
  );
}

function formatLastSync(lastFetched?: number): string {
  if (!lastFetched) return "Never synced";
  const diff = Date.now() - lastFetched;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function syncDotClass(lastFetched?: number): string {
  if (!lastFetched) return "bg-[rgb(var(--theme-shell-rgb)/0.32)]";
  const diff = Date.now() - lastFetched;
  if (diff < 60 * 60_000) return "bg-[rgb(var(--theme-feedback-success-rgb)/0.92)]";
  if (diff < 24 * 60 * 60_000) return "bg-[rgb(var(--theme-feedback-warning-rgb)/0.92)]";
  return "bg-[rgb(var(--theme-feedback-danger-rgb)/0.92)]";
}

function syncStatusLabel(lastFetched?: number): string {
  if (!lastFetched) return "Never";
  const diff = Date.now() - lastFetched;
  if (diff < 60 * 60_000) return "Up to date";
  if (diff < 24 * 60 * 60_000) return "Stale";
  return "Out of date";
}

interface FeedContextMenuProps {
  feed: RssFeed;
  anchorRect: DOMRect;
  anchorElement?: HTMLElement | null;
  onClose: () => void;
  onRename: (title: string) => void;
  onUnsubscribe: () => void;
}

function SidebarContextMenuShell({
  anchorRect,
  onClose,
  ignoreElement,
  width = 224,
  testId,
  children,
}: {
  anchorRect: DOMRect;
  onClose: () => void;
  ignoreElement?: HTMLElement | null;
  width?: number;
  testId?: string;
  children: ReactNode;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleDown = (e: MouseEvent) => {
      if (ignoreElement && ignoreElement.contains(e.target as Node)) {
        return;
      }
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handleDown);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleDown);
      document.removeEventListener("keydown", handleKey);
    };
  }, [ignoreElement, onClose]);

  const gap = 6;
  const fitsRight = anchorRect.right + gap + width <= window.innerWidth;
  const left = fitsRight ? anchorRect.right + gap : anchorRect.left - gap - width;
  const top = Math.min(anchorRect.top, window.innerHeight - 180);

  return (
    <div
      ref={menuRef}
      style={{ top, left, width }}
      data-testid={testId}
      className="theme-dialog-shell fixed z-[300] overflow-hidden rounded-xl"
    >
      {children}
    </div>
  );
}

function FeedContextMenu({
  feed,
  anchorRect,
  anchorElement,
  onClose,
  onRename,
  onUnsubscribe,
}: FeedContextMenuProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(feed.title);

  useEffect(() => {
    if (renaming) inputRef.current?.focus();
  }, [renaming]);

  const handleRenameSubmit = () => {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== feed.title) {
      onRename(trimmed);
    } else {
      onClose();
    }
  };

  return (
    <SidebarContextMenuShell anchorRect={anchorRect} ignoreElement={anchorElement} onClose={onClose} testId={`feed-context-menu-${feed.url}`}>
      {/* Sync status header */}
      <div className="theme-dialog-divider border-b px-3 py-2.5">
        <div className="flex items-center gap-2">
          <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${syncDotClass(feed.lastFetched)}`} />
          <span className="text-[11px] text-[color:var(--theme-text-muted)]">{syncStatusLabel(feed.lastFetched)}</span>
          <span className="ml-auto text-[11px] text-[color:var(--theme-text-soft)]">{formatLastSync(feed.lastFetched)}</span>
        </div>
      </div>

      {/* Actions */}
      <div className="py-1">
        {renaming ? (
          <div className="px-2 py-1.5">
            <input
              ref={inputRef}
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleRenameSubmit();
                if (e.key === "Escape") {
                  setRenaming(false);
                  setRenameValue(feed.title);
                }
              }}
              onBlur={handleRenameSubmit}
              className="theme-input w-full rounded-lg px-2.5 py-1.5 text-xs outline-none"
            />
          </div>
        ) : (
          <button
            onClick={() => setRenaming(true)}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-[color:var(--theme-text-secondary)] hover:bg-[color:var(--theme-bg-muted)] hover:text-[color:var(--theme-text-primary)] transition-colors text-left"
          >
            <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
            Rename
          </button>
        )}
        <button
          onClick={onUnsubscribe}
          className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-[rgb(var(--theme-feedback-danger-rgb))] hover:bg-[rgb(var(--theme-feedback-danger-rgb)/0.1)] hover:text-[rgb(var(--theme-feedback-danger-rgb))] transition-colors text-left"
        >
          <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 4.411m0 0L21 21" />
          </svg>
          Unsubscribe
        </button>
      </div>
    </SidebarContextMenuShell>
  );
}

function SourceContextMenu({
  source,
  anchorRect,
  anchorElement,
  unread,
  total,
  status,
  onClose,
  onOpenSettings,
  onSyncNow,
}: {
  source: SourceNavigationItem;
  anchorRect: DOMRect;
  anchorElement?: HTMLElement | null;
  unread: number;
  total: number;
  status: SidebarSourceStatusSummary | null;
  onClose: () => void;
  onOpenSettings?: () => void;
  onSyncNow?: () => void;
}) {
  const [syncInitiated, setSyncInitiated] = useState(false);
  const sourceKey = source.id ?? "all";
  const totalLabel = total > 0 ? `${fmt(unread)} unread, ${fmt(total)} total` : "No items yet";
  const sourceLabel = source.id === undefined ? "All sources" : source.label;
  const syncActionLabel = status?.paused ? "Resume now" : "Sync now";
  const syncInitiatedLabel = status?.paused ? "Resuming" : "Syncing Initiated";

  useEffect(() => {
    if (!syncInitiated) return;
    const timeout = window.setTimeout(() => setSyncInitiated(false), 1500);
    return () => window.clearTimeout(timeout);
  }, [syncInitiated]);

  return (
    <SidebarContextMenuShell
      anchorRect={anchorRect}
      ignoreElement={anchorElement}
      onClose={onClose}
      testId={`source-context-menu-${sourceKey}`}
    >
      <div className="theme-dialog-divider border-b px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className="truncate text-[11px] font-medium text-[color:var(--theme-text-primary)]">{sourceLabel}</span>
          <span className="ml-auto text-[11px] text-[color:var(--theme-text-soft)]">{totalLabel}</span>
        </div>
      </div>

      {status ? (
        <div className="theme-dialog-divider border-b px-3 py-2.5">
          <div className="flex items-center gap-2">
            <ProviderStatusIndicator
              tone={status.tone}
              syncing={status.syncing}
              label={status.label}
              size="xs"
            />
            <span className="text-xs font-medium text-[color:var(--theme-text-primary)]">
              {status.syncing && status.tone === "healthy" ? "Syncing" : status.label}
            </span>
          </div>
          {status.detail ? (
            <p className="mt-1.5 text-[11px] leading-4 text-[color:var(--theme-text-muted)]">
              {status.detail}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="py-1">
        {onSyncNow ? (
          <button
            onClick={() => {
              setSyncInitiated(true);
              toast.info("Syncing Initiated");
              onSyncNow();
            }}
            data-testid={`source-menu-sync-${sourceKey}`}
            className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs transition-colors text-left ${
              syncInitiated
                ? "bg-[rgb(var(--theme-accent-secondary-rgb)/0.18)] text-[color:var(--theme-accent-secondary)]"
                : "text-[color:var(--theme-text-secondary)] hover:bg-[color:var(--theme-bg-muted)] hover:text-[color:var(--theme-text-primary)]"
            }`}
          >
            <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0A8.003 8.003 0 015.418 15m13.001 0H15" />
            </svg>
            {syncInitiated ? syncInitiatedLabel : syncActionLabel}
          </button>
        ) : null}

        {onOpenSettings ? (
          <button
            onClick={() => {
              onOpenSettings();
              onClose();
            }}
            data-testid={`source-menu-settings-${sourceKey}`}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-[color:var(--theme-text-secondary)] hover:bg-[color:var(--theme-bg-muted)] hover:text-[color:var(--theme-text-primary)] transition-colors text-left"
          >
            <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.25 3.75h1.5a1.5 1.5 0 011.5 1.5v.621a1.5 1.5 0 001.06 1.436l.587.196a1.5 1.5 0 001.63-.367l.44-.44a1.5 1.5 0 012.122 0l1.06 1.06a1.5 1.5 0 010 2.121l-.44.44a1.5 1.5 0 00-.366 1.63l.195.588a1.5 1.5 0 001.437 1.06h.62a1.5 1.5 0 011.5 1.5v1.5a1.5 1.5 0 01-1.5 1.5h-.62a1.5 1.5 0 00-1.437 1.06l-.195.587a1.5 1.5 0 00.366 1.63l.44.44a1.5 1.5 0 010 2.122l-1.06 1.06a1.5 1.5 0 01-2.121 0l-.44-.44a1.5 1.5 0 00-1.63-.366l-.588.195a1.5 1.5 0 00-1.06 1.437v.62a1.5 1.5 0 01-1.5 1.5h-1.5a1.5 1.5 0 01-1.5-1.5v-.62a1.5 1.5 0 00-1.06-1.437l-.587-.195a1.5 1.5 0 00-1.63.366l-.44.44a1.5 1.5 0 01-2.122 0l-1.06-1.06a1.5 1.5 0 010-2.121l.44-.44a1.5 1.5 0 00.366-1.63l-.195-.588A1.5 1.5 0 005.871 18h-.62a1.5 1.5 0 01-1.5-1.5V15a1.5 1.5 0 011.5-1.5h.62a1.5 1.5 0 001.437-1.06l.195-.587a1.5 1.5 0 00-.366-1.63l-.44-.44a1.5 1.5 0 010-2.122l1.06-1.06a1.5 1.5 0 012.121 0l.44.44a1.5 1.5 0 001.63.367l.588-.196a1.5 1.5 0 001.06-1.436V5.25a1.5 1.5 0 011.5-1.5z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            Open settings
          </button>
        ) : null}
      </div>
    </SidebarContextMenuShell>
  );
}

const MAX_WIDTH = 480;
const DEFAULT_WIDTH = 256;
const COMPACT_WIDTH = 48;
const CLOSED_SNAP_THRESHOLD = 40;
const COMPACT_SNAP_THRESHOLD = 150;
const LABEL_PRIORITY_THRESHOLD = 200;
const EXPANDED_PADDING_CROSSOVER_WIDTH = 220;
const EXPANDED_ROOMY_PADDING_PX = 16;
const EXPANDED_CONDENSED_PADDING_PX = 8;

function getDesktopModeForWidth(width: number): SidebarMode {
  if (width <= CLOSED_SNAP_THRESHOLD) return "closed";
  if (width <= COMPACT_SNAP_THRESHOLD) return "compact";
  return "expanded";
}

export function Sidebar({
  mobileOpen,
  onMobileClose,
  onMobileToggle,
  desktopMode,
  onDesktopModeChange,
}: SidebarProps) {
  const { SourceIndicator, headerDragRegion, syncRssNow, syncSourceNow, getSourceStatus } = usePlatform();
  const isMobileViewport = useIsMobile();
  const activeFilter = useAppStore((s) => s.activeFilter);
  const setFilter = useAppStore((s) => s.setFilter);
  const setSelectedItem = useAppStore((s) => s.setSelectedItem);
  const setSelectedFriend = useAppStore((s) => s.setSelectedPerson);
  const setSearchQuery = useAppStore((s) => s.setSearchQuery);
  const searchQuery = useAppStore((s) => s.searchQuery);
  const feeds = useAppStore((s) => s.feeds);
  const friends = useAppStore((s) => s.persons);
  const accounts = useAppStore((s) => s.accounts);
  const feedUnreadCounts = useAppStore((s) => s.feedUnreadCounts);
  const feedTotalCounts = useAppStore((s) => s.feedTotalCounts);
  const renameFeed = useAppStore((s) => s.renameFeed);
  const removeFeed = useAppStore((s) => s.removeFeed);
  const totalUnreadCount = useAppStore((s) => s.totalUnreadCount);
  const unreadCountByPlatform = useAppStore((s) => s.unreadCountByPlatform);
  const totalItemCount = useAppStore((s) => s.totalItemCount);
  const itemCountByPlatform = useAppStore((s) => s.itemCountByPlatform);
  const providerSyncCounts = useAppStore(
    (s) =>
      ((s as unknown as { providerSyncCounts?: Partial<Record<string, number>> })
        .providerSyncCounts ?? EMPTY_PROVIDER_SYNC_COUNTS) as Partial<Record<string, number>>,
  );
  const persistedSidebarWidth =
    useAppStore((s) => s.preferences.display.sidebarWidth) ?? DEFAULT_WIDTH;
  const updatePreferences = useAppStore((s) => s.updatePreferences);
  const items = useAppStore((s) => s.items);
  const activeView = useAppStore((s) => s.activeView);
  const setActiveView = useAppStore((s) => s.setActiveView);
  const pendingMatchCount = useAppStore((s) => s.pendingMatchCount);
  const display = useAppStore((s) => s.preferences.display);
  const health = useDebugStore((s) => s.health);

  const savedCount = useMemo(() => items.filter((i) => i.userState.saved).length, [items]);
  const archivedCount = useMemo(() => items.filter((i) => i.userState.archived).length, [items]);
  const friendCount = useMemo(() => Object.keys(friends).length, [friends]);
  const mapFriendCount = useMemo(
    () => countFriendsWithRecentLocationUpdates(items, friends, accounts),
    [accounts, friends, items]
  );
  const mapAllContentCount = useMemo(
    () => countAuthorsWithRecentLocationUpdates(items),
    [items],
  );
  const effectiveMapMode = display.mapMode
    ?? getDefaultMapMode(mapFriendCount, mapAllContentCount);
  const mapCount = effectiveMapMode === "all_content"
    ? mapAllContentCount
    : mapFriendCount;

  const { open: showSettings, openDefault: openSettings, close: closeSettings } = useSettingsStore();
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const [committedWidth, setCommittedWidth] = useState(persistedSidebarWidth);
  const [rssFeedsOpen, setRssFeedsOpen] = useState(false);
  const [rssFeedPage, setRssFeedPage] = useState(0);

  // Allow external packages (desktop, pwa) to open settings to a specific section
  // via a DOM event rather than importing the store directly across package boundaries.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { scrollTo?: string } | undefined;
      if (detail?.scrollTo) {
        useSettingsStore.getState().openTo(detail.scrollTo);
      } else {
        useSettingsStore.getState().openDefault();
      }
    };
    window.addEventListener("freed:open-settings", handler);
    return () => window.removeEventListener("freed:open-settings", handler);
  }, []);
  const [openMenuFeedUrl, setOpenMenuFeedUrl] = useState<string | null>(null);
  const [menuAnchorRect, setMenuAnchorRect] = useState<DOMRect | null>(null);
  const [menuAnchorElement, setMenuAnchorElement] = useState<HTMLElement | null>(null);
  const [openMenuSourceKey, setOpenMenuSourceKey] = useState<string | null>(null);
  const [sourceMenuAnchorRect, setSourceMenuAnchorRect] = useState<DOMRect | null>(null);
  const [sourceMenuAnchorElement, setSourceMenuAnchorElement] = useState<HTMLElement | null>(null);
  const dragging = useRef(false);
  const pendingPersistedWidth = useRef<number | null>(null);


  // ─── Tag tree ────────────────────────────────────────────────────────────────

  /** All unique tags collected from the library, sorted alphabetically */
  const allTags = useMemo(() => {
    const tagSet = new Set<string>();
    for (const item of items) {
      for (const tag of item.userState.tags ?? []) {
        tagSet.add(tag);
      }
    }
    return Array.from(tagSet).sort();
  }, [items]);

  /**
   * Top-level tag segments (before the first "/").
   * E.g. ["Technology/AI", "Technology/React", "Science"] → ["Science", "Technology"]
   */
  const topLevelTags = useMemo(() => {
    const tops = new Set<string>();
    for (const tag of allTags) {
      tops.add(tag.split("/")[0]);
    }
    return Array.from(tops).sort();
  }, [allTags]);

  /** All descendant tag paths under a given top-level segment */
  const childTagsOf = (top: string) =>
    allTags.filter((t) => t === top || t.startsWith(`${top}/`));

  const handleTagClick = (tag: string) => {
    const children = childTagsOf(tag);
    showFeed({ tags: children });
  };

  const isFeedView = activeView === "feed";

  const isTagActive = (tag: string) => {
    if (!isFeedView) return false;
    const active = activeFilter.tags;
    if (!active || active.length === 0) return false;
    return childTagsOf(tag).some((t) => active.includes(t));
  };

  useEffect(() => {
    if (dragging.current || dragWidth !== null) return;
    if (pendingPersistedWidth.current !== null) {
      if (persistedSidebarWidth !== pendingPersistedWidth.current) return;
      pendingPersistedWidth.current = null;
    }
    setCommittedWidth(persistedSidebarWidth);
  }, [dragWidth, persistedSidebarWidth]);

  const rawDesktopWidth = dragWidth
    ?? (desktopMode === "compact" ? COMPACT_WIDTH : desktopMode === "closed" ? 0 : committedWidth);
  const renderMode: SidebarMode = isMobileViewport
    ? "expanded"
    : dragWidth !== null
      ? getDesktopModeForWidth(dragWidth)
      : desktopMode;
  const desktopWidth = renderMode === "compact"
    ? COMPACT_WIDTH
    : renderMode === "closed"
      ? 0
      : rawDesktopWidth;
  const compactRail = renderMode === "compact";
  const narrowLabeledSidebar = renderMode === "expanded" && desktopWidth < LABEL_PRIORITY_THRESHOLD;
  const rowCountsVisible = renderMode === "expanded" && !narrowLabeledSidebar;
  const sourceMenusVisible = renderMode === "expanded" && !narrowLabeledSidebar;
  const sourceIndicatorsVisible = renderMode === "expanded" && !narrowLabeledSidebar;
  const rssAccordionVisible = renderMode === "expanded" && !narrowLabeledSidebar;
  const sourceStatusVisible = renderMode === "expanded" && !narrowLabeledSidebar;
  const searchVariant = compactRail ? "trigger" : "inline";
  const expandedSidebarUsesCondensedPadding =
    renderMode === "expanded" && desktopWidth < EXPANDED_PADDING_CROSSOVER_WIDTH;
  const sidebarPaddingInlinePx = compactRail
    ? 0
    : expandedSidebarUsesCondensedPadding
      ? EXPANDED_CONDENSED_PADDING_PX
      : EXPANDED_ROOMY_PADDING_PX;
  const sidebarPaddingBlockPx = compactRail
    ? 0
    : expandedSidebarUsesCondensedPadding
      ? EXPANDED_CONDENSED_PADDING_PX
      : EXPANDED_ROOMY_PADDING_PX;
  const sidebarBodyStyle = {
    paddingTop: `${sidebarPaddingBlockPx}px`,
    paddingInline: `${sidebarPaddingInlinePx}px`,
    paddingBottom: compactRail
      ? "0px"
      : `calc(${sidebarPaddingBlockPx}px + 100lvh - 100dvh + env(safe-area-inset-bottom, 0px))`,
    transition: "padding 180ms ease",
  };
  const desktopShellWidth = renderMode === "closed"
    ? 0
    : desktopWidth + PRIMARY_SIDEBAR_GAP_WIDTH_PX;
  const desktopShellTopPadding = renderMode !== "closed"
    ? "var(--feed-card-gap, 8px)"
    : 0;
  const desktopAsideWidth = desktopWidth;
  const compactSidebar = compactRail;
  const sidebarPaddingClass = compactRail ? "px-0" : "px-4";
  const rowPaddingClass = compactRail ? "px-1.5" : "px-3";
  const rowLeadingPaddingClass = compactRail ? "pl-1.5" : "pl-3";
  const rowTrailingPaddingClass = compactRail ? "pr-1" : "pr-2";
  const resizeHandleVisible = dragWidth !== null || renderMode !== "closed";

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.style.setProperty(
      "--freed-sidebar-card-width",
      renderMode === "closed" ? "0px" : `${desktopAsideWidth}px`,
    );
  }, [desktopAsideWidth, renderMode]);

  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;
      const startX = e.clientX;
      const startW = desktopMode === "compact" ? COMPACT_WIDTH : committedWidth;
      const previousCursor = document.body.style.cursor;
      const previousUserSelect = document.body.style.userSelect;

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      const onMove = (ev: MouseEvent) => {
        if (!dragging.current) return;
        const next = Math.min(MAX_WIDTH, Math.max(0, startW + ev.clientX - startX));
        setDragWidth(next);
      };
      const onUp = (ev: MouseEvent) => {
        dragging.current = false;
        const final = Math.min(MAX_WIDTH, Math.max(0, startW + ev.clientX - startX));
        const nextMode = getDesktopModeForWidth(final);
        if (nextMode === "expanded") {
          pendingPersistedWidth.current = final;
          setCommittedWidth(final);
          void updatePreferences({ display: { sidebarWidth: final } } as Parameters<typeof updatePreferences>[0]).catch(() => {
            if (pendingPersistedWidth.current === final) {
              pendingPersistedWidth.current = null;
            }
          });
        }
        onDesktopModeChange(nextMode);
        setDragWidth(null);
        document.body.style.cursor = previousCursor;
        document.body.style.userSelect = previousUserSelect;
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [committedWidth, desktopMode, onDesktopModeChange, updatePreferences],
  );

  const feedList = Object.values(feeds).filter((f) => f.enabled);
  const trimmedSearchQuery = searchQuery.trim().toLocaleLowerCase();
  const searchTerms = useMemo(
    () => trimmedSearchQuery.split(/\s+/).filter(Boolean),
    [trimmedSearchQuery],
  );
  const visibleFeedList = useMemo(() => {
    if (searchTerms.length === 0) return feedList;

    return feedList
      .map((feed) => ({ feed, score: scoreFeedMatch(feed, searchTerms) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        if (a.feed.url === activeFilter.feedUrl) return -1;
        if (b.feed.url === activeFilter.feedUrl) return 1;
        return a.feed.title.localeCompare(b.feed.title);
      })
      .map(({ feed }) => feed);
  }, [activeFilter.feedUrl, feedList, searchTerms]);
  const totalFeedPages = Math.max(1, Math.ceil(visibleFeedList.length / FEEDS_PAGE_SIZE));
  const pagedFeeds = useMemo(() => {
    const startIndex = rssFeedPage * FEEDS_PAGE_SIZE;
    return visibleFeedList.slice(startIndex, startIndex + FEEDS_PAGE_SIZE);
  }, [rssFeedPage, visibleFeedList]);
  const activeFeedVisibleOnCurrentPage = !!(
    activeFilter.feedUrl &&
    rssFeedsOpen &&
    pagedFeeds.some((feed) => feed.url === activeFilter.feedUrl)
  );

  const showFeed = useCallback((filter: FilterOptions) => {
    setActiveView("feed");
    setSelectedFriend(null);
    setSelectedItem(null);
    setFilter(filter);
    onMobileClose();
  }, [onMobileClose, setActiveView, setFilter, setSelectedFriend, setSelectedItem]);

  const handleSourceClick = (source: SourceNavigationItem) => {
    showFeed({ platform: source.id });
  };

  const handleFeedClick = (feedUrl: string) => {
    showFeed({ platform: "rss", feedUrl });
  };

  const isTopSourceActive = (source: SourceNavigationItem) => {
    if (!isFeedView) return false;
    if (compactRail && source.id === "rss" && activeFilter.platform === "rss") {
      return true;
    }
    if (source.id === "rss" && activeFilter.platform === "rss") {
      return !activeFilter.feedUrl || !activeFeedVisibleOnCurrentPage;
    }
    if (activeFilter.feedUrl) return false;
    if (activeFilter.archivedOnly) return false;
    if (activeFilter.savedOnly) return false;
    return activeFilter.platform === source.id;
  };

  const sourceUnreadCount = (source: SourceNavigationItem) =>
    source.id === undefined
      ? totalUnreadCount
      : (unreadCountByPlatform[source.id] ?? 0);

  const sourceTotalCount = (source: SourceNavigationItem) =>
    source.id === undefined
      ? totalItemCount
      : (itemCountByPlatform[source.id] ?? 0);

  const sourceKey = (source: SourceNavigationItem) => source.id ?? "all";
  const allSource = TOP_SOURCE_ITEMS[0];
  const providerSourceItems = TOP_SOURCE_ITEMS.slice(1);

  const sourceOrderClass = (source: SourceNavigationItem) => {
    switch (source.id) {
      case undefined:
        return "order-1";
      case "x":
        return "order-6";
      case "facebook":
        return "order-7";
      case "instagram":
        return "order-8";
      case "linkedin":
        return "order-9";
      case "rss":
        return "order-10";
      default:
        return "";
    }
  };

  const settingsSectionForSource = (source: SourceNavigationItem) => {
    if (source.id === undefined) return null;
    if (source.id === "rss") return "feeds";
    if (source.id === "x") return "x";
    if (source.id === "facebook") return "facebook";
    if (source.id === "instagram") return "instagram";
    if (source.id === "linkedin") return "linkedin";
    return "sync";
  };

  const canShowSourceMenu = (source: SourceNavigationItem) =>
    source.id === "rss" ||
    source.id === "x" ||
    source.id === "facebook" ||
    source.id === "instagram" ||
    source.id === "linkedin";

  const selectedMenuSource = openMenuSourceKey
    ? TOP_SOURCE_ITEMS.find((source) => sourceKey(source) === openMenuSourceKey) ?? null
    : null;
  const selectedMenuSourceId = selectedMenuSource?.id;
  const selectedMenuStatus = useMemo(
    () => (selectedMenuSource ? (getSourceStatus?.(selectedMenuSourceId) ?? null) : null),
    [getSourceStatus, selectedMenuSource, selectedMenuSourceId, providerSyncCounts, health],
  );

  useEffect(() => {
    if (activeFilter.platform === "rss" || activeFilter.feedUrl) {
      setRssFeedsOpen(true);
    }
  }, [activeFilter.feedUrl, activeFilter.platform]);

  useEffect(() => {
    const maxPage = Math.max(0, totalFeedPages - 1);
    if (rssFeedPage > maxPage) {
      setRssFeedPage(maxPage);
    }
  }, [rssFeedPage, totalFeedPages]);

  const handleFeedPageChange = useCallback((direction: "prev" | "next") => {
    setRssFeedPage((page) =>
      direction === "prev"
        ? Math.max(0, page - 1)
        : Math.min(totalFeedPages - 1, page + 1),
    );
  }, [totalFeedPages]);

  const settingsButtonContent = (
    <>
      <span className="w-5 text-center">
        <svg className="w-4 h-4 inline" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      </span>
      <span>Settings</span>
    </>
  );

  const handleOpenSettingsFromMobileSidebar = useCallback(() => {
    onMobileClose();
    openSettings();
  }, [onMobileClose, openSettings]);
  const renderCompactRow = useCallback((args: {
    key: string;
    label: string;
    active: boolean;
    onClick: () => void;
    icon: ReactNode;
    testId?: string;
    badge?: ReactNode;
  }) => (
    <Tooltip key={args.key} label={args.label} className="flex w-full">
      <button
        type="button"
        onClick={args.onClick}
        data-testid={args.testId}
        className={`group/compact relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-2xl border transition-all ${
          args.active
            ? "border-[color:var(--theme-border-strong)] bg-[rgb(var(--theme-accent-secondary-rgb)/0.18)] text-[color:var(--theme-text-primary)]"
            : "border-transparent text-[color:var(--theme-text-secondary)] hover:bg-[color:var(--theme-bg-muted)] hover:text-[color:var(--theme-text-primary)]"
        }`}
        aria-label={args.label}
      >
        <span className="flex h-[18px] w-[18px] items-center justify-center">
          {args.icon}
        </span>
        {args.badge ? (
          <span className="pointer-events-none absolute right-1.5 top-1.5">
            {args.badge}
          </span>
        ) : null}
      </button>
    </Tooltip>
  ), []);

  const sidebarBody = (
    <nav
      data-testid="app-sidebar-body"
      className={`flex-1 min-h-0 flex flex-col ${sidebarPaddingClass} overflow-y-auto minimal-scroll`}
      style={sidebarBodyStyle}
    >
          <SearchJumpField compactSidebar={compactSidebar} variant={searchVariant} />

          <ul className="flex flex-col gap-1">
            {[allSource].map((source) => (
              compactRail ? (
                <li key={source.id ?? "all"} className="order-1">
                  {renderCompactRow({
                    key: sourceKey(source),
                    label: source.label,
                    active: isTopSourceActive(source),
                    onClick: () => handleSourceClick(source),
                    icon: source.icon,
                    testId: `source-row-${sourceKey(source)}`,
                    badge: SourceIndicator ? (
                      <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[color:var(--theme-bg-root)]">
                        <SourceIndicator sourceId={source.id ?? "all"} />
                      </span>
                    ) : undefined,
                  })}
                </li>
              ) : (
                <li
                  key={source.id ?? "all"}
                  className={`order-1 group/source flex items-stretch gap-2 rounded-lg border transition-all ${
                    isTopSourceActive(source)
                      ? "border-[var(--theme-border-strong)] bg-[rgb(var(--theme-accent-secondary-rgb)/0.18)] text-[var(--theme-text-primary)]"
                      : "border-transparent text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-muted)] hover:text-[var(--theme-text-primary)]"
                  }`}
                >
                  <button
                    onClick={() => handleSourceClick(source)}
                    data-testid={`source-row-${sourceKey(source)}`}
                    className={`
                      flex-1 cursor-pointer flex items-center gap-3 ${rowLeadingPaddingClass} py-1.5 min-w-0
                      text-left text-sm transition-all
                      ${
                        isTopSourceActive(source)
                          ? "text-[var(--theme-text-primary)]"
                          : "text-[var(--theme-text-secondary)] group-hover/source:text-[var(--theme-text-primary)]"
                      }
                    `}
                    >
                    <span className="w-5 flex items-center justify-center">{source.icon}</span>
                    <span className="min-w-0 flex-1 truncate">{source.label}</span>
                  </button>
                  <div
                    onClick={() => handleSourceClick(source)}
                    className={`shrink-0 flex cursor-pointer items-center ${rowTrailingPaddingClass}`}
                  >
                    {sourceIndicatorsVisible && SourceIndicator ? (
                      <span
                        data-testid={`source-indicator-slot-${sourceKey(source)}`}
                        className="flex h-4 w-4 shrink-0 items-center justify-center"
                      >
                        <SourceIndicator sourceId={source.id ?? "all"} />
                      </span>
                    ) : null}
                    <div className={`relative h-6 shrink-0 ${rowCountsVisible ? "ml-1.5 w-[54px]" : "ml-0 w-0"}`}>
                      {rowCountsVisible && sourceTotalCount(source) > 0 && (
                        <span
                          data-testid={`source-counts-${sourceKey(source)}`}
                          className={`absolute inset-y-0 right-0 flex items-center gap-0.5 text-[10px] leading-none tabular-nums transition-all duration-200 ease-in-out ${
                            openMenuSourceKey === sourceKey(source)
                              ? "pointer-events-none translate-x-1 opacity-0"
                              : "opacity-100 group-hover/source:pointer-events-none group-hover/source:translate-x-1 group-hover/source:opacity-0"
                          }`}
                        >
                          <span className={sourceUnreadCount(source) > 0 ? "font-medium text-[var(--theme-accent-secondary)]" : "text-[var(--theme-text-soft)]"}>
                            {fmt(sourceUnreadCount(source))}
                          </span>
                          <span className="text-[var(--theme-text-soft)]">/</span>
                          <span className="text-[var(--theme-text-soft)]">{fmt(sourceTotalCount(source))}</span>
                        </span>
                      )}
                    </div>
                  </div>
                </li>
              )
            ))}
            <li className="order-4">
              {compactRail ? (
                renderCompactRow({
                  key: "saved",
                  label: "Saved",
                  active: isFeedView && !!activeFilter.savedOnly,
                  onClick: () => showFeed({ savedOnly: true }),
                  icon: <BookmarkIcon />,
                })
              ) : (
                <button
                  onClick={() => showFeed({ savedOnly: true })}
                  className={`
                    w-full cursor-pointer flex items-center gap-3 ${rowPaddingClass} py-1.5 rounded-lg
                    text-left text-sm transition-all border
                    ${
                      isFeedView && activeFilter.savedOnly
                        ? "border-[var(--theme-border-strong)] bg-[rgb(var(--theme-accent-secondary-rgb)/0.18)] text-[var(--theme-text-primary)]"
                        : "border-transparent text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-muted)] hover:text-[var(--theme-text-primary)]"
                    }
                  `}
                >
                  <span className="w-5 flex items-center justify-center"><BookmarkIcon /></span>
                  <span className="flex-1">Saved</span>
                  {rowCountsVisible && savedCount > 0 && (
                    <span className="text-[10px] tabular-nums text-[color:var(--theme-text-soft)]">{fmt(savedCount)}</span>
                  )}
                </button>
              )}
            </li>
            <li className="order-5">
              {compactRail ? (
                renderCompactRow({
                  key: "archived",
                  label: "Archived",
                  active: isFeedView && !!activeFilter.archivedOnly,
                  onClick: () => showFeed({ archivedOnly: true }),
                  icon: <ArchiveIcon />,
                })
              ) : (
                <button
                  onClick={() => showFeed({ archivedOnly: true })}
                  className={`
                    w-full cursor-pointer flex items-center gap-3 ${rowPaddingClass} py-1.5 rounded-lg
                    text-left text-sm transition-all border
                    ${
                      isFeedView && activeFilter.archivedOnly
                        ? "border-[color:var(--theme-border-strong)] bg-[rgb(var(--theme-accent-secondary-rgb)/0.18)] text-[color:var(--theme-text-primary)]"
                        : "border-transparent text-[color:var(--theme-text-secondary)] hover:bg-[color:var(--theme-bg-muted)] hover:text-[color:var(--theme-text-primary)]"
                    }
                  `}
                >
                  <span className="w-5 flex items-center justify-center"><ArchiveIcon /></span>
                  <span className="flex-1">Archived</span>
                  {rowCountsVisible && archivedCount > 0 && (
                    <span className="text-[10px] tabular-nums text-[color:var(--theme-text-soft)]">{fmt(archivedCount)}</span>
                  )}
                </button>
              )}
            </li>
            <li className="order-2">
              {compactRail ? (
                renderCompactRow({
                  key: "friends",
                  label: "Friends",
                  active: activeView === "friends",
                  onClick: () => {
                    setActiveView("friends");
                    setSelectedFriend(null);
                    setSelectedItem(null);
                    onMobileClose();
                  },
                  icon: <UsersIcon />,
                  testId: "source-row-friends",
                  badge: pendingMatchCount > 0 ? (
                    <span className="flex h-2.5 w-2.5 rounded-full bg-[var(--theme-accent-secondary)]" />
                  ) : undefined,
                })
              ) : (
                <button
                  onClick={() => {
                    setActiveView("friends");
                    setSelectedFriend(null);
                    setSelectedItem(null);
                    onMobileClose();
                  }}
                  data-testid="source-row-friends"
                  className={`
                    w-full cursor-pointer flex items-center gap-3 ${rowPaddingClass} py-1.5 rounded-lg
                    text-left text-sm transition-all border
                    ${
                      activeView === "friends"
                        ? "border-[var(--theme-border-strong)] bg-[rgb(var(--theme-accent-secondary-rgb)/0.18)] text-[var(--theme-text-primary)]"
                        : "border-transparent text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-muted)] hover:text-[var(--theme-text-primary)]"
                    }
                  `}
                >
                  <span className="w-5 flex items-center justify-center"><UsersIcon /></span>
                  <span className="flex-1">Friends</span>
                  {rowCountsVisible && pendingMatchCount > 0 && (
                    <span className="shrink-0 rounded-full bg-[rgb(var(--theme-accent-secondary-rgb)/0.22)] px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-[var(--theme-text-primary)]">
                      {fmt(pendingMatchCount)}
                    </span>
                  )}
                  {rowCountsVisible && friendCount > 0 && (
                    <span
                      className={`shrink-0 text-[10px] tabular-nums ${
                        activeView === "friends" ? "text-[var(--theme-accent-secondary)]" : "text-[var(--theme-text-soft)]"
                      }`}
                    >
                      {fmt(friendCount)}
                    </span>
                  )}
                </button>
              )}
            </li>
            <li className="order-3">
              {compactRail ? (
                renderCompactRow({
                  key: "map",
                  label: "Map",
                  active: activeView === "map",
                  onClick: () => {
                    setActiveView("map");
                    setSelectedFriend(null);
                    setSelectedItem(null);
                    setSearchQuery("");
                    onMobileClose();
                  },
                  icon: <MapPinIcon />,
                  testId: "source-row-map",
                })
              ) : (
                <button
                  onClick={() => {
                    setActiveView("map");
                    setSelectedFriend(null);
                    setSelectedItem(null);
                    setSearchQuery("");
                    onMobileClose();
                  }}
                  data-testid="source-row-map"
                  className={`
                    w-full cursor-pointer flex items-center gap-3 ${rowPaddingClass} py-1.5 rounded-lg
                    text-left text-sm transition-all border
                    ${
                      activeView === "map"
                        ? "border-[var(--theme-border-strong)] bg-[rgb(var(--theme-accent-secondary-rgb)/0.18)] text-[var(--theme-text-primary)]"
                        : "border-transparent text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-muted)] hover:text-[var(--theme-text-primary)]"
                    }
                  `}
                >
                  <span className="w-5 flex items-center justify-center"><MapPinIcon /></span>
                  <span className="flex-1">Map</span>
                  {rowCountsVisible && mapCount > 0 && (
                    <span
                      className={`shrink-0 text-[10px] tabular-nums ${
                        activeView === "map" ? "text-[var(--theme-accent-secondary)]" : "text-[var(--theme-text-soft)]"
                      }`}
                    >
                      {fmt(mapCount)}
                    </span>
                  )}
                </button>
              )}
            </li>
            {providerSourceItems.map((source) => {
                const isRssSource = source.id === "rss" && feedList.length > 0 && !compactRail;
                const sourceStatus = getSourceStatus?.(source.id) ?? null;

                if (compactRail) {
                  const compactBadge = sourceStatus ? (
                    <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[color:var(--theme-bg-root)]">
                      <ProviderStatusIndicator
                        tone={sourceStatus.tone}
                        syncing={sourceStatus.syncing}
                        label={sourceStatus.label}
                        size="xxs"
                        testId={`source-status-${sourceKey(source)}`}
                      />
                    </span>
                  ) : SourceIndicator ? (
                    <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[color:var(--theme-bg-root)]">
                      <SourceIndicator sourceId={source.id ?? "all"} />
                    </span>
                  ) : undefined;

                  return (
                    <li key={source.id ?? "all"} className={sourceOrderClass(source)}>
                      {renderCompactRow({
                        key: sourceKey(source),
                        label: source.label,
                        active: isTopSourceActive(source),
                        onClick: () => handleSourceClick(source),
                        icon: source.icon,
                        testId: `source-row-${sourceKey(source)}`,
                        badge: compactBadge,
                      })}
                    </li>
                  );
                }

                if (isRssSource) {
                  return (
                    <li key={sourceKey(source)} className={sourceOrderClass(source)}>
                      <div className="space-y-1">
                        <div
                          className={`group/source rounded-lg border transition-all ${
                          isTopSourceActive(source)
                            ? "border-[color:var(--theme-border-strong)] bg-[rgb(var(--theme-accent-secondary-rgb)/0.18)] text-[color:var(--theme-text-primary)]"
                            : "border-transparent text-[color:var(--theme-text-secondary)] hover:bg-[color:var(--theme-bg-muted)] hover:text-[color:var(--theme-text-primary)]"
                          }`}
                        >
                          <div className="flex items-stretch gap-2">
                          <div
                            onClick={() => handleSourceClick(source)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                handleSourceClick(source);
                              }
                            }}
                            data-testid={`source-row-${sourceKey(source)}`}
                            role="button"
                            tabIndex={0}
                            className={`
                              flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 ${rowLeadingPaddingClass} py-1.5 outline-none
                              ${
                                isTopSourceActive(source)
                                  ? "text-[color:var(--theme-text-primary)]"
                                  : "text-[color:var(--theme-text-secondary)] group-hover/source:text-[color:var(--theme-text-primary)]"
                              }
                            `}
                          >
                            <div
                              className={`
                                flex min-w-0 max-w-full items-center gap-3 text-left text-sm transition-all
                                ${
                                  isTopSourceActive(source)
                                    ? "text-[color:var(--theme-text-primary)]"
                                    : "text-[color:var(--theme-text-secondary)] group-hover/source:text-[color:var(--theme-text-primary)]"
                                }
                              `}
                            >
                              <span className="w-5 flex items-center justify-center">{source.icon}</span>
                              <span className="min-w-0 truncate">{source.label}</span>
                            </div>
                            {rssAccordionVisible ? (
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setRssFeedsOpen((value) => !value);
                                }}
                                className="shrink-0 rounded p-1 text-[color:var(--theme-text-soft)] transition-colors hover:text-[color:var(--theme-text-secondary)]"
                                aria-label={rssFeedsOpen ? "Collapse feeds" : "Expand feeds"}
                                aria-expanded={rssFeedsOpen}
                              >
                                <svg
                                  className={`h-3 w-3 transition-transform ${rssFeedsOpen ? "rotate-90" : ""}`}
                                  fill="none"
                                  viewBox="0 0 24 24"
                                  stroke="currentColor"
                                >
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                </svg>
                              </button>
                            ) : null}
                          </div>
                          <div
                            onClick={() => handleSourceClick(source)}
                            className={`shrink-0 flex cursor-pointer items-center ${rowTrailingPaddingClass}`}
                          >
                            {sourceStatusVisible && sourceStatus ? (
                              <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                                <ProviderStatusIndicator
                                  tone={sourceStatus.tone}
                                  syncing={sourceStatus.syncing}
                                  label={sourceStatus.label}
                                  size="xxs"
                                  testId={`source-status-${sourceKey(source)}`}
                                />
                              </span>
                            ) : null}
                            <div className={`relative h-6 shrink-0 ${rowCountsVisible || sourceMenusVisible ? "ml-1.5 w-[54px]" : "ml-0 w-0"}`}>
                              {rowCountsVisible && sourceTotalCount(source) > 0 && (
                                <span
                                  data-testid={`source-counts-${sourceKey(source)}`}
                                  className={`absolute inset-y-0 right-0 flex items-center gap-0.5 text-[10px] leading-none tabular-nums transition-all duration-200 ease-in-out ${
                                    openMenuSourceKey === sourceKey(source)
                                      ? "pointer-events-none translate-x-1 opacity-0"
                                      : "opacity-100 group-hover/source:pointer-events-none group-hover/source:translate-x-1 group-hover/source:opacity-0"
                                  }`}
                                >
                                  <span className={sourceUnreadCount(source) > 0 ? "font-medium text-[var(--theme-accent-secondary)]" : "text-[var(--theme-text-soft)]"}>
                                    {fmt(sourceUnreadCount(source))}
                                  </span>
                                  <span className="text-[var(--theme-text-soft)]">/</span>
                                  <span className="text-[var(--theme-text-soft)]">{fmt(sourceTotalCount(source))}</span>
                                </span>
                              )}
                              {sourceMenusVisible && canShowSourceMenu(source) ? (
                                <button
                                  aria-label={`Options for ${source.label}`}
                                  data-testid={`source-menu-trigger-${sourceKey(source)}`}
                                  onMouseDown={(e) => {
                                    e.stopPropagation();
                                  }}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (openMenuSourceKey === sourceKey(source)) {
                                      setOpenMenuSourceKey(null);
                                      setSourceMenuAnchorRect(null);
                                      setSourceMenuAnchorElement(null);
                                    } else {
                                      setOpenMenuFeedUrl(null);
                                      setMenuAnchorRect(null);
                                      setMenuAnchorElement(null);
                                      setOpenMenuSourceKey(sourceKey(source));
                                      setSourceMenuAnchorRect(e.currentTarget.getBoundingClientRect());
                                      setSourceMenuAnchorElement(e.currentTarget);
                                    }
                                  }}
                                  className={`absolute inset-y-0 right-0 flex items-center p-1 rounded-md transition-all duration-200 ease-in-out hover:text-[color:var(--theme-text-primary)] hover:bg-[color:var(--theme-bg-muted)] ${
                                    openMenuSourceKey === sourceKey(source)
                                      ? "translate-x-0 bg-[color:var(--theme-bg-muted)] text-[color:var(--theme-text-primary)] opacity-100"
                                      : "pointer-events-none translate-x-[-4px] text-[color:var(--theme-text-muted)] opacity-0 group-hover/source:pointer-events-auto group-hover/source:translate-x-0 group-hover/source:opacity-100"
                                  }`}
                                >
                                  <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                                    <path d="M10 6a2 2 0 110-4 2 2 0 010 4zm0 6a2 2 0 110-4 2 2 0 010 4zm0 6a2 2 0 110-4 2 2 0 010 4z" />
                                  </svg>
                                </button>
                              ) : null}
                            </div>
                          </div>
                          </div>
                        </div>

                        {rssFeedsOpen && (
                          <div className="space-y-2">
                            {visibleFeedList.length > 0 ? (
                              <>
                                <div className={narrowLabeledSidebar ? "pl-2" : "pl-6"}>
                                  <ul className="space-y-0.5">
                                  {pagedFeeds.map((feed) => {
                                    const unread = feedUnreadCounts[feed.url] ?? 0;
                                    const total = feedTotalCounts[feed.url] ?? 0;
                                    const isActive = isFeedView && activeFilter.feedUrl === feed.url;
                                    const menuOpen = openMenuFeedUrl === feed.url;

                                    return (
                                      <li
                                        key={feed.url}
                                        className={`group/feed flex items-stretch gap-2 rounded-lg border transition-all ${
                                          isActive
                                            ? "border-[color:var(--theme-border-strong)] bg-[rgb(var(--theme-accent-secondary-rgb)/0.18)] text-[color:var(--theme-text-primary)]"
                                            : "border-transparent text-[color:var(--theme-text-secondary)] hover:bg-[color:var(--theme-bg-muted)] hover:text-[color:var(--theme-text-primary)]"
                                        }`}
                                      >
                                        <button
                                          onClick={() => handleFeedClick(feed.url)}
                                          className={`flex-1 cursor-pointer flex items-center gap-2 ${rowLeadingPaddingClass} py-2 min-w-0 text-left`}
                                        >
                                          {feed.imageUrl ? (
                                            <img
                                              src={feed.imageUrl}
                                              alt=""
                                              loading="lazy"
                                              decoding="async"
                                              className="w-4 h-4 rounded-sm shrink-0 object-cover"
                                            />
                                          ) : (
                                            <RssIcon className="w-4 h-4 shrink-0 text-[color:var(--theme-text-soft)]" />
                                          )}
                                          <span className="flex-1 truncate text-xs">{feed.title}</span>
                                        </button>

                                        <div
                                          onClick={() => handleFeedClick(feed.url)}
                                          className={`shrink-0 flex cursor-pointer items-center ${rowTrailingPaddingClass}`}
                                        >
                                          {rowCountsVisible && total > 0 && (
                                            <span className={`${menuOpen ? "hidden" : "flex group-hover/feed:hidden"} items-center gap-0.5 text-[10px] tabular-nums`}>
                                              <span className={unread > 0 ? "font-medium text-[var(--theme-accent-secondary)]" : "text-[var(--theme-text-soft)]"}>
                                                {fmt(unread)}
                                              </span>
                                              <span className="text-[var(--theme-text-soft)]">/</span>
                                              <span className="text-[var(--theme-text-soft)]">{fmt(total)}</span>
                                            </span>
                                          )}
                                          <button
                                            aria-label={`Options for ${feed.title}`}
                                            onMouseDown={(e) => {
                                              e.stopPropagation();
                                            }}
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              if (menuOpen) {
                                                setOpenMenuFeedUrl(null);
                                                setMenuAnchorRect(null);
                                                setMenuAnchorElement(null);
                                              } else {
                                                setOpenMenuSourceKey(null);
                                                setSourceMenuAnchorRect(null);
                                                setSourceMenuAnchorElement(null);
                                                setOpenMenuFeedUrl(feed.url);
                                                setMenuAnchorRect(e.currentTarget.getBoundingClientRect());
                                                setMenuAnchorElement(e.currentTarget);
                                              }
                                            }}
                                            className={`${menuOpen ? "flex bg-[color:var(--theme-bg-muted)] text-[color:var(--theme-text-primary)]" : sourceMenusVisible ? "hidden group-hover/feed:flex text-[color:var(--theme-text-muted)]" : "hidden"} items-center rounded-md p-1 transition-colors hover:bg-[color:var(--theme-bg-muted)] hover:text-[color:var(--theme-text-primary)]`}
                                          >
                                            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                                              <path d="M10 6a2 2 0 110-4 2 2 0 010 4zm0 6a2 2 0 110-4 2 2 0 010 4zm0 6a2 2 0 110-4 2 2 0 010 4z" />
                                            </svg>
                                          </button>
                                        </div>
                                      </li>
                                    );
                                  })}
                                  </ul>
                                </div>

                                {visibleFeedList.length > FEEDS_PAGE_SIZE && (
                                  <div className="flex w-full items-center justify-between gap-2 px-1">
                                    <button
                                      type="button"
                                      onClick={() => handleFeedPageChange("prev")}
                                      disabled={rssFeedPage === 0}
                                      aria-label="Previous feeds page"
                                      className="rounded-md px-2 py-1 text-[11px] font-medium text-[color:var(--theme-text-secondary)] hover:bg-[color:var(--theme-bg-muted)] hover:text-[color:var(--theme-text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
                                    >
                                      &lt;
                                    </button>
                                    <span className="text-[10px] text-[color:var(--theme-text-soft)]">
                                      {(rssFeedPage * FEEDS_PAGE_SIZE + 1).toLocaleString()} to{" "}
                                      {Math.min((rssFeedPage + 1) * FEEDS_PAGE_SIZE, visibleFeedList.length).toLocaleString()} of{" "}
                                      {visibleFeedList.length.toLocaleString()}
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => handleFeedPageChange("next")}
                                      disabled={rssFeedPage >= totalFeedPages - 1}
                                      aria-label="Next feeds page"
                                      className="rounded-md px-2 py-1 text-[11px] font-medium text-[color:var(--theme-text-secondary)] hover:bg-[color:var(--theme-bg-muted)] hover:text-[color:var(--theme-text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
                                    >
                                      &gt;
                                    </button>
                                  </div>
                                )}
                              </>
                            ) : (
                              <p className={`${rowPaddingClass} py-2 text-[11px] text-[color:var(--theme-text-muted)]`}>
                                No feeds match &ldquo;{searchQuery.trim()}&rdquo;.
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    </li>
                  );
                }

                return (
                  <li
                    key={source.id ?? "all"}
                    className={`${sourceOrderClass(source)} group/source flex items-stretch gap-2 rounded-lg border transition-all ${
                      isTopSourceActive(source)
                        ? "border-[color:var(--theme-border-strong)] bg-[rgb(var(--theme-accent-secondary-rgb)/0.18)] text-[color:var(--theme-text-primary)]"
                        : "border-transparent text-[color:var(--theme-text-secondary)] hover:bg-[color:var(--theme-bg-muted)] hover:text-[color:var(--theme-text-primary)]"
                    }`}
                  >
                    <button
                      onClick={() => handleSourceClick(source)}
                      data-testid={`source-row-${sourceKey(source)}`}
                      className={`
                        flex-1 cursor-pointer flex items-center gap-3 ${rowLeadingPaddingClass} py-1.5 min-w-0
                        text-left text-sm transition-all
                        ${
                          isTopSourceActive(source)
                            ? "text-[color:var(--theme-text-primary)]"
                            : "text-[color:var(--theme-text-secondary)] group-hover/source:text-[color:var(--theme-text-primary)]"
                        }
                      `}
                    >
                      <span className="w-5 flex items-center justify-center">{source.icon}</span>
                      <span className="min-w-0 flex-1 truncate">{source.label}</span>
                    </button>
                    <div
                      onClick={() => handleSourceClick(source)}
                      className={`shrink-0 flex cursor-pointer items-center ${rowTrailingPaddingClass}`}
                    >
                      {sourceIndicatorsVisible && SourceIndicator ? (
                        <span
                          data-testid={`source-indicator-slot-${sourceKey(source)}`}
                          className="flex h-4 w-4 shrink-0 items-center justify-center"
                        >
                          <SourceIndicator sourceId={source.id ?? "all"} />
                        </span>
                      ) : null}
                      <div className={`relative h-6 shrink-0 ${rowCountsVisible || sourceMenusVisible ? "ml-1.5 w-[54px]" : "ml-0 w-0"}`}>
                        {rowCountsVisible && sourceTotalCount(source) > 0 && (
                          <span
                            data-testid={`source-counts-${sourceKey(source)}`}
                            className={`absolute inset-y-0 right-0 flex items-center gap-0.5 text-[10px] leading-none tabular-nums transition-all duration-200 ease-in-out ${
                              openMenuSourceKey === sourceKey(source)
                                ? "pointer-events-none translate-x-1 opacity-0"
                                : "opacity-100 group-hover/source:pointer-events-none group-hover/source:translate-x-1 group-hover/source:opacity-0"
                            }`}
                          >
                            <span className={sourceUnreadCount(source) > 0 ? "font-medium text-[var(--theme-accent-secondary)]" : "text-[var(--theme-text-soft)]"}>
                              {fmt(sourceUnreadCount(source))}
                            </span>
                            <span className="text-[var(--theme-text-soft)]">/</span>
                            <span className="text-[var(--theme-text-soft)]">{fmt(sourceTotalCount(source))}</span>
                          </span>
                        )}
                        {sourceMenusVisible && canShowSourceMenu(source) ? (
                          <button
                            aria-label={`Options for ${source.label}`}
                            data-testid={`source-menu-trigger-${sourceKey(source)}`}
                            onMouseDown={(e) => {
                              e.stopPropagation();
                            }}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (openMenuSourceKey === sourceKey(source)) {
                                setOpenMenuSourceKey(null);
                                setSourceMenuAnchorRect(null);
                                setSourceMenuAnchorElement(null);
                              } else {
                                setOpenMenuFeedUrl(null);
                                setMenuAnchorRect(null);
                                setMenuAnchorElement(null);
                                setOpenMenuSourceKey(sourceKey(source));
                                setSourceMenuAnchorRect(e.currentTarget.getBoundingClientRect());
                                setSourceMenuAnchorElement(e.currentTarget);
                              }
                            }}
                            className={`absolute inset-y-0 right-0 flex items-center p-1 rounded-md transition-all duration-200 ease-in-out hover:text-[color:var(--theme-text-primary)] hover:bg-[color:var(--theme-bg-muted)] ${
                              openMenuSourceKey === sourceKey(source)
                                ? "translate-x-0 bg-[color:var(--theme-bg-muted)] text-[color:var(--theme-text-primary)] opacity-100"
                                : "pointer-events-none translate-x-[-4px] text-[color:var(--theme-text-muted)] opacity-0 group-hover/source:pointer-events-auto group-hover/source:translate-x-0 group-hover/source:opacity-100"
                            }`}
                          >
                            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                              <path d="M10 6a2 2 0 110-4 2 2 0 010 4zm0 6a2 2 0 110-4 2 2 0 010 4zm0 6a2 2 0 110-4 2 2 0 010 4z" />
                            </svg>
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </li>
                );
              })}
          </ul>

          {/* Tags */}
          {!compactRail && topLevelTags.length > 0 && (
            <SidebarSection title="Tags" defaultOpen={true} count={allTags.length}>
              <ul className="space-y-0.5">
                {topLevelTags.map((top) => {
                  const children = allTags.filter(
                    (t) => t.startsWith(`${top}/`) && t !== top,
                  );
                  const hasChildren = children.length > 0;
                  const active = isTagActive(top);
                  return (
                    <TagTreeNode
                      key={top}
                      tag={top}
                      label={top}
                      active={active}
                      onClick={() => handleTagClick(top)}
                    >
                      {hasChildren &&
                        children.map((child) => (
                          <TagTreeNode
                            key={child}
                            tag={child}
                            label={child.slice(top.length + 1)}
                            active={
                              isFeedView && !!(activeFilter.tags?.includes(child))
                            }
                            onClick={() => showFeed({ tags: [child] })}
                          />
                        ))}
                    </TagTreeNode>
                  );
                })}
              </ul>
            </SidebarSection>
          )}

          {/* Settings — pushed to bottom */}
          <div className="mt-auto hidden shrink-0 md:block">
            {compactRail ? (
              renderCompactRow({
                key: "settings",
                label: "Settings",
                active: false,
                onClick: openSettings,
                icon: (
                  <svg className="w-4 h-4 inline" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                ),
              })
            ) : (
              <button
                onClick={openSettings}
                className={`w-full cursor-pointer flex items-center gap-3 ${rowPaddingClass} py-1.5 rounded-lg text-left text-sm text-[color:var(--theme-text-secondary)] hover:bg-[color:var(--theme-bg-muted)] hover:text-[color:var(--theme-text-primary)] transition-all`}
              >
                <span className="w-5 text-center">
                  <svg className="w-4 h-4 inline" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </span>
                <span>Settings</span>
              </button>
            )}
          </div>
    </nav>
  );

  return (
    <>
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 md:hidden"
          onClick={onMobileClose}
        />
      )}

      <div
        data-testid="app-sidebar-shell"
        className="hidden md:flex flex-none overflow-visible"
        style={{
          width: desktopShellWidth,
          paddingTop: desktopShellTopPadding,
          transition: dragging.current ? "none" : "width 220ms ease, opacity 180ms ease",
        }}
      >
        <div className="relative h-full w-full overflow-visible">
          {renderMode !== "closed" ? (
            <aside
              data-testid="app-sidebar"
              className="theme-floating-panel relative z-10 flex h-full min-h-0 shrink-0 flex-col overflow-hidden"
              style={{
                width: px(desktopAsideWidth),
                transition: dragging.current ? "none" : "width 220ms ease",
              }}
            >
              {sidebarBody}
            </aside>
          ) : null}
          {resizeHandleVisible ? (
            <div
              data-testid="app-sidebar-resize-handle"
              className="theme-resize-gap-handle absolute inset-y-0 z-20 w-4"
              style={{ left: px(rawDesktopWidth) }}
              onMouseDown={handleDragStart}
            />
          ) : null}
        </div>
      </div>

      <aside
        data-testid="app-sidebar-mobile"
        className={`
          fixed inset-y-0 left-0 z-50 flex min-h-0 h-full flex-col overflow-hidden bg-[color-mix(in_oklab,var(--theme-bg-root)_88%,transparent)]
          transform transition-transform duration-200 ease-in-out md:hidden
          ${mobileOpen ? "translate-x-0" : "-translate-x-full"}
        `}
        style={{ width: `${committedWidth}px` }}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-[var(--theme-border-subtle)] p-4 pt-[calc(env(safe-area-inset-top)+1rem)]">
          {!headerDragRegion && (
            <span className="text-lg font-bold gradient-text font-logo">FREED</span>
          )}
          <button
            onClick={onMobileToggle}
            aria-label="Close menu"
            className="ml-auto rounded-lg p-2 transition-colors hover:bg-[var(--theme-bg-muted)]"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        </div>
        {sidebarBody}
        <div
          className={`shrink-0 border-t border-[var(--theme-border-subtle)] ${sidebarPaddingClass} pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-3`}
        >
          <button
            onClick={handleOpenSettingsFromMobileSidebar}
            className={`w-full cursor-pointer flex items-center gap-3 ${rowPaddingClass} py-2 rounded-lg text-left text-sm text-[color:var(--theme-text-secondary)] hover:bg-[color:var(--theme-bg-muted)] hover:text-[color:var(--theme-text-primary)] transition-all`}
          >
            {settingsButtonContent}
          </button>
        </div>
      </aside>

      <SettingsDialog open={showSettings} onClose={closeSettings} />

      {/* Feed context menu — rendered outside scroll container to avoid clipping */}
      {openMenuFeedUrl && menuAnchorRect && feeds[openMenuFeedUrl] && (
        <FeedContextMenu
          feed={feeds[openMenuFeedUrl]}
          anchorRect={menuAnchorRect}
          anchorElement={menuAnchorElement}
          onClose={() => {
            setOpenMenuFeedUrl(null);
            setMenuAnchorRect(null);
            setMenuAnchorElement(null);
          }}
          onRename={async (title) => {
            await renameFeed(openMenuFeedUrl, title);
            setOpenMenuFeedUrl(null);
            setMenuAnchorRect(null);
            setMenuAnchorElement(null);
          }}
          onUnsubscribe={async () => {
            await removeFeed(openMenuFeedUrl);
            if (activeFilter.feedUrl === openMenuFeedUrl) {
              setFilter({ platform: "rss" });
            }
            setOpenMenuFeedUrl(null);
            setMenuAnchorRect(null);
            setMenuAnchorElement(null);
          }}
        />
      )}

      {selectedMenuSource && sourceMenuAnchorRect && (
        <SourceContextMenu
          source={selectedMenuSource}
          anchorRect={sourceMenuAnchorRect}
          anchorElement={sourceMenuAnchorElement}
          unread={sourceUnreadCount(selectedMenuSource)}
          total={sourceTotalCount(selectedMenuSource)}
          status={selectedMenuStatus}
          onClose={() => {
            setOpenMenuSourceKey(null);
            setSourceMenuAnchorRect(null);
            setSourceMenuAnchorElement(null);
          }}
          onOpenSettings={
            settingsSectionForSource(selectedMenuSource)
              ? () => {
                  useSettingsStore.getState().openTo(settingsSectionForSource(selectedMenuSource)!);
                  onMobileClose();
                }
              : undefined
          }
          onSyncNow={
            selectedMenuSourceId === "rss" && syncRssNow
              ? () => {
                  void syncRssNow();
                }
              : typeof selectedMenuSourceId === "string" && syncSourceNow
                ? () => {
                    void syncSourceNow(selectedMenuSourceId);
                  }
              : undefined
          }
        />
      )}
    </>
  );
}

// ─── TagTreeNode ──────────────────────────────────────────────────────────────

function TagTreeNode({
  tag: _tag,
  label,
  active,
  onClick,
  children,
}: {
  tag: string;
  label: string;
  active: boolean;
  onClick: () => void;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const hasChildren = !!children;

  return (
    <li>
      <div className="flex items-center">
        <button
          onClick={onClick}
          className={`flex-1 flex items-center gap-2 pl-3 pr-1 py-1.5 rounded-lg text-xs transition-all text-left ${
            active
              ? "bg-[rgb(var(--theme-accent-secondary-rgb)/0.18)] text-[var(--theme-accent-secondary)]"
              : "text-[color:var(--theme-text-secondary)] hover:bg-[color:var(--theme-bg-muted)] hover:text-[color:var(--theme-text-primary)]"
          }`}
        >
          <svg className="w-3 h-3 shrink-0 text-[color:var(--theme-text-soft)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
          </svg>
          <span className="truncate">{label}</span>
        </button>
        {hasChildren && (
          <button
            onClick={() => setOpen((v) => !v)}
            className="rounded p-1 text-[color:var(--theme-text-soft)] transition-colors hover:text-[color:var(--theme-text-secondary)]"
            aria-label={open ? "Collapse" : "Expand"}
          >
            <svg
              className={`w-3 h-3 transition-transform ${open ? "rotate-90" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        )}
      </div>
      {hasChildren && open && (
        <ul className="ml-4 mt-0.5 space-y-0.5 border-l border-[color:var(--theme-border-subtle)] pl-2">
          {children}
        </ul>
      )}
    </li>
  );
}
