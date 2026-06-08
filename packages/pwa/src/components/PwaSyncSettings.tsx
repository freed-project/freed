/**
 * PwaSyncSettings, sync section content for the Settings panel on the PWA.
 *
 * Rendered via the SettingsExtraSections platform slot. Two views:
 *
 * - Not connected: shows the full connect UI (SyncConnectContent) inline with
 *   a small "not connected" pill at the top for context. No two-step flow.
 * - Connected: polished status card with provider logo, connection label,
 *   last-synced time, and a Disconnect action.
 */

import { useCallback, useMemo, useState } from "react";
import { getWebsiteHostForChannel } from "@freed/shared";
import { usePlatform } from "@freed/ui/context";
import { useDebugStore, type CloudProviderDebugState } from "@freed/ui/lib/debug-store";
import { useAppStore } from "../lib/store";
import {
  getCloudProvider,
  clearCloudSync,
  stopCloudSync,
  clearStoredRelayUrl,
  disconnect,
  syncCloudProviderNow,
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
  if (minutes < 60) return `${minutes.toLocaleString()}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours.toLocaleString()}h ago`;
  const days = Math.floor(hours / 24);
  return `${days.toLocaleString()}d ago`;
}

function formatBytes(bytes?: number): string {
  if (typeof bytes !== "number") return "-";
  if (bytes < 1024) return `${bytes.toLocaleString()} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toLocaleString(undefined, { maximumFractionDigits: 1 })} KB`;
  return `${(bytes / (1024 * 1024)).toLocaleString(undefined, { maximumFractionDigits: 2 })} MB`;
}

function formatDiagnosticTime(timestamp?: number): string {
  return typeof timestamp === "number" ? formatRelativeTime(timestamp) : "-";
}

function SyncDiagnosticCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-[var(--theme-bg-muted)] px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--theme-text-soft)]">{label}</p>
      <p className="mt-1 truncate font-mono text-xs tabular-nums text-[var(--theme-text-secondary)]">{value}</p>
    </div>
  );
}

function describeUploadGap(state: CloudProviderDebugState | null): string {
  if (!state) return "Connect Google Drive to start cloud sync.";
  if (state.stage === "upload") return "Uploading now.";
  if (state.lastUploadAt) return state.pendingReason ?? "Last upload completed. Waiting for the next local change.";
  if (state.error) return "Upload has not completed because sync needs attention.";
  if (state.pendingReason) return state.pendingReason;
  if (state.lastDownloadAt) return "Drive was checked, but no upload has completed yet. Use Sync now to upload immediately.";
  return "No upload has completed yet. Use Sync now to force a full pass.";
}

function isMergeBlocked(message?: string): boolean {
  return message?.includes("blocked a sync merge") ?? false;
}

function describeProviderError(message: string): string {
  if (isMergeBlocked(message)) return "Merge blocked. Review Sync diagnostics below.";
  return "Sync needs attention. Review Sync diagnostics below.";
}

