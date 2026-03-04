import { useState, useEffect, useRef } from "react";
import { AddFeedDialog } from "../AddFeedDialog.js";
import { useAppStore, usePlatform, MACOS_TRAFFIC_LIGHT_INSET } from "../../context/PlatformContext.js";

interface HeaderProps {
  onMenuClick: () => void;
}

const noDrag = { WebkitAppRegion: "no-drag" } as React.CSSProperties;
const dragStyle = { WebkitAppRegion: "drag" } as React.CSSProperties;

export function Header({ onMenuClick }: HeaderProps) {
  const { HeaderSyncIndicator, headerDragRegion, addRssFeed } = usePlatform();
  const canAddFeeds = !!addRssFeed;
  const [addFeedOpen, setAddFeedOpen] = useState(false);
  const markAllAsRead = useAppStore((s) => s.markAllAsRead);
  const archiveAllReadUnsaved = useAppStore((s) => s.archiveAllReadUnsaved);
  const activeFilter = useAppStore((s) => s.activeFilter);
  const totalUnreadCount = useAppStore((s) => s.totalUnreadCount);
  const unreadCountByPlatform = useAppStore((s) => s.unreadCountByPlatform);
  const totalArchivableCount = useAppStore((s) => s.totalArchivableCount);
  const archivableCountByPlatform = useAppStore((s) => s.archivableCountByPlatform);
  const archivableFeedCounts = useAppStore((s) => s.archivableFeedCounts);
  const setSearchQuery = useAppStore((s) => s.setSearchQuery);

  // inputValue drives the visible input; searchQuery in the store is debounced
  // so MiniSearch isn't invoked on every keystroke.
  const [inputValue, setInputValue] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    debounceRef.current = setTimeout(() => {
      setSearchQuery(inputValue);
    }, 150);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [inputValue, setSearchQuery]);

  function clearSearch() {
    setInputValue("");
    setSearchQuery("");
  }

  // Derive display count from pre-computed store values — no items iteration.
  // savedOnly and archivedOnly views don't show these actions.
  const unreadCount = (activeFilter.savedOnly || activeFilter.archivedOnly)
    ? 0
    : activeFilter.platform
      ? (unreadCountByPlatform[activeFilter.platform] ?? 0)
      : totalUnreadCount;

  const archivableCount = (activeFilter.savedOnly || activeFilter.archivedOnly)
    ? 0
    : activeFilter.feedUrl
      ? (archivableFeedCounts[activeFilter.feedUrl] ?? 0)
      : activeFilter.platform
        ? (archivableCountByPlatform[activeFilter.platform] ?? 0)
        : totalArchivableCount;

  return (
    <>
      <header
        className={`flex-shrink-0 bg-[#0a0a0a]/90 backdrop-blur-xl z-30 border-b border-[rgba(255,255,255,0.08)] ${
          headerDragRegion ? "" : "pt-[env(safe-area-inset-top)]"
        }`}
        {...(headerDragRegion
          ? {
              "data-tauri-drag-region": true,
              style: { WebkitAppRegion: "drag" } as React.CSSProperties,
            }
          : {})}
      >
        <div
          className="h-[55px] flex items-center pl-4 pr-2 gap-2"
          style={
            headerDragRegion
              ? ({ paddingLeft: MACOS_TRAFFIC_LIGHT_INSET, WebkitAppRegion: "drag" } as React.CSSProperties)
              : undefined
          }
          {...(headerDragRegion ? { "data-tauri-drag-region": true } : {})}
        >
          {/* Mobile menu button */}
          <button
            onClick={onMenuClick}
            className="md:hidden p-2 -ml-2 rounded-lg hover:bg-white/10 transition-colors flex-shrink-0"
            aria-label="Open menu"
            style={headerDragRegion ? noDrag : undefined}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>

          {/* FREED logo */}
          <div
            className="flex items-center gap-1 ml-1 md:ml-0 flex-shrink-0"
            style={headerDragRegion ? noDrag : undefined}
          >
            <span className="text-lg font-bold gradient-text font-logo">FREED</span>
          </div>

          {/* Search bar — takes the center space; outer div stays draggable on desktop */}
          <div
            className="flex-1 flex items-center justify-center min-w-0"
            {...(headerDragRegion ? { "data-tauri-drag-region": true, style: dragStyle } : {})}
          >
            <div
              className="relative w-full max-w-sm"
              style={headerDragRegion ? noDrag : undefined}
            >
              {/* Search icon */}
              <svg
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#71717a]"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>

              <input
                type="search"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    clearSearch();
                    e.currentTarget.blur();
                  }
                }}
                placeholder="Search..."
                aria-label="Search all sources"
                className="w-full bg-white/5 border border-white/10 rounded-lg pl-8 pr-7 py-1.5 text-sm text-white/80 placeholder-[#52525b] focus:outline-none focus:border-white/20 focus:bg-white/[0.08] transition-colors"
              />

              {/* Clear button — only visible when there's input */}
              {inputValue && (
                <button
                  onClick={clearSearch}
                  aria-label="Clear search"
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-white/10 transition-colors"
                >
                  <svg className="w-3 h-3 text-[#71717a]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          </div>

          {/* Actions */}
          <div
            className="flex items-center gap-1 sm:gap-2 flex-shrink-0"
            style={headerDragRegion ? noDrag : undefined}
          >
            {HeaderSyncIndicator && <HeaderSyncIndicator />}

            {unreadCount > 0 && (
              <button
                onClick={() => markAllAsRead(activeFilter.platform)}
                title={`Mark all ${unreadCount.toLocaleString()} items as read`}
                className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-[#71717a] hover:bg-white/5 hover:text-white transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>{unreadCount.toLocaleString()} unread</span>
              </button>
            )}

            {archivableCount > 0 && (
              <button
                onClick={() => archiveAllReadUnsaved(activeFilter.platform, activeFilter.feedUrl)}
                title={`Archive all ${archivableCount.toLocaleString()} read items`}
                className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-[#71717a] hover:bg-white/5 hover:text-white transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span>{archivableCount.toLocaleString()} read</span>
              </button>
            )}

            {canAddFeeds && (
              <button
                onClick={() => setAddFeedOpen(true)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#8b5cf6]/20 text-[#8b5cf6] hover:bg-[#8b5cf6]/30 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                <span className="text-sm font-medium hidden sm:inline">Add Feed</span>
              </button>
            )}
          </div>
        </div>
      </header>

      <AddFeedDialog open={addFeedOpen} onClose={() => setAddFeedOpen(false)} />
    </>
  );
}
