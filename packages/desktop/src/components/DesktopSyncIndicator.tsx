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
    <>
      {/* Refresh button */}
      {feedCount > 0 && (
        <button
          onClick={handleRefresh}
          disabled={isSyncing}
          className="p-2 rounded-lg hover:bg-white/10 transition-colors disabled:opacity-50"
          aria-label="Refresh feeds"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
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

      {/* Sync status dot + label — opens Settings → Mobile Sync */}
      <button
        onClick={() =>
          window.dispatchEvent(
            new CustomEvent("freed:open-settings", {
              detail: { scrollTo: "mobile-sync" },
            }),
          )
        }
        className="flex items-center gap-2 text-sm text-[#71717a] ml-2 px-2 py-1 rounded-lg hover:bg-white/5 transition-colors"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        <span
          className={`sync-dot ${
            isSyncing ? "syncing" : "connected"
          }`}
        />
        <span className="hidden sm:inline">
          {isSyncing ? "Syncing..." : feedCount > 0 ? "Synced" : "Ready"}
        </span>
      </button>
    </>
  );
}
