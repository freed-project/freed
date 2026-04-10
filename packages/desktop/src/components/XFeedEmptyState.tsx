/**
 * XFeedEmptyState — shown in the feed blank state when no items are available.
 *
 * When the X platform filter is active and X is not authenticated, shows a
 * brief invitation with a link to Settings > Sources > X instead of
 * embedding the full connection form in the feed.
 *
 * When authenticated but empty, offers a quick manual sync trigger.
 * For non-X filters, falls back to the generic "All caught up" message.
 */

import { useState } from "react";
import { useAppStore } from "../lib/store";
import { loadStoredCookies, disconnectX } from "../lib/x-auth";
import { captureXTimeline } from "../lib/x-capture";
import { useSettingsStore } from "@freed/ui/lib/settings-store";
import { resetProviderPauseState } from "../lib/provider-health";

const XIcon = () => (
  <svg className="w-7 h-7 text-[#a1a1aa]" viewBox="0 0 24 24" fill="currentColor">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.747l7.73-8.835L1.254 2.25H8.08l4.259 5.63 5.905-5.63zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z" />
  </svg>
);

export function XFeedEmptyState() {
  const xAuth = useAppStore((s) => s.xAuth);
  const setXAuth = useAppStore((s) => s.setXAuth);
  const isLoading = useAppStore((s) => s.isLoading);
  const activeFilter = useAppStore((s) => s.activeFilter);
  const storeError = useAppStore((s) => s.error);
  const setError = useAppStore((s) => s.setError);
  const openSettings = useSettingsStore((s) => s.openTo);

  const [syncing, setSyncing] = useState(false);

  const handleSync = async () => {
    const cookies = loadStoredCookies();
    if (!cookies) return;
    setError(null);
    setSyncing(true);
    try {
      await captureXTimeline(cookies);
    } catch (err) {
      console.error("X sync failed:", err);
    } finally {
      setSyncing(false);
    }
  };

  const handleDisconnect = async () => {
    disconnectX();
    await resetProviderPauseState("x");
    setXAuth({ isAuthenticated: false });
    setError(null);
  };

  const syncError = storeError && xAuth.isAuthenticated ? storeError : null;

  // Non-X filter → generic empty state
  if (activeFilter.platform !== "x") {
    return (
      <>
        <div className="w-16 h-16 rounded-full bg-gradient-to-br from-[#3b82f6]/20 to-[#8b5cf6]/20 flex items-center justify-center mb-4">
          <span className="text-2xl">📡</span>
        </div>
        <p className="text-lg font-medium mb-2">All caught up!</p>
        <p className="text-sm text-[#71717a]">No new items to show.</p>
      </>
    );
  }

  // X connected but empty
  if (xAuth.isAuthenticated) {
    return (
      <>
        <div className="w-16 h-16 rounded-full bg-gradient-to-br from-[#3b82f6]/20 to-[#8b5cf6]/20 flex items-center justify-center mb-4">
          <XIcon />
        </div>
        <p className="text-lg font-medium mb-2">All caught up!</p>
        <p className="text-sm text-[#71717a] mb-6">Your X timeline is up to date.</p>
        <div className="flex gap-3">
          <button
            onClick={handleSync}
            disabled={syncing || isLoading}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#8b5cf6]/20 text-[#8b5cf6] hover:bg-[#8b5cf6]/30 disabled:opacity-50 transition-colors font-medium text-sm"
          >
            {syncing ? (
              <>
                <div className="w-3.5 h-3.5 border-2 border-[#8b5cf6] border-t-transparent rounded-full animate-spin" />
                Syncing…
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
            {syncError.includes("401") || syncError.includes("403")
              ? "Your cookies have expired. Reconnect in Settings > Sources > X."
              : syncError}
          </p>
        )}
      </>
    );
  }

  // X not connected — invite to settings
  return (
    <>
      <div className="w-16 h-16 rounded-full bg-gradient-to-br from-[#3b82f6]/20 to-[#8b5cf6]/20 flex items-center justify-center mb-4">
        <XIcon />
      </div>
      <p className="text-lg font-medium mb-2">Connect X / Twitter</p>
      <p className="text-sm text-[#71717a] mb-6 max-w-xs text-center">
        Pull your home timeline into Freed. Set it up in Sources settings.
      </p>
      <button
        onClick={() => openSettings("x")}
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
