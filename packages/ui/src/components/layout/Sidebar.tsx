import { useState, useCallback, useEffect, useRef, useMemo, type ReactNode } from "react";

import { countFriendsWithRecentLocationUpdates, type FilterOptions, type RssFeed } from "@freed/shared";
import { useAppStore, usePlatform, type SidebarSourceStatusSummary } from "../../context/PlatformContext.js";
import { ProviderStatusIndicator } from "../ProviderStatusIndicator.js";
import { SettingsDialog } from "../SettingsDialog.js";
import { toast } from "../Toast.js";
import { useDebugStore } from "../../lib/debug-store.js";
import { useSettingsStore } from "../../lib/settings-store.js";
import { MapPinIcon, RssIcon, BookmarkIcon, ArchiveIcon, UsersIcon } from "../icons.js";
import { TOP_SOURCE_ITEMS, type SourceNavigationItem } from "../../lib/source-navigation.js";

const compactNumberFormatter = new Intl.NumberFormat(undefined, {
  notation: "compact",
  maximumFractionDigits: 1,
});
function fmt(n: number): string {
  return compactNumberFormatter.format(n);
}

interface SidebarProps {
  open: boolean;
  onClose: () => void;
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
        className="w-full flex items-center px-3 py-1.5 rounded-lg border border-transparent group hover:bg-white/5 transition-colors"
      >
        <span className="text-xs font-semibold text-[#71717a] uppercase tracking-wider flex-1 text-left leading-5">
          {title}
        </span>
        {!open && count !== undefined && count > 0 && (
          <span className="text-[10px] tabular-nums text-[#52525b] mr-1.5">{count}</span>
        )}
        <svg
          className={`w-3 h-3 text-[#52525b] transition-transform shrink-0 ${open ? "rotate-90" : ""}`}
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
  if (!lastFetched) return "bg-[#52525b]";
  const diff = Date.now() - lastFetched;
  if (diff < 60 * 60_000) return "bg-emerald-500";
  if (diff < 24 * 60 * 60_000) return "bg-amber-500";
  return "bg-red-500";
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
      className="fixed z-[300] bg-[#161616] border border-[rgba(255,255,255,0.1)] rounded-xl shadow-2xl shadow-black/70 overflow-hidden"
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
      <div className="px-3 py-2.5 border-b border-[rgba(255,255,255,0.07)]">
        <div className="flex items-center gap-2">
          <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${syncDotClass(feed.lastFetched)}`} />
          <span className="text-[11px] text-[#71717a]">{syncStatusLabel(feed.lastFetched)}</span>
          <span className="text-[11px] text-[#52525b] ml-auto">{formatLastSync(feed.lastFetched)}</span>
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
              className="w-full bg-[#222] border border-[#8b5cf6]/50 rounded-lg px-2.5 py-1.5 text-xs text-white outline-none focus:border-[#8b5cf6] placeholder-[#52525b]"
            />
          </div>
        ) : (
          <button
            onClick={() => setRenaming(true)}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-[#a1a1aa] hover:bg-white/5 hover:text-white transition-colors text-left"
          >
            <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
            Rename
          </button>
        )}
        <button
          onClick={onUnsubscribe}
          className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-red-400 hover:bg-red-500/10 hover:text-red-300 transition-colors text-left"
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
      <div className="px-3 py-2.5 border-b border-[rgba(255,255,255,0.07)]">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-medium text-[#d4d4d8] truncate">{sourceLabel}</span>
          <span className="text-[11px] text-[#52525b] ml-auto">{totalLabel}</span>
        </div>
      </div>

      {status ? (
        <div className="px-3 py-2.5 border-b border-[rgba(255,255,255,0.07)]">
          <div className="flex items-center gap-2">
            <ProviderStatusIndicator
              tone={status.tone}
              syncing={status.syncing}
              label={status.label}
              size="xs"
            />
            <span className="text-xs font-medium text-[#d4d4d8]">
              {status.syncing && status.tone === "healthy" ? "Syncing" : status.label}
            </span>
          </div>
          {status.detail ? (
            <p className="mt-1.5 text-[11px] leading-4 text-[#8a8a93]">
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
                ? "bg-[#8b5cf6]/20 text-[#c4b5fd]"
                : "text-[#a1a1aa] hover:bg-white/5 hover:text-white"
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
            className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-[#a1a1aa] hover:bg-white/5 hover:text-white transition-colors text-left"
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

const MIN_WIDTH = 180;
const MAX_WIDTH = 480;
const DEFAULT_WIDTH = 256;
export function Sidebar({ open, onClose }: SidebarProps) {
  const { SourceIndicator, headerDragRegion, syncRssNow, syncSourceNow, getSourceStatus } = usePlatform();
  const activeFilter = useAppStore((s) => s.activeFilter);
  const setFilter = useAppStore((s) => s.setFilter);
  const setSelectedItem = useAppStore((s) => s.setSelectedItem);
  const setSelectedFriend = useAppStore((s) => s.setSelectedFriend);
  const setSearchQuery = useAppStore((s) => s.setSearchQuery);
  const feeds = useAppStore((s) => s.feeds);
  const friends = useAppStore((s) => s.friends);
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
        .providerSyncCounts ?? {}) as Partial<Record<string, number>>,
  );
  const sidebarWidth = useAppStore((s) => s.preferences.display.sidebarWidth) ?? DEFAULT_WIDTH;
  const updatePreferences = useAppStore((s) => s.updatePreferences);
  const items = useAppStore((s) => s.items);
  const activeView = useAppStore((s) => s.activeView);
  const setActiveView = useAppStore((s) => s.setActiveView);
  const pendingMatchCount = useAppStore((s) => s.pendingMatchCount);
  const health = useDebugStore((s) => s.health);

  const savedCount = useMemo(() => items.filter((i) => i.userState.saved).length, [items]);
  const archivedCount = useMemo(() => items.filter((i) => i.userState.archived).length, [items]);
  const friendCount = useMemo(() => Object.keys(friends).length, [friends]);
  const mapFriendCount = useMemo(
    () => countFriendsWithRecentLocationUpdates(items, friends),
    [friends, items]
  );

  const { open: showSettings, openDefault: openSettings, close: closeSettings } = useSettingsStore();
  const [dragWidth, setDragWidth] = useState<number | null>(null);

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

  const width = dragWidth ?? sidebarWidth;

  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;
      const startX = e.clientX;
      const startW = width;

      const onMove = (ev: MouseEvent) => {
        if (!dragging.current) return;
        const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startW + ev.clientX - startX));
        setDragWidth(next);
      };
      const onUp = (ev: MouseEvent) => {
        dragging.current = false;
        const final = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startW + ev.clientX - startX));
        setDragWidth(null);
        updatePreferences({ display: { sidebarWidth: final } } as Parameters<typeof updatePreferences>[0]);
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [width, updatePreferences],
  );

  const feedList = Object.values(feeds).filter((f) => f.enabled);

  const showFeed = useCallback((filter: FilterOptions) => {
    setActiveView("feed");
    setSelectedFriend(null);
    setSelectedItem(null);
    setFilter(filter);
    onClose();
  }, [onClose, setActiveView, setFilter, setSelectedFriend, setSelectedItem]);

  const handleSourceClick = (source: SourceNavigationItem) => {
    showFeed({ platform: source.id });
  };

  const handleFeedClick = (feedUrl: string) => {
    showFeed({ platform: "rss", feedUrl });
  };

  const isTopSourceActive = (source: SourceNavigationItem) => {
    if (!isFeedView) return false;
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

  return (
    <>
      {/* Mobile overlay */}
      {open && (
        <div
          className="fixed inset-0 bg-black/60 z-40 md:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed inset-y-0 left-0 md:relative z-50 md:z-auto
          h-full
          bg-[#0a0a0a] md:bg-[#0f0f0f]
          border-r border-[rgba(255,255,255,0.08)]
          transform transition-transform duration-200 ease-in-out
          ${open ? "translate-x-0" : "-translate-x-full md:translate-x-0"}
          flex flex-col min-h-0
        `}
        style={{ width: `${width}px` }}
      >
        {/* Mobile header with close button */}
        <div className="md:hidden flex items-center justify-between p-4 pt-[calc(env(safe-area-inset-top)+1rem)] border-b border-[rgba(255,255,255,0.08)] shrink-0">
          {!headerDragRegion && (
            <span className="text-lg font-bold gradient-text font-logo">FREED</span>
          )}
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-white/10 ml-auto">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <nav
          className="flex-1 min-h-0 flex flex-col px-4 pt-4 overflow-y-auto minimal-scroll"
          style={{ paddingBottom: 'calc(1rem + 100lvh - 100dvh + env(safe-area-inset-bottom, 0px))' }}
        >
          {/* Sources */}
          <SidebarSection title="Sources">
            <ul className="space-y-1">
              {[allSource].map((source) => (
                <li
                  key={source.id ?? "all"}
                  className={`group/source flex items-stretch gap-2 rounded-lg border transition-all ${
                    isTopSourceActive(source)
                      ? "bg-[#8b5cf6]/20 text-white border-[#8b5cf6]/30"
                      : "border-transparent text-[#a1a1aa] hover:bg-white/5 hover:text-white"
                  }`}
                >
                  <button
                    onClick={() => handleSourceClick(source)}
                    data-testid={`source-row-${sourceKey(source)}`}
                    className={`
                      flex-1 flex items-center gap-3 pl-3 py-1.5 min-w-0
                      text-left text-sm transition-all
                      ${
                        isTopSourceActive(source)
                          ? "text-white"
                          : "text-[#a1a1aa] group-hover/source:text-white"
                      }
                    `}
                  >
                    <span className="w-5 flex items-center justify-center">{source.icon}</span>
                    <span className="min-w-0 flex-1 truncate">{source.label}</span>
                  </button>
                  <div className="shrink-0 flex items-center pr-2">
                    {SourceIndicator ? (
                      <span
                        data-testid={`source-indicator-slot-${sourceKey(source)}`}
                        className={`flex h-4 w-4 shrink-0 items-center justify-center transition-transform duration-200 ease-in-out ${
                          openMenuSourceKey === sourceKey(source)
                            ? "translate-x-1"
                            : "group-hover/source:translate-x-1"
                        }`}
                      >
                        <SourceIndicator sourceId={source.id ?? "all"} />
                      </span>
                    ) : null}
                    <div className="relative ml-1.5 h-6 w-[54px] shrink-0">
                      {sourceTotalCount(source) > 0 && (
                        <span
                          data-testid={`source-counts-${sourceKey(source)}`}
                          className={`absolute inset-y-0 right-0 flex items-center gap-0.5 text-[10px] leading-none tabular-nums transition-all duration-200 ease-in-out ${
                            openMenuSourceKey === sourceKey(source)
                              ? "pointer-events-none translate-x-1 opacity-0"
                              : "opacity-100 group-hover/source:pointer-events-none group-hover/source:translate-x-1 group-hover/source:opacity-0"
                          }`}
                        >
                            <span className={sourceUnreadCount(source) > 0 ? "text-[#8b5cf6] font-medium" : "text-[#52525b]"}>
                              {fmt(sourceUnreadCount(source))}
                            </span>
                            <span className="text-[#3f3f46]">/</span>
                            <span className="text-[#52525b]">{fmt(sourceTotalCount(source))}</span>
                        </span>
                      )}
                      {canShowSourceMenu(source) ? (
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
                          className={`absolute inset-y-0 right-0 flex items-center p-1 rounded-md transition-all duration-200 ease-in-out hover:text-white hover:bg-white/10 ${
                            openMenuSourceKey === sourceKey(source)
                              ? "translate-x-0 bg-white/10 text-white opacity-100"
                              : "pointer-events-none translate-x-[-4px] text-[#71717a] opacity-0 group-hover/source:pointer-events-auto group-hover/source:translate-x-0 group-hover/source:opacity-100"
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
              ))}
              {/* Friends — active nav item */}
              <li>
                <button
                  onClick={() => {
                    setActiveView("friends");
                    setSelectedFriend(null);
                    setSelectedItem(null);
                    onClose();
                  }}
                  data-testid="source-row-friends"
                  className={`
                    w-full flex items-center gap-3 px-3 py-1.5 rounded-lg
                    text-left text-sm transition-all border
                    ${
                      activeView === "friends"
                        ? "bg-[#8b5cf6]/20 text-white border-[#8b5cf6]/30"
                        : "border-transparent text-[#a1a1aa] hover:bg-white/5 hover:text-white"
                    }
                  `}
                >
                  <span className="w-5 flex items-center justify-center"><UsersIcon /></span>
                  <span className="flex-1">Friends</span>
                  {pendingMatchCount > 0 && (
                    <span className="shrink-0 text-[10px] tabular-nums font-medium px-1.5 py-0.5 rounded-full bg-[#8b5cf6]/30 text-[#c4b5fd]">
                      {fmt(pendingMatchCount)}
                    </span>
                  )}
                  {friendCount > 0 && (
                    <span
                      className={`shrink-0 text-[10px] tabular-nums ${
                        activeView === "friends" ? "text-[#c4b5fd]" : "text-[#52525b]"
                      }`}
                    >
                      {fmt(friendCount)}
                    </span>
                  )}
                </button>
              </li>
              <li>
                <button
                  onClick={() => {
                    setActiveView("map");
                    setSelectedFriend(null);
                    setSelectedItem(null);
                    setSearchQuery("");
                    onClose();
                  }}
                  data-testid="source-row-map"
                  className={`
                    w-full flex items-center gap-3 px-3 py-1.5 rounded-lg
                    text-left text-sm transition-all border
                    ${
                      activeView === "map"
                        ? "bg-[#8b5cf6]/20 text-white border-[#8b5cf6]/30"
                        : "border-transparent text-[#a1a1aa] hover:bg-white/5 hover:text-white"
                    }
                  `}
                >
                  <span className="w-5 flex items-center justify-center"><MapPinIcon /></span>
                  <span className="flex-1">Map</span>
                  {mapFriendCount > 0 && (
                    <span
                      className={`shrink-0 text-[10px] tabular-nums ${
                        activeView === "map" ? "text-[#c4b5fd]" : "text-[#52525b]"
                      }`}
                    >
                      {fmt(mapFriendCount)}
                    </span>
                  )}
                </button>
              </li>
              {providerSourceItems.map((source) => (
                <li
                  key={source.id ?? "all"}
                  className={`group/source flex items-stretch gap-2 rounded-lg border transition-all ${
                    isTopSourceActive(source)
                      ? "bg-[#8b5cf6]/20 text-white border-[#8b5cf6]/30"
                      : "border-transparent text-[#a1a1aa] hover:bg-white/5 hover:text-white"
                  }`}
                >
                  <button
                    onClick={() => handleSourceClick(source)}
                    data-testid={`source-row-${sourceKey(source)}`}
                    className={`
                      flex-1 flex items-center gap-3 pl-3 py-1.5 min-w-0
                      text-left text-sm transition-all
                      ${
                        isTopSourceActive(source)
                          ? "text-white"
                          : "text-[#a1a1aa] group-hover/source:text-white"
                      }
                    `}
                  >
                    <span className="w-5 flex items-center justify-center">{source.icon}</span>
                    <span className="min-w-0 flex-1 truncate">{source.label}</span>
                  </button>
                  <div className="shrink-0 flex items-center pr-2">
                    {SourceIndicator ? (
                      <span
                        data-testid={`source-indicator-slot-${sourceKey(source)}`}
                        className={`flex h-4 w-4 shrink-0 items-center justify-center transition-transform duration-200 ease-in-out ${
                          openMenuSourceKey === sourceKey(source)
                            ? "translate-x-1"
                            : "group-hover/source:translate-x-1"
                        }`}
                      >
                        <SourceIndicator sourceId={source.id ?? "all"} />
                      </span>
                    ) : null}
                    <div className="relative ml-1.5 h-6 w-[54px] shrink-0">
                      {sourceTotalCount(source) > 0 && (
                        <span
                          data-testid={`source-counts-${sourceKey(source)}`}
                          className={`absolute inset-y-0 right-0 flex items-center gap-0.5 text-[10px] leading-none tabular-nums transition-all duration-200 ease-in-out ${
                            openMenuSourceKey === sourceKey(source)
                              ? "pointer-events-none translate-x-1 opacity-0"
                              : "opacity-100 group-hover/source:pointer-events-none group-hover/source:translate-x-1 group-hover/source:opacity-0"
                          }`}
                        >
                          <span className={sourceUnreadCount(source) > 0 ? "text-[#8b5cf6] font-medium" : "text-[#52525b]"}>
                            {fmt(sourceUnreadCount(source))}
                          </span>
                          <span className="text-[#3f3f46]">/</span>
                          <span className="text-[#52525b]">{fmt(sourceTotalCount(source))}</span>
                        </span>
                      )}
                      {canShowSourceMenu(source) ? (
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
                          className={`absolute inset-y-0 right-0 flex items-center p-1 rounded-md transition-all duration-200 ease-in-out hover:text-white hover:bg-white/10 ${
                            openMenuSourceKey === sourceKey(source)
                              ? "translate-x-0 bg-white/10 text-white opacity-100"
                              : "pointer-events-none translate-x-[-4px] text-[#71717a] opacity-0 group-hover/source:pointer-events-auto group-hover/source:translate-x-0 group-hover/source:opacity-100"
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
              ))}
            </ul>
          </SidebarSection>

          {/* Library */}
          <SidebarSection title="Library">
            <ul className="space-y-1">
              <li>
                <button
                  onClick={() => showFeed({ savedOnly: true })}
                  className={`
                    w-full flex items-center gap-3 px-3 py-1.5 rounded-lg
                    text-left text-sm transition-all border
                    ${
                      isFeedView && activeFilter.savedOnly
                        ? "bg-[#8b5cf6]/20 text-white border-[#8b5cf6]/30"
                        : "border-transparent text-[#a1a1aa] hover:bg-white/5 hover:text-white"
                    }
                  `}
                >
                  <span className="w-5 flex items-center justify-center"><BookmarkIcon /></span>
                  <span className="flex-1">Saved</span>
                  {savedCount > 0 && (
                    <span className="text-[10px] tabular-nums text-[#52525b]">{fmt(savedCount)}</span>
                  )}
                </button>
              </li>
              <li>
                <button
                  onClick={() => showFeed({ archivedOnly: true })}
                  className={`
                    w-full flex items-center gap-3 px-3 py-1.5 rounded-lg
                    text-left text-sm transition-all border
                    ${
                      isFeedView && activeFilter.archivedOnly
                        ? "bg-[#8b5cf6]/20 text-white border-[#8b5cf6]/30"
                        : "border-transparent text-[#a1a1aa] hover:bg-white/5 hover:text-white"
                    }
                  `}
                >
                  <span className="w-5 flex items-center justify-center"><ArchiveIcon /></span>
                  <span className="flex-1">Archived</span>
                  {archivedCount > 0 && (
                    <span className="text-[10px] tabular-nums text-[#52525b]">{fmt(archivedCount)}</span>
                  )}
                </button>
              </li>
            </ul>

          </SidebarSection>

          {/* Tags */}
          {topLevelTags.length > 0 && (
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

          {/* Feeds */}
          {feedList.length > 0 && (
            <SidebarSection title="Feeds" defaultOpen={false} count={feedList.length}>
              <ul className="space-y-0.5 overflow-y-auto max-h-[40vh] -mr-4 pr-1">
                {feedList.map((feed) => {
                  const unread = feedUnreadCounts[feed.url] ?? 0;
                  const total = feedTotalCounts[feed.url] ?? 0;
                  const isActive = isFeedView && activeFilter.feedUrl === feed.url;
                  const menuOpen = openMenuFeedUrl === feed.url;
                  return (
                    <li
                      key={feed.url}
                      className={`group/feed flex items-stretch gap-2 rounded-lg border transition-all ${
                        isActive
                          ? "bg-[#8b5cf6]/20 border-[#8b5cf6]/30 text-white"
                          : "border-transparent text-[#a1a1aa] hover:bg-white/5 hover:text-white"
                      }`}
                    >
                      <button
                        onClick={() => handleFeedClick(feed.url)}
                        className="flex-1 flex items-center gap-2 pl-3 py-2 min-w-0 text-left"
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
                          <RssIcon className="w-4 h-4 shrink-0 text-[#52525b]" />
                        )}
                        <span className="flex-1 truncate text-xs">{feed.title}</span>
                      </button>

                      <div className="shrink-0 flex items-center pr-2">
                        {total > 0 && (
                          <span className={`${menuOpen ? "hidden" : "flex group-hover/feed:hidden"} items-center gap-0.5 text-[10px] tabular-nums`}>
                            <span className={unread > 0 ? "text-[#8b5cf6] font-medium" : "text-[#52525b]"}>
                              {fmt(unread)}
                            </span>
                            <span className="text-[#3f3f46]">/</span>
                            <span className="text-[#52525b]">{fmt(total)}</span>
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
                          className={`${menuOpen ? "flex bg-white/10 text-white" : "hidden group-hover/feed:flex text-[#71717a]"} items-center p-1 rounded-md hover:text-white hover:bg-white/10 transition-colors`}
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
            </SidebarSection>
          )}

          {/* Settings — pushed to bottom */}
          <div className="mt-auto shrink-0">
            <button
              onClick={openSettings}
              className="w-full flex items-center gap-3 px-3 py-1.5 rounded-lg text-left text-sm text-[#a1a1aa] hover:bg-white/5 hover:text-white transition-all"
            >
              <span className="w-5 text-center">
                <svg className="w-4 h-4 inline" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </span>
              <span>Settings</span>
            </button>
          </div>
        </nav>

        {/* Resize handle — desktop only */}
        <div
          className="hidden md:block absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-[#8b5cf6]/30 active:bg-[#8b5cf6]/50 transition-colors z-10"
          onMouseDown={handleDragStart}
        />
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
                  onClose();
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
              ? "bg-[#8b5cf6]/20 text-[#8b5cf6]"
              : "text-[#a1a1aa] hover:bg-white/5 hover:text-white"
          }`}
        >
          <svg className="w-3 h-3 shrink-0 text-[#52525b]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
          </svg>
          <span className="truncate">{label}</span>
        </button>
        {hasChildren && (
          <button
            onClick={() => setOpen((v) => !v)}
            className="p-1 rounded text-[#52525b] hover:text-[#a1a1aa] transition-colors"
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
        <ul className="ml-4 mt-0.5 space-y-0.5 border-l border-[rgba(255,255,255,0.06)] pl-2">
          {children}
        </ul>
      )}
    </li>
  );
}
