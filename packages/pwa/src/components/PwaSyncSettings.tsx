/**
 * PwaSyncSettings -- sync section content for the Settings panel on the PWA.
 *
 * Rendered via the SettingsExtraSections platform slot. Two views:
 *
 * - Not connected: shows the full connect UI (SyncConnectContent) inline with
 *   a small "not connected" pill at the top for context. No two-step flow.
 * - Connected: polished status card with provider logo, connection label,
 *   last-synced time, and a Disconnect action.
 */

import { useMemo } from "react";
import { useAppStore } from "../lib/store";
import {
  getCloudProvider,
  clearCloudSync,
  stopCloudSync,
  clearStoredRelayUrl,
  disconnect,
} from "../lib/sync";
import { SyncConnectContent } from "./SyncConnectDialog";

type Provider = "gdrive" | "dropbox" | "local";

function getProviderInfo(syncConnected: boolean): {
  label: string;
  provider: Provider | null;
} {
  if (!syncConnected) return { label: "Not connected", provider: null };
  const provider = getCloudProvider();
  if (provider === "gdrive") return { label: "Google Drive", provider: "gdrive" };
  if (provider === "dropbox") return { label: "Dropbox", provider: "dropbox" };
  return { label: "Local Desktop", provider: "local" };
}

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

function ProviderLogo({ provider }: { provider: Provider }) {
  switch (provider) {
    case "gdrive":
      return (
        <svg className="w-8 h-8 flex-shrink-0" viewBox="0 0 87.3 78" fill="none">
          <path d="M6.6 66.85l3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8H0c0 1.55.4 3.1 1.2 4.5z" fill="#0066da" />
          <path d="M43.65 25L29.9 1.2C28.55 2 27.4 3.1 26.6 4.5L1.2 48.5C.4 49.9 0 51.45 0 53h27.5z" fill="#00ac47" />
          <path d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5H59.85l5.85 11.2z" fill="#ea4335" />
          <path d="M43.65 25L57.4 1.2C56.05.4 54.5 0 52.95 0H34.35c-1.55 0-3.1.45-4.45 1.2z" fill="#00832d" />
          <path d="M59.85 53H27.5L13.75 76.8c1.35.8 2.9 1.2 4.45 1.2h50.9c1.55 0 3.1-.4 4.45-1.2z" fill="#2684fc" />
          <path d="M73.4 26.5l-12.8-22.2C59.8 2.9 58.65 1.8 57.3 1L43.55 25 59.8 53h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00" />
        </svg>
      );
    case "dropbox":
      return (
        <svg className="w-8 h-8 flex-shrink-0" viewBox="0 0 24 24" fill="#0061FF">
          <path d="M6 2L0 6l6 4-6 4 6 4 6-4-6-4 6-4-6-4zm12 0l-6 4 6 4-6 4 6 4 6-4-6-4 6-4-6-4zm-6 14l-6-4-6 4 6 4 6-4z" />
        </svg>
      );
    case "local":
      return (
        <svg className="h-8 w-8 flex-shrink-0 text-[var(--theme-text-secondary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
      );
  }
}

export function PwaSyncSettings() {
  const syncConnected = useAppStore((s) => s.syncConnected);
  const isSyncing = useAppStore((s) => s.isSyncing);
  const feeds = useAppStore((s) => s.feeds);

  const lastSyncTime = useMemo(() => {
    const times = Object.values(feeds)
      .map((f) => f.lastFetched)
      .filter((t): t is number => !!t);
    return times.length > 0 ? Math.max(...times) : null;
  }, [feeds]);

  const { label, provider } = getProviderInfo(syncConnected);

  const handleDisconnect = () => {
    clearStoredRelayUrl();
    disconnect();
    const p = getCloudProvider();
    if (p) {
      clearCloudSync(p);
      stopCloudSync();
    }
  };

  // Disconnected -- show connect UI inline, no intermediate "Connect" button
  if (!syncConnected) {
    return (
      <div className="flex flex-col flex-1">
        <div className="mb-8 overflow-hidden rounded-xl border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-card)]">
          {/* Status row */}
          <div className="flex items-center gap-4 px-4 py-4">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--theme-bg-muted)]">
              <svg className="h-4 w-4 text-[var(--theme-text-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
              </svg>
            </span>
            <div>
              <p className="text-sm font-semibold text-[var(--theme-text-secondary)]">Not connected</p>
              <p className="mt-0.5 text-xs text-[var(--theme-text-soft)]">Choose a sync method below to get started.</p>
            </div>
          </div>

          {/* Divider */}
          <div className="border-t border-[var(--theme-border-subtle)]" />

          {/* New user welcome */}
          <div className="flex items-center gap-4 px-4 py-4">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[rgb(var(--theme-accent-secondary-rgb)/0.1)]">
              <svg className="h-4 w-4 text-[var(--theme-accent-secondary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
              </svg>
            </span>
            <div>
              <p className="text-xs leading-relaxed text-[var(--theme-text-muted)]">
                First time? Install Freed Desktop to track your feeds and sync them here.
              </p>
              <a
                href="https://freed.wtf/get"
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-block text-xs font-semibold text-[var(--theme-accent-secondary)] transition-colors hover:text-[var(--theme-text-primary)]"
              >
                Get Freed Desktop →
              </a>
            </div>
          </div>
        </div>
        <SyncConnectContent onDone={() => {}} />
      </div>
    );
  }

  // Connected -- polished status card
  const statusText = isSyncing ? "Syncing now" : "Connected";
  const dotColor = isSyncing ? "bg-[var(--theme-accent-secondary)] animate-pulse" : "bg-green-400";

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4 rounded-xl border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-card)] px-4 py-4">
        {provider && <ProviderLogo provider={provider} />}
        <div className="min-w-0 flex-1">
          <p className="text-base font-semibold leading-none text-[var(--theme-text-primary)]">{label}</p>
          <div className="flex items-center gap-1.5 mt-1.5">
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotColor}`} />
            <span className="text-xs text-[var(--theme-text-muted)]">{statusText}</span>
          </div>
          {lastSyncTime && (
            <p className="mt-1 text-[11px] tabular-nums text-[var(--theme-text-soft)]">
              Last synced {formatRelativeTime(lastSyncTime)}
            </p>
          )}
        </div>
      </div>

      <div className="flex justify-end">
        <button
          onClick={handleDisconnect}
          className="text-xs text-red-400 hover:text-red-300 transition-colors"
        >
          Disconnect
        </button>
      </div>
    </div>
  );
}
