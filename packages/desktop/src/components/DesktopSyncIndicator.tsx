/**
 * DesktopSyncIndicator -- desktop-only header widget
 *
 * Shows a high-level overview of each sync provider (RSS, X, Facebook)
 * rather than listing individual feeds.
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

interface ProviderRowProps {
  name: string;
  icon: React.ReactNode;
  connected: boolean;
  detail: string;
  syncing: boolean;
}

function ProviderRow({ name, icon, connected, detail, syncing }: ProviderRowProps) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <span className="w-5 h-5 flex items-center justify-center text-[#71717a] flex-shrink-0">
        {icon}
      </span>
      <div className="flex-1 min-w-0">
        <span className="text-xs text-[#a1a1aa] font-medium">{name}</span>
        <p className="text-[10px] text-[#52525b] truncate">{detail}</p>
      </div>
      <span
        className={`w-2 h-2 rounded-full flex-shrink-0 ${
          syncing
            ? "bg-[#8b5cf6] animate-pulse"
            : connected
              ? "bg-green-400"
              : "bg-[#3f3f46]"
        }`}
      />
    </div>
  );
}

const RssIcon = () => (
  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
    <circle cx="6.18" cy="17.82" r="2.18" />
    <path d="M4 4.44v2.83c7.03 0 12.73 5.7 12.73 12.73h2.83c0-8.59-6.97-15.56-15.56-15.56zm0 5.66v2.83c3.9 0 7.07 3.17 7.07 7.07h2.83c0-5.47-4.43-9.9-9.9-9.9z" />
  </svg>
);

const XIcon = () => (
  <span className="text-sm font-bold leading-none">𝕏</span>
);

const FbIcon = () => (
  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
    <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
  </svg>
);

export function DesktopSyncIndicator() {
  const [panelOpen, setPanelOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const isSyncing = useAppStore((s) => s.isSyncing);
  const feeds = useAppStore((s) => s.feeds);
  const xAuth = useAppStore((s) => s.xAuth);
  const fbAuth = useAppStore((s) => s.fbAuth);
  const items = useAppStore((s) => s.items);

  const feedList = useMemo(() => Object.values(feeds), [feeds]);
  const feedCount = feedList.length;

  const lastSyncTime = useMemo(() => {
    const times = feedList
      .map((f) => f.lastFetched)
      .filter((t): t is number => !!t);
    return times.length > 0 ? Math.max(...times) : null;
  }, [feedList]);

  const rssItemCount = useMemo(
    () => items.filter((i) => i.platform === "rss").length,
    [items],
  );
  const xItemCount = useMemo(
    () => items.filter((i) => i.platform === "x").length,
    [items],
  );
  const fbItemCount = useMemo(
    () => items.filter((i) => i.platform === "facebook").length,
    [items],
  );

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

  const statusLabel = isSyncing
    ? "Syncing..."
    : feedCount > 0 || xAuth.isAuthenticated || fbAuth.isAuthenticated
      ? "Synced"
      : "Ready";

  const statusBadgeClass = isSyncing
    ? "bg-[#8b5cf6]/20 text-[#8b5cf6]"
    : "bg-white/5 text-[#71717a]";

  const hasAnySources = feedCount > 0 || xAuth.isAuthenticated || fbAuth.isAuthenticated;

  return (
    <div
      className="relative"
      ref={panelRef}
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
    >
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

      {panelOpen && (
        <div className="absolute right-0 top-full mt-2 w-72 bg-[#1a1a1a] border border-[rgba(255,255,255,0.08)] rounded-xl shadow-2xl z-50 overflow-hidden">
          {/* Header */}
          <div className="px-4 py-3 border-b border-[rgba(255,255,255,0.06)]">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-white">Sources</span>
              <span
                className={`text-xs px-2 py-0.5 rounded-full ${statusBadgeClass}`}
              >
                {isSyncing ? "Syncing" : hasAnySources ? "Synced" : "Ready"}
              </span>
            </div>
            <p className="text-[10px] text-[#52525b] mt-1 tabular-nums">
              {lastSyncTime
                ? `Last synced ${formatRelativeTime(lastSyncTime)}`
                : hasAnySources
                  ? "Syncing..."
                  : "No sources configured"}
            </p>
          </div>

          {/* Provider rows */}
          <div className="divide-y divide-[rgba(255,255,255,0.04)]">
            <ProviderRow
              name="RSS"
              icon={<RssIcon />}
              connected={feedCount > 0}
              detail={
                feedCount > 0
                  ? `${feedCount.toLocaleString()} feed${feedCount === 1 ? "" : "s"}, ${rssItemCount.toLocaleString()} items`
                  : "No feeds added"
              }
              syncing={isSyncing}
            />
            <ProviderRow
              name="X"
              icon={<XIcon />}
              connected={xAuth.isAuthenticated}
              detail={
                xAuth.isAuthenticated
                  ? `Connected, ${xItemCount.toLocaleString()} items`
                  : "Not connected"
              }
              syncing={isSyncing && xAuth.isAuthenticated}
            />
            <ProviderRow
              name="Facebook"
              icon={<FbIcon />}
              connected={fbAuth.isAuthenticated}
              detail={
                fbAuth.isAuthenticated
                  ? `Connected, ${fbItemCount.toLocaleString()} items`
                  : "Not connected"
              }
              syncing={isSyncing && fbAuth.isAuthenticated}
            />
          </div>

          {/* Sync Now action */}
          <div className="px-4 py-3 border-t border-[rgba(255,255,255,0.06)]">
            <button
              onClick={handleSyncNow}
              disabled={isSyncing || !hasAnySources}
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
              {isSyncing ? "Syncing..." : "Sync Now"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
