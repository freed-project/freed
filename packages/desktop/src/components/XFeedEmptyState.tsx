/**
 * XFeedEmptyState — shown in the feed blank state when no items are available.
 *
 * When the X platform filter is active and X is not authenticated, renders the
 * full X connection flow inline. When authenticated but empty, offers a manual
 * sync trigger. For all other filters, falls back to the generic "All caught up"
 * message.
 */

import { useState } from "react";
import { useAppStore } from "../lib/store";
import { connectX, loadStoredCookies, disconnectX } from "../lib/x-auth";
import { captureXTimeline } from "../lib/x-capture";

export function XFeedEmptyState() {
  const xAuth = useAppStore((s) => s.xAuth);
  const setXAuth = useAppStore((s) => s.setXAuth);
  const isLoading = useAppStore((s) => s.isLoading);
  const activeFilter = useAppStore((s) => s.activeFilter);

  const [xSyncing, setXSyncing] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [ct0, setCt0] = useState("");
  const [authToken, setAuthToken] = useState("");
  const [formError, setFormError] = useState("");

  const handleConnect = async () => {
    setFormError("");
    const cookies = connectX(ct0, authToken);
    if (!cookies) {
      setFormError("Both ct0 and auth_token are required.");
      return;
    }
    setXAuth({ isAuthenticated: true, cookies });
    setShowForm(false);
    setCt0("");
    setAuthToken("");
    setXSyncing(true);
    try {
      await captureXTimeline(cookies);
    } catch (err) {
      console.error("Failed to capture X timeline:", err);
    } finally {
      setXSyncing(false);
    }
  };

  const handleSync = async () => {
    const cookies = loadStoredCookies();
    if (!cookies) return;
    setXSyncing(true);
    try {
      await captureXTimeline(cookies);
    } catch (err) {
      console.error("Failed to capture X timeline:", err);
    } finally {
      setXSyncing(false);
    }
  };

  const handleDisconnect = () => {
    disconnectX();
    setXAuth({ isAuthenticated: false });
  };

  // Non-X filter → generic empty state with icon
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

  // X is connected but empty
  if (xAuth.isAuthenticated) {
    return (
      <>
        <div className="w-16 h-16 rounded-full bg-gradient-to-br from-[#3b82f6]/20 to-[#8b5cf6]/20 flex items-center justify-center mb-4">
          <svg className="w-7 h-7 text-[#a1a1aa]" viewBox="0 0 24 24" fill="currentColor">
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.747l7.73-8.835L1.254 2.25H8.08l4.259 5.63 5.905-5.63zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z" />
          </svg>
        </div>
        <p className="text-lg font-medium mb-2">All caught up!</p>
        <p className="text-sm text-[#71717a] mb-6">Your X timeline is up to date.</p>
        <div className="flex gap-3">
          <button
            onClick={handleSync}
            disabled={xSyncing || isLoading}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#8b5cf6]/20 text-[#8b5cf6] hover:bg-[#8b5cf6]/30 disabled:opacity-50 transition-colors font-medium text-sm"
          >
            {xSyncing ? (
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
      </>
    );
  }

  // X not connected — show connection flow
  return (
    <>
      <div className="w-16 h-16 rounded-full bg-gradient-to-br from-[#3b82f6]/20 to-[#8b5cf6]/20 flex items-center justify-center mb-4">
        <svg className="w-7 h-7 text-[#a1a1aa]" viewBox="0 0 24 24" fill="currentColor">
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.747l7.73-8.835L1.254 2.25H8.08l4.259 5.63 5.905-5.63zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z" />
        </svg>
      </div>
      <p className="text-lg font-medium mb-2">Connect X / Twitter</p>
      <p className="text-sm text-[#71717a] mb-6 max-w-xs">
        Link your X account to pull your timeline into Freed.
      </p>

      {showForm ? (
        <div className="w-full max-w-xs space-y-3 text-left">
          <p className="text-[11px] text-[#71717a] leading-relaxed">
            Open x.com → DevTools → Application → Cookies → x.com
          </p>
          <input
            type="text"
            placeholder="ct0 cookie value"
            value={ct0}
            onChange={(e) => setCt0(e.target.value)}
            className="w-full text-sm px-3 py-2 bg-white/5 border border-[rgba(255,255,255,0.1)] rounded-xl text-white placeholder-[#52525b] focus:outline-none focus:border-[#8b5cf6]/60"
          />
          <input
            type="text"
            placeholder="auth_token cookie value"
            value={authToken}
            onChange={(e) => setAuthToken(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleConnect(); }}
            className="w-full text-sm px-3 py-2 bg-white/5 border border-[rgba(255,255,255,0.1)] rounded-xl text-white placeholder-[#52525b] focus:outline-none focus:border-[#8b5cf6]/60"
          />
          {formError && (
            <p className="text-xs text-red-400">{formError}</p>
          )}
          <div className="flex gap-2">
            <button
              onClick={handleConnect}
              className="flex-1 px-3 py-2.5 rounded-xl bg-[#8b5cf6]/20 text-[#8b5cf6] hover:bg-[#8b5cf6]/30 transition-colors font-medium text-sm"
            >
              Connect
            </button>
            <button
              onClick={() => { setShowForm(false); setFormError(""); }}
              className="px-3 py-2.5 rounded-xl bg-white/5 text-[#71717a] hover:bg-white/10 transition-colors text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#8b5cf6]/20 text-[#8b5cf6] hover:bg-[#8b5cf6]/30 transition-colors font-medium text-sm"
        >
          Connect X Account
        </button>
      )}
    </>
  );
}
