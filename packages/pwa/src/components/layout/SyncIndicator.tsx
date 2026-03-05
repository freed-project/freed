/**
 * PwaSyncIndicator — unified PWA sync widget (header dropdown)
 *
 * Shows overall connection status (dot + label) and, when tapped, a compact
 * dropdown with the connection type and connect/disconnect actions. Per-feed
 * breakdown has been removed -- that detail level belongs in the feed list.
 *
 * Five rapid taps within 2 s opens the debug panel instead.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useAppStore } from "../../lib/store";
import {
  disconnect,
  clearStoredRelayUrl,
  getCloudProvider,
  clearCloudSync,
  stopCloudSync,
} from "../../lib/sync";
import { SyncConnectDialog } from "../SyncConnectDialog";
import { useDebugStore } from "@freed/ui/lib/debug-store";

const DEBUG_TAP_COUNT = 5;
const DEBUG_TAP_WINDOW_MS = 2000;

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

/** Human-readable label and icon key for the active connection type. */
function useConnectionInfo(syncConnected: boolean) {
  const provider = syncConnected ? getCloudProvider() : null;
  if (!syncConnected) {
    return { label: "Not connected", iconKey: "unlinked" as const };
  }
  if (provider === "gdrive") {
    return { label: "Google Drive", iconKey: "gdrive" as const };
  }
  if (provider === "dropbox") {
    return { label: "Dropbox", iconKey: "dropbox" as const };
  }
  // Connected via LAN relay (no cloud provider)
  return { label: "Local Desktop", iconKey: "local" as const };
}

type IconKey = "unlinked" | "gdrive" | "dropbox" | "local";

function ConnectionIcon({ iconKey }: { iconKey: IconKey }) {
  switch (iconKey) {
    case "gdrive":
      // Google Drive
      return (
        <svg className="w-4 h-4 text-[#a1a1aa] flex-shrink-0" viewBox="0 0 24 24" fill="currentColor">
          <path d="M6.29 2.37L2.13 9.5l4.16 7.13L10.45 9.5 6.29 2.37zm11.42 0L13.55 9.5l4.16 7.13 4.16-7.13-4.16-7.13zm-5.71 9.86L8.21 19.5h7.58l3.79-7.27H12z" />
        </svg>
      );
    case "dropbox":
      return (
        <svg className="w-4 h-4 text-[#a1a1aa] flex-shrink-0" viewBox="0 0 24 24" fill="currentColor">
          <path d="M6 2L0 6l6 4-6 4 6 4 6-4-6-4 6-4-6-4zm12 0l-6 4 6 4-6 4 6 4 6-4-6-4 6-4-6-4zm-6 14l-6-4-6 4 6 4 6-4z" />
        </svg>
      );
    case "local":
      return (
        <svg className="w-4 h-4 text-[#a1a1aa] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
      );
    case "unlinked":
      return (
        <svg className="w-4 h-4 text-[#52525b] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
        </svg>
      );
  }
}

export function SyncIndicator() {
  const [panelOpen, setPanelOpen] = useState(false);
  const [showConnectDialog, setShowConnectDialog] = useState(false);
  const isSyncing = useAppStore((s) => s.isSyncing);
  const syncConnected = useAppStore((s) => s.syncConnected);
  const feeds = useAppStore((s) => s.feeds);
  const panelRef = useRef<HTMLDivElement>(null);
  const toggleDebug = useDebugStore((s) => s.toggle);

  // 5-tap secret trigger for debug panel (resets after 2 s idle)
  const tapCountRef = useRef(0);
  const tapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { label: connectionLabel, iconKey } = useConnectionInfo(syncConnected);

  const lastSyncTime = useMemo(() => {
    const times = Object.values(feeds)
      .map((f) => f.lastFetched)
      .filter((t): t is number => !!t);
    return times.length > 0 ? Math.max(...times) : null;
  }, [feeds]);

  // Close dropdown on outside click
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
    const cloudProvider = getCloudProvider();
    if (cloudProvider) {
      clearCloudSync(cloudProvider);
      stopCloudSync();
    }
    setPanelOpen(false);
  };

  const statusLabel = isSyncing ? "Syncing" : syncConnected ? "Connected" : "Offline";
  const dotColor = isSyncing ? "bg-[#8b5cf6]" : syncConnected ? "bg-green-400" : "bg-[#71717a]";
  const statusColor = isSyncing ? "text-[#8b5cf6]" : syncConnected ? "text-green-400" : "text-[#71717a]";

  return (
    <div className="relative" ref={panelRef}>
      {/* Header button */}
      <button
        onClick={() => {
          tapCountRef.current += 1;
          if (tapTimerRef.current) clearTimeout(tapTimerRef.current);

          if (tapCountRef.current >= DEBUG_TAP_COUNT) {
            tapCountRef.current = 0;
            setPanelOpen(false);
            toggleDebug();
          } else {
            tapTimerRef.current = setTimeout(() => {
              tapCountRef.current = 0;
            }, DEBUG_TAP_WINDOW_MS);
            setPanelOpen((prev) => !prev);
          }
        }}
        className={`flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-1.5 rounded-lg text-xs sm:text-sm transition-colors hover:bg-white/5 ${statusColor}`}
      >
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotColor} ${isSyncing ? "animate-pulse" : ""}`} />
        <span>{statusLabel}</span>
        {lastSyncTime && !isSyncing && (
          <span className="hidden sm:inline text-[10px] text-[#52525b] tabular-nums">
            · {formatRelativeTime(lastSyncTime)}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {panelOpen && (
        <div className="absolute right-0 top-full mt-2 w-64 bg-[#1a1a1a] border border-[rgba(255,255,255,0.08)] rounded-xl shadow-2xl z-50 overflow-hidden">
          {/* Status header */}
          <div className="px-4 py-3 border-b border-[rgba(255,255,255,0.06)]">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-white">Sync</span>
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

          {/* Connection type row */}
          <div className="px-4 py-3 flex items-center gap-3 border-b border-[rgba(255,255,255,0.06)]">
            <ConnectionIcon iconKey={iconKey} />
            <span className={`text-sm ${syncConnected ? "text-[#a1a1aa]" : "text-[#52525b]"}`}>
              {connectionLabel}
            </span>
          </div>

          {/* Action */}
          <div className="px-4 py-2.5">
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
