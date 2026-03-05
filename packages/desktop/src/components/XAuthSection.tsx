/**
 * XAuthSection — desktop-only sidebar widget for X/Twitter authentication
 *
 * Manages cookie-based X auth, timeline sync, and disconnect actions.
 */

import { useState } from "react";
import { useAppStore } from "../lib/store";
import { connectX, loadStoredCookies, disconnectX } from "../lib/x-auth";
import { captureXTimeline } from "../lib/x-capture";

export function XAuthSection() {
  const xAuth = useAppStore((s) => s.xAuth);
  const setXAuth = useAppStore((s) => s.setXAuth);
  const isLoading = useAppStore((s) => s.isLoading);
  const storeError = useAppStore((s) => s.error);
  const setError = useAppStore((s) => s.setError);
  const [xSyncing, setXSyncing] = useState(false);
  const [showXForm, setShowXForm] = useState(false);
  const [xCt0, setXCt0] = useState("");
  const [xAuthToken, setXAuthToken] = useState("");
  const [xFormError, setXFormError] = useState("");
  const [lastSyncedCount, setLastSyncedCount] = useState<number | null>(null);

  const handleConnectX = async () => {
    setXFormError("");
    setError(null);
    const cookies = connectX(xCt0, xAuthToken);
    if (!cookies) {
      setXFormError("Both ct0 and auth_token are required.");
      return;
    }
    setXAuth({ isAuthenticated: true, cookies });
    setShowXForm(false);
    setXCt0("");
    setXAuthToken("");
    setXSyncing(true);
    try {
      const before = useAppStore.getState().items.filter((i) => i.platform === "x").length;
      await captureXTimeline(cookies);
      const after = useAppStore.getState().items.filter((i) => i.platform === "x").length;
      setLastSyncedCount(after - before);
    } catch (error) {
      console.error("Failed to capture X timeline:", error);
    } finally {
      setXSyncing(false);
    }
  };

  const handleSyncX = async () => {
    const cookies = loadStoredCookies();
    if (!cookies) return;

    setError(null);
    setLastSyncedCount(null);
    setXSyncing(true);
    try {
      const before = useAppStore.getState().items.filter((i) => i.platform === "x").length;
      await captureXTimeline(cookies);
      const after = useAppStore.getState().items.filter((i) => i.platform === "x").length;
      setLastSyncedCount(after - before);
    } catch (error) {
      console.error("Failed to capture X timeline:", error);
    } finally {
      setXSyncing(false);
    }
  };

  const handleDisconnectX = () => {
    disconnectX();
    setXAuth({ isAuthenticated: false });
    setLastSyncedCount(null);
    setError(null);
  };

  // Determine the error to show — capture errors land in storeError
  const syncError = storeError && xAuth.isAuthenticated ? storeError : null;

  return (
    <div className="flex-shrink-0 mb-6 p-3 rounded-xl bg-white/5 border border-[rgba(255,255,255,0.08)]">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium">X / Twitter</span>
        {xAuth.isAuthenticated ? (
          <span className="text-xs text-green-400">Connected</span>
        ) : (
          <span className="text-xs text-[#71717a]">Not connected</span>
        )}
      </div>

      {xAuth.isAuthenticated ? (
        <>
          <div className="flex gap-2">
            <button
              onClick={handleSyncX}
              disabled={xSyncing || isLoading}
              className="flex-1 text-xs px-2 py-1.5 bg-[#8b5cf6]/20 text-[#8b5cf6] rounded-lg hover:bg-[#8b5cf6]/30 disabled:opacity-50 transition-colors"
            >
              {xSyncing ? "Syncing..." : "Sync Now"}
            </button>
            <button
              onClick={handleDisconnectX}
              className="text-xs px-2 py-1.5 bg-red-500/20 text-red-400 rounded-lg hover:bg-red-500/30 transition-colors"
            >
              Disconnect
            </button>
          </div>
          {syncError && (
            <p className="mt-2 text-[10px] text-red-400 leading-relaxed break-words">
              {syncError.includes("401") || syncError.includes("403")
                ? "Cookies expired. Disconnect and reconnect with fresh cookies."
                : syncError}
            </p>
          )}
          {lastSyncedCount !== null && !syncError && (
            <p className="mt-1.5 text-[10px] text-[#71717a]">
              {lastSyncedCount === 0
                ? "Already up to date."
                : `Added ${lastSyncedCount.toLocaleString()} new post${lastSyncedCount === 1 ? "" : "s"}.`}
            </p>
          )}
        </>
      ) : showXForm ? (
        <div className="space-y-2">
          <div className="text-[10px] text-[#71717a] leading-relaxed space-y-1">
            <p className="font-medium text-[#a1a1aa]">How to get your cookies:</p>
            <ol className="list-decimal list-inside space-y-0.5">
              <li>Log in to <span className="text-white">x.com</span> in Chrome</li>
              <li>Open DevTools (⌥⌘I) → Application tab</li>
              <li>Expand Cookies → click <span className="text-white">https://x.com</span></li>
              <li>Copy the value for <span className="font-mono text-[#c4b5fd]">ct0</span></li>
              <li>Copy the value for <span className="font-mono text-[#c4b5fd]">auth_token</span></li>
            </ol>
          </div>
          <input
            type="text"
            placeholder="ct0 value"
            value={xCt0}
            onChange={(e) => setXCt0(e.target.value)}
            className="w-full text-xs px-2 py-1.5 bg-white/5 border border-[rgba(255,255,255,0.1)] rounded-lg text-white placeholder-[#52525b] focus:outline-none focus:border-[#8b5cf6]/50"
          />
          <input
            type="text"
            placeholder="auth_token value"
            value={xAuthToken}
            onChange={(e) => setXAuthToken(e.target.value)}
            className="w-full text-xs px-2 py-1.5 bg-white/5 border border-[rgba(255,255,255,0.1)] rounded-lg text-white placeholder-[#52525b] focus:outline-none focus:border-[#8b5cf6]/50"
          />
          {xFormError && (
            <p className="text-[10px] text-red-400">{xFormError}</p>
          )}
          <div className="flex gap-2">
            <button
              onClick={handleConnectX}
              disabled={!xCt0 || !xAuthToken}
              className="flex-1 text-xs px-2 py-1.5 bg-[#8b5cf6]/20 text-[#8b5cf6] rounded-lg hover:bg-[#8b5cf6]/30 disabled:opacity-40 transition-colors"
            >
              Connect
            </button>
            <button
              onClick={() => { setShowXForm(false); setXFormError(""); }}
              className="text-xs px-2 py-1.5 bg-white/5 text-[#71717a] rounded-lg hover:bg-white/10 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowXForm(true)}
          className="w-full text-xs px-2 py-1.5 bg-[#8b5cf6]/20 text-[#8b5cf6] rounded-lg hover:bg-[#8b5cf6]/30 transition-colors"
        >
          Connect X Account
        </button>
      )}
    </div>
  );
}