function ProviderLogo({ provider }: { provider: Provider }) {
  switch (provider) {
    case "gdrive":
      return (
        <svg className="theme-icon-media h-8 w-8 flex-shrink-0" viewBox="0 0 87.3 78" fill="currentColor">
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
        <svg className="theme-icon-media h-8 w-8 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor">
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
  const { releaseChannel } = usePlatform();
  const syncConnected = useAppStore((s) => s.syncConnected);
  const isSyncing = useAppStore((s) => s.isSyncing);
  const feeds = useAppStore((s) => s.feeds);
  const docSnapshot = useDebugStore((s) => s.docSnapshot);
  const cloudProviders = useDebugStore((s) => s.cloudProviders);
  const [manualSyncingProvider, setManualSyncingProvider] = useState<"gdrive" | "dropbox" | null>(null);
  const [manualSyncError, setManualSyncError] = useState<string | null>(null);
  const websiteGetUrl = `https://${getWebsiteHostForChannel(releaseChannel ?? "production")}/get`;

  const lastSyncTime = useMemo(() => {
    const times = Object.values(feeds)
      .map((f) => f.lastFetched)
      .filter((t): t is number => !!t);
    return times.length > 0 ? Math.max(...times) : null;
  }, [feeds]);

  const { label, provider } = getProviderInfo(syncConnected);
  const cloudProviderState = provider === "gdrive" || provider === "dropbox"
    ? cloudProviders?.[provider]
    : null;
  const activeCloudProvider = provider === "gdrive" || provider === "dropbox" ? provider : null;
  const isManualSyncing = manualSyncingProvider !== null;
  const uploadExplanation = describeUploadGap(cloudProviderState ?? null);
  const diagnosticError = cloudProviderState?.error ?? manualSyncError;

  const handleDisconnect = () => {
    clearStoredRelayUrl();
    disconnect();
    const p = getCloudProvider();
    if (p) {
      clearCloudSync(p);
      stopCloudSync();
    }
  };

  const handleManualCloudSync = useCallback(async () => {
    if (!activeCloudProvider) return;
    setManualSyncingProvider(activeCloudProvider);
    setManualSyncError(null);
    try {
      await syncCloudProviderNow(activeCloudProvider);
    } catch (error) {
      setManualSyncError(error instanceof Error ? error.message : "Cloud sync failed.");
    } finally {
      setManualSyncingProvider(null);
    }
  }, [activeCloudProvider]);

  // Disconnected, show connect UI inline with no intermediate "Connect" button.
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
                href={websiteGetUrl}
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

  // Connected, polished status card.
  const providerError = cloudProviderState?.error;
  const statusText = providerError
    ? isMergeBlocked(providerError) ? "Merge blocked" : "Needs attention"
    : isSyncing ? "Syncing now" : "Connected";
  const dotColor = providerError
    ? "bg-[rgb(var(--theme-feedback-danger-rgb))]"
    : isSyncing
      ? "bg-[var(--theme-accent-secondary)] animate-pulse"
      : "bg-[rgb(var(--theme-feedback-success-rgb))]";

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
          {providerError && (
            <p className="theme-feedback-text-danger mt-2 break-words text-xs">
              {describeProviderError(providerError)}
            </p>
          )}
        </div>
      </div>

      <div
        data-testid="pwa-cloud-sync-diagnostics"
        className="rounded-xl border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-card)] p-4"
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-[var(--theme-text-primary)]">Sync diagnostics</p>
            <p className="mt-0.5 text-xs text-[var(--theme-text-soft)]">Local document and cloud transfer state</p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2 sm:flex-row sm:items-center">
            {cloudProviderState?.stage && (
              <span className="rounded-full bg-[var(--theme-bg-muted)] px-2 py-1 text-[11px] font-medium text-[var(--theme-text-muted)]">
                {cloudProviderState.stage}
              </span>
            )}
            <button
              type="button"
              data-testid="pwa-cloud-sync-now-button"
              onClick={handleManualCloudSync}
              disabled={!activeCloudProvider || isManualSyncing}
              className="btn-secondary rounded-lg px-3 py-1.5 text-xs disabled:opacity-50"
            >
              {isManualSyncing ? "Syncing..." : "Sync now"}
            </button>
          </div>
        </div>

        {diagnosticError && (
          <p className="theme-feedback-text-danger mb-3 break-words text-xs">{diagnosticError}</p>
        )}

        <div
          data-testid="pwa-cloud-sync-status-message"
          className="mb-3 rounded-lg bg-[var(--theme-bg-muted)] px-3 py-2 text-xs text-[var(--theme-text-secondary)]"
        >
          <p className="font-medium text-[var(--theme-text-primary)]">
            {cloudProviderState?.statusMessage ?? "No cloud sync activity yet."}
          </p>
          <p className="mt-1 text-[var(--theme-text-muted)]">{uploadExplanation}</p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <SyncDiagnosticCell
            label="Local items"
            value={docSnapshot ? docSnapshot.itemCount.toLocaleString() : "-"}
          />
          <SyncDiagnosticCell
            label="Local size"
            value={formatBytes(docSnapshot?.binarySize)}
          />
          <SyncDiagnosticCell
            label="Last download"
            value={formatDiagnosticTime(cloudProviderState?.lastDownloadAt)}
          />
          <SyncDiagnosticCell
            label="Remote bytes"
            value={formatBytes(cloudProviderState?.lastRemoteBytes)}
          />
          <SyncDiagnosticCell
            label="Last merge"
            value={formatDiagnosticTime(cloudProviderState?.lastMergeAt)}
          />
          <SyncDiagnosticCell
            label="Last upload"
            value={formatDiagnosticTime(cloudProviderState?.lastUploadAt)}
          />
        </div>

        {cloudProviderState?.events && cloudProviderState.events.length > 0 && (
          <div className="mt-3 space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--theme-text-soft)]">
              Activity
            </p>
            <div data-testid="pwa-cloud-sync-activity" className="space-y-1.5">
              {cloudProviderState.events.slice(0, 6).map((event) => (
                <div
                  key={event.id}
                  className="flex items-start justify-between gap-3 rounded-lg bg-[var(--theme-bg-muted)] px-3 py-2 text-xs"
                >
                  <div className="min-w-0">
                    <p className="truncate text-[var(--theme-text-secondary)]">{event.message}</p>
                    <p className="mt-0.5 text-[10px] uppercase tracking-wider text-[var(--theme-text-soft)]">
                      {event.kind}, {event.stage}
                    </p>
                  </div>
                  <div className="shrink-0 text-right font-mono text-[10px] text-[var(--theme-text-muted)]">
                    <p>{formatDiagnosticTime(event.ts)}</p>
                    {typeof event.bytes === "number" && <p>{formatBytes(event.bytes)}</p>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="flex justify-end">
        <button
          onClick={handleDisconnect}
          className="theme-feedback-text-danger text-xs transition-colors hover:opacity-80"
        >
          Disconnect
        </button>
      </div>
    </div>
  );
}
