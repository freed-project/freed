import { useEffect, useRef, useState } from "react";
import { AddFeedDialog } from "../AddFeedDialog";
import { toast } from "../Toast";
import { useAppStore } from "../../lib/store";

interface HeaderProps {
  onMenuClick: () => void;
}

export function Header({ onMenuClick }: HeaderProps) {
  const [addFeedOpen, setAddFeedOpen] = useState(false);
  const [syncPanelOpen, setSyncPanelOpen] = useState(false);
  const isSyncing = useAppStore((s) => s.isSyncing);
  const syncConnected = useAppStore((s) => s.syncConnected);
  const feeds = useAppStore((s) => s.feeds);
  const feedList = Object.values(feeds);
  const feedCount = feedList.length;
  const syncPanelRef = useRef<HTMLDivElement>(null);

  // Close sync panel on outside click
  useEffect(() => {
    if (!syncPanelOpen) return;
    const handler = (e: MouseEvent) => {
      if (
        syncPanelRef.current &&
        !syncPanelRef.current.contains(e.target as Node)
      ) {
        setSyncPanelOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [syncPanelOpen]);

  const handleRefresh = () => {
    setSyncPanelOpen(false);
    toast.info("Open the desktop app to refresh feeds");
  };

  const statusLabel = isSyncing
    ? "Syncing"
    : syncConnected
      ? "Synced"
      : feedCount > 0
        ? "Local"
        : "Ready";

  const statusColor = isSyncing
    ? "text-[#8b5cf6]"
    : syncConnected
      ? "text-green-400"
      : "text-[#71717a]";

  return (
    <>
      <header className="h-14 flex items-center px-4 border-b border-[rgba(255,255,255,0.08)] bg-[#0a0a0a]/90 backdrop-blur-xl sticky top-0 z-30">
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

        {/* Actions */}
        <div className="flex items-center gap-1 sm:gap-2">
          {/* Sync status button + floating panel */}
          <div className="relative" ref={syncPanelRef}>
            <button
              onClick={() => setSyncPanelOpen((prev) => !prev)}
              className={`
                hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors
                hover:bg-white/5 ${statusColor}
              `}
            >
              <span>{statusLabel}</span>
              <svg
                className={`w-4 h-4 ${isSyncing ? "animate-spin" : ""}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
            </button>

            {/* Mobile-only: just the spinner icon */}
            <button
              onClick={() => setSyncPanelOpen((prev) => !prev)}
              className={`sm:hidden p-2 rounded-lg transition-colors hover:bg-white/5 ${statusColor}`}
            >
              <svg
                className={`w-5 h-5 ${isSyncing ? "animate-spin" : ""}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
            </button>

            {/* Floating sync panel */}
            {syncPanelOpen && (
              <div className="absolute right-0 top-full mt-2 w-72 bg-[#1a1a1a] border border-[rgba(255,255,255,0.08)] rounded-xl shadow-2xl z-50 overflow-hidden">
                {/* Header */}
                <div className="px-4 py-3 border-b border-[rgba(255,255,255,0.06)]">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-white">
                      Sync Status
                    </span>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full ${
                        isSyncing
                          ? "bg-[#8b5cf6]/20 text-[#8b5cf6]"
                          : syncConnected
                            ? "bg-green-500/20 text-green-400"
                            : "bg-white/5 text-[#71717a]"
                      }`}
                    >
                      {statusLabel}
                    </span>
                  </div>
                </div>

                {/* Feed list */}
                {feedCount > 0 ? (
                  <div className="max-h-48 overflow-y-auto">
                    {feedList.map((feed) => (
                      <div
                        key={feed.url}
                        className="flex items-center gap-2 px-4 py-2 border-b border-[rgba(255,255,255,0.04)] last:border-0"
                      >
                        {isSyncing ? (
                          <svg
                            className="w-3.5 h-3.5 text-[#8b5cf6] animate-spin flex-shrink-0"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                            />
                          </svg>
                        ) : (
                          <span className="w-1.5 h-1.5 rounded-full bg-green-400 flex-shrink-0" />
                        )}
                        <span className="text-xs text-[#a1a1aa] truncate">
                          {feed.title}
                        </span>
                        {feed.lastFetched && !isSyncing && (
                          <span className="ml-auto text-[10px] text-[#52525b] flex-shrink-0 tabular-nums">
                            {formatRelativeTime(feed.lastFetched)}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="px-4 py-6 text-center">
                    <p className="text-xs text-[#71717a]">
                      No feeds subscribed yet.
                    </p>
                  </div>
                )}

                {/* Footer action */}
                {feedCount > 0 && (
                  <div className="px-4 py-2.5 border-t border-[rgba(255,255,255,0.06)]">
                    <button
                      onClick={handleRefresh}
                      disabled={isSyncing}
                      className="w-full text-xs text-[#8b5cf6] hover:text-[#a78bfa] disabled:text-[#52525b] disabled:cursor-not-allowed transition-colors text-center py-1"
                    >
                      {isSyncing
                        ? "Syncing with desktop..."
                        : "Refresh via desktop app"}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

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

/** Format a timestamp as relative time (e.g. "2m ago", "3h ago") */
function formatRelativeTime(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
