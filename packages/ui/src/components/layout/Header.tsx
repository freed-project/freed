import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { countFriendsWithRecentLocationUpdates } from "@freed/shared";
import { AddFeedDialog } from "../AddFeedDialog.js";
import { SavedContentDialog } from "../SavedContentDialog.js";
import { Tooltip } from "../Tooltip.js";
import { useSearchResults } from "../../hooks/useSearchResults.js";
import { useIsMobile } from "../../hooks/useIsMobile.js";
import {
  useAppStore,
  usePlatform,
  MACOS_TRAFFIC_LIGHT_INSET,
} from "../../context/PlatformContext.js";
import { getFilterLabel } from "../../lib/feed-view-labels.js";

interface HeaderProps {
  onMenuClick: () => void;
  sidebarExpanded: boolean;
  onSidebarToggle: () => void;
}

const noDrag = { WebkitAppRegion: "no-drag" } as React.CSSProperties;
const dragStyle = { WebkitAppRegion: "drag" } as React.CSSProperties;

function formatItemCount(count: number): string {
  return `${count.toLocaleString()} item${count === 1 ? "" : "s"}`;
}

export function Header({ onMenuClick, sidebarExpanded, onSidebarToggle }: HeaderProps) {
  const {
    HeaderSyncIndicator,
    headerDragRegion,
    addRssFeed,
    saveUrl,
    importMarkdown,
    exportMarkdown,
    openUrl,
  } = usePlatform();
  const isMobile = useIsMobile();

  const canAddRss = !!addRssFeed;
  const canSaveContent = !!(saveUrl || importMarkdown || exportMarkdown);
  const showNewButton = canAddRss || canSaveContent;

  const items = useAppStore((s) => s.items);
  const feeds = useAppStore((s) => s.feeds);
  const friends = useAppStore((s) => s.friends);
  const activeView = useAppStore((s) => s.activeView);
  const activeFilter = useAppStore((s) => s.activeFilter);
  const searchQuery = useAppStore((s) => s.searchQuery);
  const selectedItemId = useAppStore((s) => s.selectedItemId);
  const totalUnreadCount = useAppStore((s) => s.totalUnreadCount);
  const unreadCountByPlatform = useAppStore((s) => s.unreadCountByPlatform);
  const totalArchivableCount = useAppStore((s) => s.totalArchivableCount);
  const archivableCountByPlatform = useAppStore((s) => s.archivableCountByPlatform);
  const archivableFeedCounts = useAppStore((s) => s.archivableFeedCounts);
  const pendingMatchCount = useAppStore((s) => s.pendingMatchCount);
  const markAllAsRead = useAppStore((s) => s.markAllAsRead);
  const archiveAllReadUnsaved = useAppStore((s) => s.archiveAllReadUnsaved);
  const toggleSaved = useAppStore((s) => s.toggleSaved);
  const toggleArchived = useAppStore((s) => s.toggleArchived);
  const updatePreferences = useAppStore((s) => s.updatePreferences);
  const setSelectedItem = useAppStore((s) => s.setSelectedItem);
  const display = useAppStore((s) => s.preferences.display);

  const { filteredItems, isSearching, resultCount } = useSearchResults(items, searchQuery, activeFilter);
  const selectedItem = useMemo(
    () => (selectedItemId ? items.find((item) => item.globalId === selectedItemId) ?? null : null),
    [items, selectedItemId],
  );

  const scopeLabel = useMemo(() => getFilterLabel(activeFilter, feeds), [activeFilter, feeds]);
  const friendCount = useMemo(() => Object.keys(friends).length, [friends]);
  const mappedFriendCount = useMemo(
    () => countFriendsWithRecentLocationUpdates(items, friends),
    [friends, items],
  );

  const unreadCount =
    activeFilter.savedOnly || activeFilter.archivedOnly
      ? 0
      : activeFilter.platform
        ? (unreadCountByPlatform[activeFilter.platform] ?? 0)
        : totalUnreadCount;

  const archivableCount =
    activeFilter.savedOnly || activeFilter.archivedOnly
      ? 0
      : activeFilter.feedUrl
        ? (archivableFeedCounts[activeFilter.feedUrl] ?? 0)
        : activeFilter.platform
          ? (archivableCountByPlatform[activeFilter.platform] ?? 0)
          : totalArchivableCount;

  const currentTitle = useMemo(() => {
    if (selectedItem) {
      return selectedItem.content.linkPreview?.title
        ?? selectedItem.content.text?.slice(0, 90)
        ?? selectedItem.author.displayName;
    }
    if (activeView === "friends") return "Friends";
    if (activeView === "map") return "Map";
    return scopeLabel;
  }, [activeView, scopeLabel, selectedItem]);

  const currentSubtitle = useMemo(() => {
    if (selectedItem) {
      const source = selectedItem.platform
        ? selectedItem.platform.toLocaleUpperCase()
        : scopeLabel;
      return `${selectedItem.author.displayName} • ${source}`;
    }
    if (activeView === "friends") {
      if (pendingMatchCount > 0) {
        return `${friendCount.toLocaleString()} friends • ${pendingMatchCount.toLocaleString()} pending matches`;
      }
      return `${friendCount.toLocaleString()} friends`;
    }
    if (activeView === "map") {
      return `${mappedFriendCount.toLocaleString()} friends on the map`;
    }
    if (isSearching) {
      return `${resultCount.toLocaleString()} result${resultCount === 1 ? "" : "s"} in ${scopeLabel}`;
    }
    return formatItemCount(filteredItems.length);
  }, [
    activeView,
    filteredItems.length,
    friendCount,
    isSearching,
    mappedFriendCount,
    pendingMatchCount,
    resultCount,
    scopeLabel,
    selectedItem,
  ]);

  const handleCloseReader = useCallback(() => {
    setSelectedItem(null);
  }, [setSelectedItem]);

  const handleToggleReaderSaved = useCallback(() => {
    if (!selectedItem) return;
    toggleSaved(selectedItem.globalId);
  }, [selectedItem, toggleSaved]);

  const handleToggleReaderArchived = useCallback(() => {
    if (!selectedItem) return;
    const wasArchived = selectedItem.userState.archived;
    toggleArchived(selectedItem.globalId);
    if (!wasArchived) {
      setSelectedItem(null);
    }
  }, [selectedItem, setSelectedItem, toggleArchived]);

  const handleToggleFocusMode = useCallback(() => {
    void updatePreferences({
      display: {
        ...display,
        reading: {
          ...display.reading,
          focusMode: !display.reading.focusMode,
        },
      },
    });
  }, [display.reading, updatePreferences]);

  const handleToggleDualColumn = useCallback(() => {
    void updatePreferences({
      display: {
        ...display,
        reading: {
          ...display.reading,
          dualColumnMode: !display.reading.dualColumnMode,
        },
      },
    });
  }, [display.reading, updatePreferences]);

  const handleOpenReaderUrl = useCallback(() => {
    if (!selectedItem?.sourceUrl) return;
    if (openUrl) {
      openUrl(selectedItem.sourceUrl);
      return;
    }
    window.open(selectedItem.sourceUrl, "_blank", "noopener,noreferrer");
  }, [openUrl, selectedItem]);

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [addFeedOpen, setAddFeedOpen] = useState(false);
  const [savedContentOpen, setSavedContentOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!dropdownOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setDropdownOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDropdownOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [dropdownOpen]);

  return (
    <>
      <header
        className={`sticky top-0 z-30 flex-shrink-0 px-3 pt-3 ${
          headerDragRegion ? "" : "pt-[calc(env(safe-area-inset-top)+0.75rem)]"
        }`}
      >
        <div
          data-testid="workspace-toolbar"
          className="theme-floating-panel flex min-h-[58px] items-center gap-3 px-3 sm:px-4"
          {...(headerDragRegion
            ? {
                "data-tauri-drag-region": true,
                style: dragStyle,
              }
            : {})}
        >
          <div
            className="flex shrink-0 items-center gap-2"
            style={headerDragRegion ? noDrag : undefined}
          >
            <Tooltip label="Menu" className="md:hidden">
              <button
                onClick={onMenuClick}
                className="rounded-lg p-1.5 transition-colors hover:bg-[var(--theme-bg-muted)]"
                aria-label="Open menu"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
            </Tooltip>

            <span className="text-lg font-bold gradient-text font-logo">FREED</span>

            <Tooltip label={sidebarExpanded ? "Collapse sidebar" : "Expand sidebar"} className="hidden md:flex">
              <button
                onClick={onSidebarToggle}
                data-testid="desktop-sidebar-toggle"
                className={`rounded-lg p-1.5 transition-colors ${
                  sidebarExpanded
                    ? "theme-accent-button"
                    : "theme-subtle-button hover:bg-[var(--theme-bg-muted)]"
                }`}
                aria-label={sidebarExpanded ? "Collapse sidebar" : "Expand sidebar"}
                aria-pressed={sidebarExpanded}
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h12a2 2 0 012 2v12a2 2 0 01-2 2H6a2 2 0 01-2-2V6z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 4v16" />
                </svg>
              </button>
            </Tooltip>
          </div>

          <div
            className="min-w-0 flex-1"
            {...(headerDragRegion ? { "data-tauri-drag-region": true, style: dragStyle } : {})}
          >
            {selectedItem ? (
              <button
                onClick={handleCloseReader}
                className="group flex min-w-0 items-center gap-2 rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-[var(--theme-bg-muted)]"
                style={headerDragRegion ? noDrag : undefined}
                aria-label="Back to list"
              >
                <svg
                  className="h-4 w-4 shrink-0 text-[var(--theme-text-muted)] transition-colors group-hover:text-[var(--theme-text-secondary)]"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-[var(--theme-text-primary)]">{currentTitle}</p>
                  <p className="truncate text-xs text-[var(--theme-text-muted)]">{currentSubtitle}</p>
                </div>
              </button>
            ) : (
              <div className="min-w-0 px-1">
                <p className="truncate text-sm font-semibold text-[var(--theme-text-primary)]">{currentTitle}</p>
                <p className="truncate text-xs text-[var(--theme-text-muted)]">{currentSubtitle}</p>
              </div>
            )}
          </div>

          <div
            className="flex shrink-0 items-center gap-2"
            style={headerDragRegion ? noDrag : undefined}
          >
            {selectedItem ? (
              <>
                <Tooltip label={display.reading.focusMode ? "Disable focus mode" : "Enable focus mode"}>
                  <button
                    onClick={handleToggleFocusMode}
                    className={`hidden rounded-lg px-2.5 py-2 text-sm font-bold transition-colors lg:inline-flex ${
                      display.reading.focusMode
                        ? "theme-accent-button"
                        : "theme-subtle-button hover:bg-[var(--theme-bg-muted)]"
                    }`}
                    aria-pressed={display.reading.focusMode}
                    aria-label="Toggle focus reading mode"
                  >
                    <span aria-hidden="true">
                      <span className="font-black">F</span>
                      <span className="text-xs font-light">ocus</span>
                    </span>
                  </button>
                </Tooltip>

                <Tooltip label={selectedItem.userState.saved ? "Remove bookmark" : "Bookmark"}>
                  <button
                    onClick={handleToggleReaderSaved}
                    className={`rounded-lg p-2 transition-colors ${
                      selectedItem.userState.saved
                        ? "theme-accent-button"
                        : "theme-subtle-button hover:bg-[var(--theme-bg-muted)]"
                    }`}
                    aria-label={selectedItem.userState.saved ? "Unsave" : "Save"}
                  >
                    <svg
                      className="h-5 w-5"
                      fill={selectedItem.userState.saved ? "currentColor" : "none"}
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                    </svg>
                  </button>
                </Tooltip>

                <Tooltip label={selectedItem.userState.archived ? "Unarchive" : "Archive"}>
                  <button
                    onClick={handleToggleReaderArchived}
                    className={`rounded-lg p-2 transition-colors ${
                      selectedItem.userState.archived
                        ? "theme-status-pill-success hover:bg-[rgb(var(--theme-feedback-success-rgb)/0.18)]"
                        : "theme-subtle-button hover:bg-[var(--theme-bg-muted)]"
                    }`}
                    aria-label={selectedItem.userState.archived ? "Unarchive" : "Archive"}
                  >
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 7h12m-1 0-.867 12.142A2 2 0 0114.138 21H9.862a2 2 0 01-1.995-1.858L7 7m5-3v3m-4 0V4m8 3V4" />
                    </svg>
                  </button>
                </Tooltip>

                {selectedItem.sourceUrl && (
                  <button
                    onClick={handleOpenReaderUrl}
                    className="theme-subtle-button inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm"
                    aria-label="Open"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5h5m0 0v5m0-5L10 14M5 9v10h10" />
                    </svg>
                    <span className="hidden lg:inline">Open</span>
                  </button>
                )}

                {!isMobile && (
                  <Tooltip label={display.reading.dualColumnMode ? "Single column" : "Dual column"}>
                    <button
                      onClick={handleToggleDualColumn}
                      className={`rounded-lg p-2 transition-colors ${
                        display.reading.dualColumnMode
                          ? "theme-accent-button"
                          : "theme-subtle-button hover:bg-[var(--theme-bg-muted)]"
                      }`}
                      aria-pressed={display.reading.dualColumnMode}
                      aria-label="Toggle dual column layout"
                    >
                      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 6a2 2 0 012-2h12a2 2 0 012 2v12a2 2 0 01-2 2H6a2 2 0 01-2-2V6z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 4v16" />
                      </svg>
                    </button>
                  </Tooltip>
                )}
              </>
            ) : (
              <>
                {HeaderSyncIndicator && (
                  <div className="hidden md:flex">
                    <HeaderSyncIndicator />
                  </div>
                )}

                {unreadCount > 0 && (
                  <Tooltip label={`Mark all ${unreadCount.toLocaleString()} items as read`} className="hidden lg:flex">
                    <button
                      onClick={() => markAllAsRead(activeFilter.platform)}
                      className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-[var(--theme-text-muted)] transition-colors hover:bg-[var(--theme-bg-muted)] hover:text-[var(--theme-text-primary)]"
                    >
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <span>{unreadCount.toLocaleString()} unread</span>
                    </button>
                  </Tooltip>
                )}

                {archivableCount > 0 && (
                  <Tooltip label={`Archive all ${archivableCount.toLocaleString()} read items`} className="hidden lg:flex">
                    <button
                      onClick={() => archiveAllReadUnsaved(activeFilter.platform, activeFilter.feedUrl)}
                      className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-[var(--theme-text-muted)] transition-colors hover:bg-[var(--theme-bg-muted)] hover:text-[var(--theme-text-primary)]"
                    >
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      <span>{archivableCount.toLocaleString()} read</span>
                    </button>
                  </Tooltip>
                )}

                {showNewButton && (
                  <div ref={dropdownRef} className="relative">
                    <Tooltip label="Add new content">
                      <button
                        onClick={() => setDropdownOpen((value) => !value)}
                        className="theme-accent-button flex items-center gap-2 rounded-lg px-3 py-1.5 transition-colors"
                        aria-haspopup="true"
                        aria-expanded={dropdownOpen}
                      >
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                        <span className="hidden text-sm font-medium sm:inline">New</span>
                        <svg
                          className={`hidden h-3 w-3 transition-transform sm:block ${dropdownOpen ? "rotate-180" : ""}`}
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                    </Tooltip>

                    {dropdownOpen && (
                      <div className="absolute right-0 top-full z-50 mt-1.5 w-44 overflow-hidden rounded-xl border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-elevated)] py-1 shadow-2xl shadow-black/40">
                        {canAddRss && (
                          <button
                            onClick={() => {
                              setDropdownOpen(false);
                              setAddFeedOpen(true);
                            }}
                            className="w-full text-left flex items-center gap-2.5 px-3 py-2.5 text-sm text-[var(--theme-text-secondary)] transition-colors hover:bg-[var(--theme-bg-muted)] hover:text-[var(--theme-text-primary)]"
                          >
                            <svg className="theme-icon-action h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 5c7.18 0 13 5.82 13 13M6 11a7 7 0 017 7M6 17a1 1 0 110 2 1 1 0 010-2z" />
                            </svg>
                            RSS Feed
                          </button>
                        )}
                        {canSaveContent && (
                          <button
                            onClick={() => {
                              setDropdownOpen(false);
                              setSavedContentOpen(true);
                            }}
                            className="w-full text-left flex items-center gap-2.5 px-3 py-2.5 text-sm text-[var(--theme-text-secondary)] transition-colors hover:bg-[var(--theme-bg-muted)] hover:text-[var(--theme-text-primary)]"
                          >
                            <svg className="theme-icon-action h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                            </svg>
                            Saved Content
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </header>

      <AddFeedDialog open={addFeedOpen} onClose={() => setAddFeedOpen(false)} />
      <SavedContentDialog
        open={savedContentOpen}
        onClose={() => setSavedContentOpen(false)}
      />
    </>
  );
}
