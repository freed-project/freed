import { useEffect, useRef, useState } from "react";
import { AddFeedDialog } from "../AddFeedDialog.js";
import { SavedContentDialog } from "../SavedContentDialog.js";
import { useAppStore, usePlatform, MACOS_TRAFFIC_LIGHT_INSET } from "../../context/PlatformContext.js";

interface HeaderProps {
  onMenuClick: () => void;
}

const noDrag = { WebkitAppRegion: "no-drag" } as React.CSSProperties;

export function Header({ onMenuClick }: HeaderProps) {
  const { HeaderSyncIndicator, headerDragRegion, addRssFeed, saveUrl, importMarkdown, exportMarkdown } =
    usePlatform();

  const canAddRss = !!addRssFeed;
  const canSaveContent = !!(saveUrl || importMarkdown || exportMarkdown);
  const showNewButton = canAddRss || canSaveContent;

  const markAllAsRead = useAppStore((s) => s.markAllAsRead);
  const activeFilter = useAppStore((s) => s.activeFilter);
  const totalUnreadCount = useAppStore((s) => s.totalUnreadCount);
  const unreadCountByPlatform = useAppStore((s) => s.unreadCountByPlatform);

  const unreadCount = activeFilter.savedOnly
    ? 0
    : activeFilter.platform
      ? (unreadCountByPlatform[activeFilter.platform] ?? 0)
      : totalUnreadCount;

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [addFeedOpen, setAddFeedOpen] = useState(false);
  const [savedContentOpen, setSavedContentOpen] = useState(false);

  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click or Escape
  useEffect(() => {
    if (!dropdownOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
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
          className="h-[55px] flex items-center pl-4 pr-2"
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
            className="md:hidden p-2 -ml-2 rounded-lg hover:bg-white/10 transition-colors"
            aria-label="Open menu"
            style={headerDragRegion ? noDrag : undefined}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>

          {/* FREED logo */}
          <div
            className="flex items-center gap-1 ml-1 md:ml-0"
            style={headerDragRegion ? noDrag : undefined}
          >
            <span className="text-lg font-bold gradient-text font-logo">FREED</span>
          </div>

          {/* Spacer — explicitly draggable */}
          <div
            className="flex-1 self-stretch"
            {...(headerDragRegion
              ? { "data-tauri-drag-region": true, style: { WebkitAppRegion: "drag" } as React.CSSProperties }
              : {})}
          />

          {/* Actions */}
          <div
            className="flex items-center gap-1 sm:gap-2"
            style={headerDragRegion ? noDrag : undefined}
          >
            {HeaderSyncIndicator && <HeaderSyncIndicator />}

            {unreadCount > 0 && (
              <button
                onClick={() => markAllAsRead(activeFilter.platform)}
                title={`Mark all ${unreadCount} items as read`}
                className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-[#71717a] hover:bg-white/5 hover:text-white transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>{unreadCount.toLocaleString()} unread</span>
              </button>
            )}

            {/* + New dropdown */}
            {showNewButton && (
              <div ref={dropdownRef} className="relative">
                <button
                  onClick={() => setDropdownOpen((v) => !v)}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#8b5cf6]/20 text-[#8b5cf6] hover:bg-[#8b5cf6]/30 transition-colors"
                  aria-haspopup="true"
                  aria-expanded={dropdownOpen}
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  <span className="text-sm font-medium hidden sm:inline">New</span>
                  <svg
                    className={`w-3 h-3 transition-transform hidden sm:block ${dropdownOpen ? "rotate-180" : ""}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {dropdownOpen && (
                  <div className="absolute right-0 top-full mt-1.5 w-44 bg-[#161616] border border-[rgba(255,255,255,0.1)] rounded-xl shadow-2xl shadow-black/70 overflow-hidden z-50 py-1">
                    {canAddRss && (
                      <button
                        onClick={() => { setDropdownOpen(false); setAddFeedOpen(true); }}
                        className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-[#a1a1aa] hover:bg-white/5 hover:text-white transition-colors text-left"
                      >
                        <svg className="w-4 h-4 text-orange-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 5c7.18 0 13 5.82 13 13M6 11a7 7 0 017 7M6 17a1 1 0 110 2 1 1 0 010-2z" />
                        </svg>
                        RSS Feed
                      </button>
                    )}
                    {canSaveContent && (
                      <button
                        onClick={() => { setDropdownOpen(false); setSavedContentOpen(true); }}
                        className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-[#a1a1aa] hover:bg-white/5 hover:text-white transition-colors text-left"
                      >
                        <svg className="w-4 h-4 text-[#8b5cf6] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
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
      <SavedContentDialog open={savedContentOpen} onClose={() => setSavedContentOpen(false)} />
    </>
  );
}
