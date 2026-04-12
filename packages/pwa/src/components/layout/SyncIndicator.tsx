/**
 * SyncIndicator -- unified PWA sync widget (header dropdown)
 *
 * Shows overall connection status (dot + label) and, when tapped, a compact
 * informational dropdown. The only action in the dropdown is "Sync settings",
 * which navigates to Settings > Sync. Disconnect lives there and requires
 * deliberate navigation -- it's intentionally not a one-tap action.
 *
 * Five rapid taps within 2 s opens the debug panel instead.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useAppStore } from "../../lib/store";
import { getCloudProvider } from "../../lib/sync";
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

type IconKey = "unlinked" | "gdrive" | "dropbox" | "local";

function useConnectionInfo(syncConnected: boolean) {
  const provider = syncConnected ? getCloudProvider() : null;
  if (!syncConnected) {
    return { label: "Not connected", iconKey: "unlinked" as IconKey };
  }
  if (provider === "gdrive") {
    return { label: "Google Drive", iconKey: "gdrive" as IconKey };
  }
  if (provider === "dropbox") {
    return { label: "Dropbox", iconKey: "dropbox" as IconKey };
  }
  return { label: "Local Desktop", iconKey: "local" as IconKey };
}

/** Brand-colored provider icons at ~20px. */
function ProviderIcon({ iconKey, size = "md" }: { iconKey: IconKey; size?: "sm" | "md" }) {
  const dim = size === "md" ? "w-5 h-5" : "w-4 h-4";
  switch (iconKey) {
    case "gdrive":
      return (
        <svg className={`${dim} theme-icon-media flex-shrink-0`} viewBox="0 0 87.3 78" fill="currentColor">
          <path d="M6.6 66.85l3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8H0c0 1.55.4 3.1 1.2 4.5z" />
          <path d="M43.65 25L29.9 1.2C28.55 2 27.4 3.1 26.6 4.5L1.2 48.5C.4 49.9 0 51.45 0 53h27.5z" opacity="0.86" />
          <path d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5H59.85l5.85 11.2z" opacity="0.94" />
          <path d="M43.65 25L57.4 1.2C56.05.4 54.5 0 52.95 0H34.35c-1.55 0-3.1.45-4.45 1.2z" opacity="0.72" />
          <path d="M59.85 53H27.5L13.75 76.8c1.35.8 2.9 1.2 4.45 1.2h50.9c1.55 0 3.1-.4 4.45-1.2z" opacity="0.8" />
          <path d="M73.4 26.5l-12.8-22.2C59.8 2.9 58.65 1.8 57.3 1L43.55 25 59.8 53h27.45c0-1.55-.4-3.1-1.2-4.5z" opacity="0.64" />
        </svg>
      );
    case "dropbox":
      return (
        <svg className={`${dim} theme-icon-media flex-shrink-0`} viewBox="0 0 24 24" fill="currentColor">
          <path d="M6 2L0 6l6 4-6 4 6 4 6-4-6-4 6-4-6-4zm12 0l-6 4 6 4-6 4 6 4 6-4-6-4 6-4-6-4zm-6 14l-6-4-6 4 6 4 6-4z" />
        </svg>
      );
    case "local":
      return (
        <svg className={`${dim} flex-shrink-0 text-[var(--theme-text-secondary)]`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
      );
    case "unlinked":
      return (
        <svg className={`${dim} flex-shrink-0 text-[var(--theme-text-soft)]`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
        </svg>
      );
  }
}

const openSyncSettings = () =>
  window.dispatchEvent(new CustomEvent("freed:open-settings", { detail: { scrollTo: "sync" } }));

export function SyncIndicator() {
  const [panelOpen, setPanelOpen] = useState(false);
  const isSyncing = useAppStore((s) => s.isSyncing);
  const syncConnected = useAppStore((s) => s.syncConnected);
  const feeds = useAppStore((s) => s.feeds);
  const panelRef = useRef<HTMLDivElement>(null);
  const toggleDebug = useDebugStore((s) => s.toggle);

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

  const statusLabel = isSyncing ? "Syncing" : syncConnected ? "Connected" : "Offline";
  const dotColor = isSyncing
    ? "bg-[var(--theme-accent-secondary)]"
    : syncConnected
      ? "bg-[rgb(var(--theme-feedback-success-rgb))]"
      : "bg-[var(--theme-text-muted)]";
  const statusColor = isSyncing
    ? "text-[var(--theme-accent-secondary)]"
    : syncConnected
      ? "text-[rgb(var(--theme-feedback-success-rgb))]"
      : "text-[var(--theme-text-muted)]";

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
        className={`flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-1.5 rounded-lg text-xs sm:text-sm transition-colors hover:bg-[var(--theme-bg-muted)] ${statusColor}`}
      >
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotColor} ${isSyncing ? "animate-pulse" : ""}`} />
        <span>{statusLabel}</span>
        {lastSyncTime && !isSyncing && (
          <span className="hidden sm:inline text-[10px] tabular-nums text-[var(--theme-text-soft)]">
            · {formatRelativeTime(lastSyncTime)}
          </span>
        )}
      </button>

      {/* Dropdown -- informational card + one action */}
      {panelOpen && (
        <div className="absolute right-0 top-full z-50 mt-1.5 w-60 overflow-hidden rounded-xl border border-[var(--theme-border-subtle)] bg-[color:color-mix(in_oklab,var(--theme-bg-surface)_95%,transparent)] shadow-2xl shadow-black/40">
          {/* Status card */}
          <div className="px-4 py-3.5 flex items-center gap-3">
            <ProviderIcon iconKey={iconKey} size="md" />
            <div className="min-w-0">
              <p className={`text-sm font-semibold leading-none ${syncConnected ? "text-[var(--theme-text-primary)]" : "text-[var(--theme-text-muted)]"}`}>
                {connectionLabel}
              </p>
              {syncConnected && lastSyncTime && (
                <p className="mt-1 text-[11px] tabular-nums text-[var(--theme-text-soft)]">
                  Last synced {formatRelativeTime(lastSyncTime)}
                </p>
              )}
              {syncConnected && !lastSyncTime && (
                <p className="mt-1 text-[11px] text-[var(--theme-text-soft)]">Never synced</p>
              )}
              {!syncConnected && (
                <p className="mt-1 text-[11px] text-[var(--theme-text-soft)]">Tap below to connect</p>
              )}
            </div>
          </div>

          {/* Single action -- always present */}
          <div className="border-t border-[var(--theme-border-subtle)]">
            <button
              onClick={() => {
                setPanelOpen(false);
                openSyncSettings();
              }}
              className="w-full text-left flex items-center justify-between px-4 py-2.5 text-sm text-[var(--theme-accent-secondary)] transition-colors hover:bg-[var(--theme-bg-muted)] hover:opacity-80"
            >
              <span>Sync settings</span>
              <svg className="w-3.5 h-3.5 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
