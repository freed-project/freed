import { useState } from "react";
import { AddFeedDialog } from "../AddFeedDialog";
import { refreshAllFeeds } from "../../lib/capture";
import { useAppStore } from "../../lib/store";

interface HeaderProps {
  onMenuClick: () => void;
}

export function Header({ onMenuClick }: HeaderProps) {
  const [addFeedOpen, setAddFeedOpen] = useState(false);
  const isSyncing = useAppStore((s) => s.isSyncing);
  const feeds = useAppStore((s) => s.feeds);
  const feedCount = Object.keys(feeds).length;

  const handleRefresh = async () => {
    await refreshAllFeeds();
  };

  return (
    <>
      <header
        className="h-12 flex items-center pr-4 border-b border-glass-border bg-glass-primary/50 backdrop-blur-xl"
        data-tauri-drag-region
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      >
        {/* Mobile menu button */}
        <button
          onClick={onMenuClick}
          className="md:hidden p-2 ml-2 rounded-lg hover:bg-white/10 transition-colors"
          aria-label="Open menu"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
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

        {/* Spacer - fills area where sidebar's top section would be */}
        <div className="flex-1" />

        {/* Actions */}
        <div
          className="flex items-center gap-2"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          {/* Refresh button */}
          {feedCount > 0 && (
            <button
              onClick={handleRefresh}
              disabled={isSyncing}
              className="p-2 rounded-lg hover:bg-white/10 transition-colors disabled:opacity-50"
              aria-label="Refresh feeds"
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
          )}

          {/* Add feed button */}
          <button
            onClick={() => setAddFeedOpen(true)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-accent/20 text-accent hover:bg-accent/30 transition-colors"
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

          {/* Sync status */}
          <div className="flex items-center gap-2 text-sm text-white/55 ml-2">
            <span
              className={`w-2 h-2 rounded-full ${
                isSyncing ? "bg-yellow-500 animate-pulse" : "bg-green-500"
              }`}
            />
            <span className="hidden sm:inline">
              {isSyncing ? "Syncing..." : feedCount > 0 ? "Synced" : "Ready"}
            </span>
          </div>
        </div>
      </header>

      <AddFeedDialog open={addFeedOpen} onClose={() => setAddFeedOpen(false)} />
    </>
  );
}
