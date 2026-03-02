/**
 * DesktopSyncIndicator — desktop-only header widget
 *
 * Shows a refresh button and sync status dot. The desktop app
 * can refresh feeds directly (unlike the PWA which relies on sync).
 */

import { useAppStore } from "../lib/store";
import { refreshAllFeeds } from "../lib/capture";

export function DesktopSyncIndicator() {
  const isSyncing = useAppStore((s) => s.isSyncing);
  const feeds = useAppStore((s) => s.feeds);
  const feedCount = Object.keys(feeds).length;

  const handleRefresh = async () => {
    await refreshAllFeeds();
  };

  return (
    <button
      onClick={feedCount > 0 ? handleRefresh : undefined}
      disabled={isSyncing}
      className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm text-[#71717a] hover:bg-white/5 hover:text-white transition-colors disabled:opacity-60"
      aria-label={isSyncing ? "Syncing feeds" : "Refresh feeds"}
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
    >
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
      <span className="hidden sm:inline">
        {isSyncing ? "Syncing…" : feedCount > 0 ? "Synced" : "Ready"}
      </span>
    </button>
  );
}
