/**
 * PwaSyncIndicator — unified PWA sync widget (header dropdown)
 *
 * Single source of truth for all sync concerns: connection status,
 * time since last sync, per-feed breakdown, and connect/disconnect actions.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useAppStore } from "../../lib/store";
import { disconnect, clearStoredRelayUrl } from "../../lib/sync";
import { SyncConnectDialog } from "../SyncConnectDialog";

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

export function SyncIndicator() {
  const [panelOpen, setPanelOpen] = useState(false);
  const [showConnectDialog, setShowConnectDialog] = useState(false);
  const isSyncing = useAppStore((s) => s.isSyncing);
  const syncConnected = useAppStore((s) => s.syncConnected);
  const feeds = useAppStore((s) => s.feeds);
  const panelRef = useRef<HTMLDivElement>(null);

  const feedList = Object.values(feeds);
  const feedCount = feedList.length;

  const lastSyncTime = useMemo(() => {
    const times = feedList
      .map((f) => f.lastFetched)
      .filter((t): t is number => !!t);
    return times.length > 0 ? Math.max(...times) : null;
  }, [feedList]);

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

  const handleDisconnect = () => {
    clearStoredRelayUrl();
    disconnect();
    setPanelOpen(false);
  };

  const statusLabel = isSyncing
    ? "Syncing"
    : syncConnected
      ? "Connected"
      : "Offline";

  const dotColor = isSyncing
    ? "bg-[#8b5cf6]"
    : syncConnected
      ? "bg-green-400"
      : "bg-[#71717a]";

  const statusColor = isSyncing
    ? "text-[#8b5cf6]"
    : syncConnected
      ? "text-green-400"
      : "text-[#71717a]";

  return (
    <div className="relative" ref={panelRef}>
      {/* Desktop button */}
      <button
        onClick={() => setPanelOpen((prev) => !prev)}
        className={`hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors hover:bg-white/5 ${statusColor}`}
      >
        <span className={`w-1.5 h-1.5 rounded-full ${dotColor} ${isSyncing ? "animate-pulse" : ""}`} />
        <span>{statusLabel}</span>
        {lastSyncTime && !isSyncing && (
          <span className="text-[10px] text-[#52525b] tabular-nums">
            · {formatRelativeTime(lastSyncTime)}
          </span>
        )}
      </button>

      {/* Mobile button */}
      <button
        onClick={() => setPanelOpen((prev) => !prev)}
        className={`sm:hidden p-2 rounded-lg transition-colors hover:bg-white/5 ${statusColor}`}
      >
        <span className={`block w-2 h-2 rounded-full ${dotColor} ${isSyncing ? "animate-pulse" : ""}`} />
      </button>

      {/* Dropdown panel */}
      {panelOpen && (
        <div className="absolute right-0 top-full mt-2 w-72 bg-[#1a1a1a] border border-[rgba(255,255,255,0.08)] rounded-xl shadow-2xl z-50 overflow-hidden">
          {/* Header */}
          <div className="px-4 py-3 border-b border-[rgba(255,255,255,0.06)]">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-white">Desktop Sync</span>
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
            {lastSyncTime && (
              <p className="text-[10px] text-[#52525b] mt-1 tabular-nums">
                Last synced {formatRelativeTime(lastSyncTime)}
              </p>
            )}
          </div>

          {/* Per-feed breakdown */}
          {feedCount > 0 ? (
            <div className="max-h-48 overflow-y-auto">
              {feedList.map((feed) => (
                <div
                  key={feed.url}
                  className="flex items-center gap-2 px-4 py-2 border-b border-[rgba(255,255,255,0.04)] last:border-0"
                >
                  {isSyncing ? (
                    <span className={`w-1.5 h-1.5 rounded-full bg-[#8b5cf6] animate-pulse flex-shrink-0`} />
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

          {/* Actions */}
          <div className="px-4 py-2.5 border-t border-[rgba(255,255,255,0.06)]">
            {syncConnected ? (
              <button
                onClick={handleDisconnect}
                className="w-full text-xs text-red-400 hover:text-red-300 transition-colors text-center py-1"
              >
                Disconnect
              </button>
            ) : (
              <button
                onClick={() => {
                  setPanelOpen(false);
                  setShowConnectDialog(true);
                }}
                className="w-full text-xs text-[#8b5cf6] hover:text-[#a78bfa] transition-colors text-center py-1"
              >
                Connect to Desktop
              </button>
            )}
          </div>
        </div>
      )}

      <SyncConnectDialog
        open={showConnectDialog}
        onClose={() => setShowConnectDialog(false)}
      />
    </div>
  );
}
