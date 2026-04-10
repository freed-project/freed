/**
 * InstagramFeedEmptyState -- shown when the Instagram filter is active
 * and there are no items to display.
 *
 * Mirrors FacebookFeedEmptyState: unauthenticated users get a connection
 * prompt, authenticated users get a sync button and error display.
 */

import { useState } from "react";
import { useAppStore } from "../lib/store";
import { disconnectIg } from "../lib/instagram-auth";
import { captureIgFeed } from "../lib/instagram-capture";
import { useSettingsStore } from "@freed/ui/lib/settings-store";
import { resetProviderPauseState } from "../lib/provider-health";

const IgIcon = () => (
  <svg className="w-7 h-7 text-[#a1a1aa]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
    <circle cx="12" cy="12" r="4" />
    <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
  </svg>
);

export function InstagramFeedEmptyState() {
  const igAuth = useAppStore((s) => s.igAuth);
  const setIgAuth = useAppStore((s) => s.setIgAuth);
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
      await captureIgFeed();
    } catch (err) {
      console.error("Instagram sync failed:", err);
    } finally {
      setSyncing(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      await disconnectIg();
    } catch {
      // Best-effort
    }
    await resetProviderPauseState("instagram");
    setIgAuth({ isAuthenticated: false });
    setError(null);
  };

  const syncError = storeError && igAuth.isAuthenticated ? storeError : null;

  if (activeFilter.platform !== "instagram") return null;

  if (igAuth.isAuthenticated) {
    return (
      <>
        <div className="w-16 h-16 rounded-full bg-gradient-to-br from-[#E1306C]/20 to-[#8b5cf6]/20 flex items-center justify-center mb-4">
          <IgIcon />
        </div>
        <p className="text-lg font-medium mb-2">All caught up!</p>
        <p className="text-sm text-[#71717a] mb-6">Your Instagram feed is up to date.</p>
        <div className="flex gap-3">
          <button
            onClick={handleSync}
            disabled={syncing || isLoading}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#8b5cf6]/20 text-[#8b5cf6] hover:bg-[#8b5cf6]/30 disabled:opacity-50 transition-colors font-medium text-sm"
          >
            {syncing ? (
              <>
                <div className="w-3.5 h-3.5 border-2 border-[#8b5cf6] border-t-transparent rounded-full animate-spin" />
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
      </>
    );
  }

  return (
    <>
      <div className="w-16 h-16 rounded-full bg-gradient-to-br from-[#E1306C]/20 to-[#8b5cf6]/20 flex items-center justify-center mb-4">
        <IgIcon />
      </div>
      <p className="text-lg font-medium mb-2">Connect Instagram</p>
      <p className="text-sm text-[#71717a] mb-6 max-w-xs text-center">
        Pull your feed into Freed. Set it up in Sources settings.
      </p>
      <button
        onClick={() => openSettings("instagram")}
        className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#8b5cf6]/20 text-[#8b5cf6] hover:bg-[#8b5cf6]/30 transition-colors font-medium text-sm"
      >
        Open Settings
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </button>
    </>
  );
}
