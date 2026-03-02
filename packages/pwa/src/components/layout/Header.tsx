import { useState, useMemo } from "react";
import { AddFeedDialog } from "../AddFeedDialog";
import { useAppStore, usePlatform } from "../../context/PlatformContext";

interface HeaderProps {
  onMenuClick: () => void;
}

export function Header({ onMenuClick }: HeaderProps) {
  const { HeaderSyncIndicator } = usePlatform();
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
      <header className="flex-shrink-0 h-14 flex items-center px-4 border-b border-[rgba(255,255,255,0.08)] bg-[#0a0a0a]/90 backdrop-blur-xl z-30 pt-[env(safe-area-inset-top)]">
        {/* Mobile menu button */}
        <button
          onClick={onMenuClick}
          className="md:hidden p-2 -ml-2 rounded-lg hover:bg-white/10 transition-colors"
          aria-label="Open menu"
        >
          <svg
            className="w-6 h-6"
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

        {/* Logo — hidden on mobile (shown in sidebar) */}
        <div className="hidden md:flex items-center gap-2">
          <span className="text-xl font-bold gradient-text">FREED</span>
        </div>

        {/* Mobile title */}
        <div className="md:hidden flex-1 text-center">
          <span className="text-lg font-semibold">Feed</span>
        </div>

        {/* Spacer — push actions to the right on desktop */}
        <div className="hidden md:block flex-1" />

        {/* Unread count (mobile) */}
        {unreadCount > 0 && (
          <div className="md:hidden flex items-center gap-1">
            <span className="text-xs text-[#71717a] tabular-nums">
              {unreadCount}
            </span>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-1 sm:gap-2">
          {/* Platform-specific sync indicator (PWA: sync panel, Desktop: refresh + dot) */}
          {HeaderSyncIndicator && <HeaderSyncIndicator />}

          {/* Mark all read — only shown when there are unread items */}
          {unreadCount > 0 && (
            <button
              onClick={() => markAllAsRead(activeFilter.platform)}
              title={`Mark all ${unreadCount} items as read`}
              className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-[#71717a] hover:bg-white/5 hover:text-white transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>{unreadCount} unread</span>
            </button>
          )}

          {/* Add feed button */}
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
      </header>

      <AddFeedDialog open={addFeedOpen} onClose={() => setAddFeedOpen(false)} />
    </>
  );
}
