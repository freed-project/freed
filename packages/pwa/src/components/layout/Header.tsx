import { useState, useMemo } from "react";
import { AddFeedDialog } from "../AddFeedDialog";
import { useAppStore, usePlatform } from "../../context/PlatformContext";

interface HeaderProps {
  onMenuClick: () => void;
}

const noDrag = { WebkitAppRegion: "no-drag" } as React.CSSProperties;

export function Header({ onMenuClick }: HeaderProps) {
  const { HeaderSyncIndicator, headerDragRegion } = usePlatform();
  const [addFeedOpen, setAddFeedOpen] = useState(false);
  const items = useAppStore((s) => s.items);
  const markAllAsRead = useAppStore((s) => s.markAllAsRead);
  const activeFilter = useAppStore((s) => s.activeFilter);

  const unreadCount = useMemo(
    () =>
      items.filter(
        (item) =>
          !item.userState.readAt &&
          !item.userState.hidden &&
          !item.userState.archived &&
          (!activeFilter.platform || item.platform === activeFilter.platform) &&
          (!activeFilter.savedOnly || item.userState.saved),
      ).length,
    [items, activeFilter],
  );

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
          className={`h-12 flex items-center pl-4 pr-2 ${
            headerDragRegion ? "pl-[72px]" : ""
          }`}
        >
          {/* Mobile menu button */}
          <button
            onClick={onMenuClick}
            className="md:hidden p-2 -ml-2 rounded-lg hover:bg-white/10 transition-colors"
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

          {/* FREED logo */}
          <div
            className="flex items-center gap-1 ml-1 md:ml-0"
            style={headerDragRegion ? noDrag : undefined}
          >
            <span className="text-lg font-bold gradient-text font-logo">FREED</span>
          </div>

          {/* Spacer */}
          <div className="flex-1" />

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
                <span>{unreadCount} unread</span>
              </button>
            )}

            <button
              onClick={() => setAddFeedOpen(true)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#8b5cf6]/20 text-[#8b5cf6] hover:bg-[#8b5cf6]/30 transition-colors"
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
                Add Feed
              </span>
            </button>
          </div>
        </div>
      </header>

      <AddFeedDialog open={addFeedOpen} onClose={() => setAddFeedOpen(false)} />
    </>
  );
}
