/**
 * DesktopSyncIndicator — desktop-only header widget
 *
 * Click opens a popover showing sync status, last-sync time, and a button to
 * manually trigger a refresh. The refresh no longer fires on the first click
 * so you don't accidentally hammer your feeds every time you glance at the UI.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useAppStore } from "../lib/store";
import { refreshAllFeeds } from "../lib/capture";

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

export function DesktopSyncIndicator() {
  const [panelOpen, setPanelOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const isSyncing = useAppStore((s) => s.isSyncing);
  const feeds = useAppStore((s) => s.feeds);

  const feedList = useMemo(() => Object.values(feeds), [feeds]);
  const feedCount = feedList.length;

  const lastSyncTime = useMemo(() => {
    const times = feedList
      .map((f) => f.lastFetched)
      .filter((t): t is number => !!t);
    return times.length > 0 ? Math.max(...times) : null;
  }, [feedList]);

  // Close panel on outside click
  useEffect(() => {
    if (!panelOpen) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setPanelOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [panelOpen]);

  const handleSyncNow = async () => {
    setPanelOpen(false);
    await refreshAllFeeds();
  };

  const statusLabel = isSyncing ? "Syncing…" : feedCount > 0 ? "Synced" : "Ready";
  const statusBadgeClass = isSyncing
    ? "bg-[#8b5cf6]/20 text-[#8b5cf6]"
    : "bg-white/5 text-[#71717a]";

  return (
    <div
      className="relative"
      ref={panelRef}
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
    >
      {/* Trigger button */}
      <button
        onClick={() => setPanelOpen((prev) => !prev)}
        className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm text-[#71717a] hover:bg-white/5 hover:text-white transition-colors"
        aria-label={isSyncing ? "Syncing feeds" : "Sync status"}
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
        <span className="hidden sm:inline">{statusLabel}</span>
      </button>

      {/* Dropdown panel */}
      {panelOpen && (
        <div className="absolute right-0 top-full mt-2 w-64 bg-[#1a1a1a] border border-[rgba(255,255,255,0.08)] rounded-xl shadow-2xl z-50 overflow-hidden">
          {/* Header row */}
          <div className="px-4 py-3 border-b border-[rgba(255,255,255,0.06)]">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-white">Feed Sync</span>
              <span className={`text-xs px-2 py-0.5 rounded-full ${statusBadgeClass}`}>
                {isSyncing ? "Syncing" : feedCount > 0 ? "Synced" : "Ready"}
              </span>
            </div>
            <p className="text-[10px] text-[#52525b] mt-1 tabular-nums">
              {lastSyncTime
                ? `Last synced ${formatRelativeTime(lastSyncTime)}`
                : "Never synced"}
            </p>
          </div>

          {/* Per-feed breakdown */}
          {feedCount > 0 && (
            <div className="max-h-48 overflow-y-auto">
              {feedList.map((feed) => (
                <div
                  key={feed.url}
                  className="flex items-center gap-2 px-4 py-2 border-b border-[rgba(255,255,255,0.04)] last:border-0"
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                      isSyncing ? "bg-[#8b5cf6] animate-pulse" : "bg-green-400"
                    }`}
                  />
                  <span className="text-xs text-[#a1a1aa] truncate">{feed.title || feed.url}</span>
                  {feed.lastFetched && !isSyncing && (
                    <span className="ml-auto text-[10px] text-[#52525b] flex-shrink-0 tabular-nums">
                      {formatRelativeTime(feed.lastFetched)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Sync Now action */}
          <div className="px-4 py-3 border-t border-[rgba(255,255,255,0.06)]">
            <button
              onClick={handleSyncNow}
              disabled={isSyncing || feedCount === 0}
              className="w-full flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg bg-[#8b5cf6]/20 text-[#8b5cf6] hover:bg-[#8b5cf6]/30 transition-colors text-xs font-medium disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <svg
                className={`w-3.5 h-3.5 ${isSyncing ? "animate-spin" : ""}`}
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
              {isSyncing ? "Syncing…" : "Sync Now"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
