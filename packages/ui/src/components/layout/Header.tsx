import { useState, useEffect, useRef } from "react";
import { AddFeedDialog } from "../AddFeedDialog.js";
import { SavedContentDialog } from "../SavedContentDialog.js";
import { Tooltip } from "../Tooltip.js";
import {
  useAppStore,
  usePlatform,
  MACOS_TRAFFIC_LIGHT_INSET,
} from "../../context/PlatformContext.js";

interface HeaderProps {
  onMenuClick: () => void;
}

const noDrag = { WebkitAppRegion: "no-drag" } as React.CSSProperties;
const dragStyle = { WebkitAppRegion: "drag" } as React.CSSProperties;

// ── Component ─────────────────────────────────────────────────────────────────

export function Header({ onMenuClick }: HeaderProps) {
  const {
    HeaderSyncIndicator,
    headerDragRegion,
    addRssFeed,
    saveUrl,
    importMarkdown,
    exportMarkdown,
  } = usePlatform();

  const canAddRss = !!addRssFeed;
  const canSaveContent = !!(saveUrl || importMarkdown || exportMarkdown);
  const showNewButton = canAddRss || canSaveContent;

  const markAllAsRead = useAppStore((s) => s.markAllAsRead);
  const archiveAllReadUnsaved = useAppStore((s) => s.archiveAllReadUnsaved);
  const activeFilter = useAppStore((s) => s.activeFilter);
  const totalUnreadCount = useAppStore((s) => s.totalUnreadCount);
  const unreadCountByPlatform = useAppStore((s) => s.unreadCountByPlatform);
  const totalArchivableCount = useAppStore((s) => s.totalArchivableCount);
  const archivableCountByPlatform = useAppStore(
    (s) => s.archivableCountByPlatform,
  );
  const archivableFeedCounts = useAppStore((s) => s.archivableFeedCounts);

  // Derive display count from pre-computed store values — no items iteration.
  // savedOnly and archivedOnly views don't show these actions.
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

  // ── + New dropdown ─────────────────────────────────────────────────────────

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

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      <header
        className={`theme-topbar sticky top-0 z-30 flex-shrink-0 border-b ${
          headerDragRegion ? "" : "pt-[env(safe-area-inset-top)]"
        } px-1`}
        {...(headerDragRegion
          ? {
              "data-tauri-drag-region": true,
              style: { WebkitAppRegion: "drag" } as React.CSSProperties,
            }
          : {})}
      >
        <div
          className="h-[55px] flex items-center pl-3 pr-1 gap-6"
          style={
            headerDragRegion
              ? ({
                  paddingLeft: MACOS_TRAFFIC_LIGHT_INSET,
                  WebkitAppRegion: "drag",
                } as React.CSSProperties)
              : undefined
          }
          {...(headerDragRegion ? { "data-tauri-drag-region": true } : {})}
        >
          {/* Mobile menu button */}
          <Tooltip label="Menu" className="md:hidden">
            <button
              onClick={onMenuClick}
              className="flex-shrink-0 rounded-lg p-1.5 transition-colors hover:bg-[var(--theme-bg-muted)]"
              aria-label="Open menu"
              style={headerDragRegion ? noDrag : undefined}
            >
              <svg
                className="w-5 h-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 6h16M4 12h16M4 18h16"
                />
              </svg>
            </button>
          </Tooltip>

          {/* FREED logo */}
          <div
            className="flex items-center flex-shrink-0"
            style={headerDragRegion ? noDrag : undefined}
          >
            <span className="text-lg font-bold gradient-text font-logo">
              FREED
            </span>
          </div>

          {/* Spacer — search/jump now lives in the sidebar */}
          <div
            className="flex flex-1 items-center justify-center min-w-0 ml-2"
            {...(headerDragRegion
              ? { "data-tauri-drag-region": true, style: dragStyle }
              : {})}
          />

          {/* Actions */}
          <div
            className="flex items-center gap-2 flex-shrink-0 ml-[-6px]"
            style={headerDragRegion ? noDrag : undefined}
          >
            {HeaderSyncIndicator && <HeaderSyncIndicator />}

            {unreadCount > 0 && (
              <Tooltip label={`Mark all ${unreadCount.toLocaleString()} items as read`} className="hidden sm:flex">
                <button
                  onClick={() => markAllAsRead(activeFilter.platform)}
                  className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-[var(--theme-text-muted)] transition-colors hover:bg-[var(--theme-bg-muted)] hover:text-[var(--theme-text-primary)]"
                >
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  <span>{unreadCount.toLocaleString()} unread</span>
                </button>
              </Tooltip>
            )}

            {archivableCount > 0 && (
              <Tooltip label={`Archive all ${archivableCount.toLocaleString()} read items`} className="hidden sm:flex">
                <button
                  onClick={() =>
                    archiveAllReadUnsaved(
                      activeFilter.platform,
                      activeFilter.feedUrl,
                    )
                  }
                  className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-[var(--theme-text-muted)] transition-colors hover:bg-[var(--theme-bg-muted)] hover:text-[var(--theme-text-primary)]"
                >
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                  <span>{archivableCount.toLocaleString()} read</span>
                </button>
              </Tooltip>
            )}

            {/* + New dropdown */}
            {showNewButton && (
              <div ref={dropdownRef} className="relative">
                <Tooltip label="Add new content">
                  <button
                    onClick={() => setDropdownOpen((v) => !v)}
                    className="theme-accent-button flex items-center gap-2 rounded-lg px-3 py-1.5 transition-colors"
                    aria-haspopup="true"
                    aria-expanded={dropdownOpen}
                  >
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 4v16m8-8H4"
                      />
                    </svg>
                    <span className="text-sm font-medium hidden sm:inline">
                      New
                    </span>
                    <svg
                      className={`w-3 h-3 transition-transform hidden sm:block ${dropdownOpen ? "rotate-180" : ""}`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M19 9l-7 7-7-7"
                      />
                    </svg>
                  </button>
                </Tooltip>

                {dropdownOpen && (
                  <div className="absolute right-0 top-full z-50 mt-1.5 w-44 overflow-hidden rounded-xl border border-[var(--theme-border-subtle)] bg-[color:color-mix(in_oklab,var(--theme-bg-surface)_95%,transparent)] py-1 shadow-2xl shadow-black/40">
                    {canAddRss && (
                      <button
                        onClick={() => {
                          setDropdownOpen(false);
                          setAddFeedOpen(true);
                        }}
                        className="w-full text-left flex items-center gap-2.5 px-3 py-2.5 text-sm text-[var(--theme-text-secondary)] transition-colors hover:bg-[var(--theme-bg-muted)] hover:text-[var(--theme-text-primary)]"
                      >
                        <svg
                          className="theme-icon-action w-4 h-4 shrink-0"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M6 5c7.18 0 13 5.82 13 13M6 11a7 7 0 017 7M6 17a1 1 0 110 2 1 1 0 010-2z"
                          />
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
                        <svg
                          className="theme-icon-action w-4 h-4 shrink-0"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"
                          />
                        </svg>
                        Saved Content
                      </button>
                    )}
                  </div>
                )}
              </div>
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
