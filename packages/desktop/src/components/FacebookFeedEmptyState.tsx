/**
 * FacebookFeedEmptyState -- shown when the Facebook filter is active
 * and there are no items to display.
 *
 * Mirrors XFeedEmptyState: unauthenticated users get a connection prompt,
 * authenticated users get a sync button and error display.
 */

import { useState } from "react";
import { useAppStore } from "../lib/store";
import { disconnectFb } from "../lib/fb-auth";
import { captureFbFeed } from "../lib/fb-capture";
import { useSettingsStore } from "@freed/ui/lib/settings-store";
import { resetProviderPauseState } from "../lib/provider-health";
import { SampleDataTestingSection } from "@freed/ui/components/SampleDataTestingSection";

const FbIcon = () => (
  <svg className="h-7 w-7 text-[var(--theme-media-facebook)]" viewBox="0 0 24 24" fill="currentColor">
    <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
  </svg>
);

export function FacebookFeedEmptyState() {
  const fbAuth = useAppStore((s) => s.fbAuth);
  const setFbAuth = useAppStore((s) => s.setFbAuth);
  const isLoading = useAppStore((s) => s.isLoading);
  const activeFilter = useAppStore((s) => s.activeFilter);
  const storeError = useAppStore((s) => s.error);
  const setError = useAppStore((s) => s.setError);
  const openSettings = useSettingsStore((s) => s.openTo);

  const [syncing, setSyncing] = useState(false);

  const handleSync = async () => {
    setError(null);
    setSyncing(true);
    try {
      await captureFbFeed();
    } catch (err) {
      console.error("Facebook sync failed:", err);
    } finally {
      setSyncing(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      await disconnectFb();
    } catch {
      // Best-effort
    }
    await resetProviderPauseState("facebook");
    setFbAuth({ isAuthenticated: false });
    setError(null);
  };

  const syncError = storeError && fbAuth.isAuthenticated ? storeError : null;

  if (activeFilter.platform !== "facebook") return null;

  if (fbAuth.isAuthenticated) {
    return (
      <>
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full border border-[var(--theme-border-subtle)] bg-[radial-gradient(circle_at_top,var(--theme-bg-card-hover),transparent_72%),linear-gradient(135deg,color-mix(in_srgb,var(--theme-media-facebook)_18%,transparent),rgb(var(--theme-accent-secondary-rgb)/0.12))]">
          <FbIcon />
        </div>
        <p className="text-lg font-medium mb-2">All caught up!</p>
        <p className="mb-6 text-sm text-[var(--theme-text-muted)]">Your Facebook feed is up to date.</p>
        <div className="flex gap-3">
          <button
            onClick={handleSync}
            disabled={syncing || isLoading}
            className="theme-accent-button flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-medium transition-colors disabled:opacity-50"
          >
            {syncing ? (
              <>
                <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-[var(--theme-accent-secondary)] border-t-transparent" />
                Syncing...
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Sync Now
              </>
            )}
          </button>
          <button
            onClick={handleDisconnect}
            className="px-5 py-2.5 rounded-xl bg-red-500/15 text-red-400 hover:bg-red-500/25 transition-colors font-medium text-sm"
          >
            Disconnect
          </button>
        </div>
        {syncError && (
          <p className="mt-4 text-xs text-red-400 max-w-xs text-center leading-relaxed">
            {syncError.includes("timeout")
              ? "Scrape timed out. Try again in a minute."
              : syncError}
          </p>
        )}
        <SampleDataTestingSection />
      </>
    );
  }

  return (
    <>
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full border border-[var(--theme-border-subtle)] bg-[radial-gradient(circle_at_top,var(--theme-bg-card-hover),transparent_72%),linear-gradient(135deg,color-mix(in_srgb,var(--theme-media-facebook)_18%,transparent),rgb(var(--theme-accent-secondary-rgb)/0.12))]">
        <FbIcon />
      </div>
      <p className="text-lg font-medium mb-2">Connect Facebook</p>
      <p className="mb-6 max-w-xs text-center text-sm text-[var(--theme-text-muted)]">
        Pull your news feed into Freed. Set it up in Sources settings.
      </p>
      <button
        onClick={() => openSettings("facebook")}
        className="theme-accent-button flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-medium transition-colors"
      >
        Open Settings
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </button>
      <SampleDataTestingSection />
    </>
  );
}
