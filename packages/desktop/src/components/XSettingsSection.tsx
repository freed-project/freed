/**
 * XSettingsSection — Settings > Sources > X / Twitter
 *
 * Cookie-based X authentication, manual sync, and disconnect.
 * Mounted as XSettingsContent in the desktop PlatformConfig.
 */

import { useState } from "react";
import { useAppStore } from "../lib/store";
import { connectX, loadStoredCookies, disconnectX } from "../lib/x-auth";
import { captureXTimeline } from "../lib/x-capture";

export function XSettingsSection() {
  const xAuth = useAppStore((s) => s.xAuth);
  const setXAuth = useAppStore((s) => s.setXAuth);
  const isLoading = useAppStore((s) => s.isLoading);
  const storeError = useAppStore((s) => s.error);
  const setError = useAppStore((s) => s.setError);

  const [syncing, setSyncing] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [ct0, setCt0] = useState("");
  const [authToken, setAuthToken] = useState("");
  const [formError, setFormError] = useState("");
  const [lastCount, setLastCount] = useState<number | null>(null);

  const handleConnect = async () => {
    setFormError("");
    setError(null);
    const cookies = connectX(ct0, authToken);
    if (!cookies) {
      setFormError("Both ct0 and auth_token are required.");
      return;
    }
    setXAuth({ isAuthenticated: true, cookies });
    setShowForm(false);
    setCt0("");
    setAuthToken("");
    setSyncing(true);
    try {
      const before = useAppStore.getState().items.filter((i) => i.platform === "x").length;
      await captureXTimeline(cookies);
      const after = useAppStore.getState().items.filter((i) => i.platform === "x").length;
      setLastCount(after - before);
    } catch (err) {
      console.error("X timeline capture failed:", err);
    } finally {
      setSyncing(false);
    }
  };

  const handleSync = async () => {
    const cookies = loadStoredCookies();
    if (!cookies) return;
    setError(null);
    setLastCount(null);
    setSyncing(true);
    try {
      const before = useAppStore.getState().items.filter((i) => i.platform === "x").length;
      await captureXTimeline(cookies);
      const after = useAppStore.getState().items.filter((i) => i.platform === "x").length;
      setLastCount(after - before);
    } catch (err) {
      console.error("X timeline capture failed:", err);
    } finally {
      setSyncing(false);
    }
  };

  const handleDisconnect = () => {
    disconnectX();
    setXAuth({ isAuthenticated: false });
    setLastCount(null);
    setError(null);
    setShowForm(false);
  };

  const syncError = storeError && xAuth.isAuthenticated ? storeError : null;

  if (xAuth.isAuthenticated) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-white/5">
          <div className="w-2 h-2 rounded-full bg-green-400 shrink-0" />
          <span className="text-sm text-[#a1a1aa]">Connected</span>
        </div>

        <div className="flex gap-2">
          <button
            onClick={handleSync}
            disabled={syncing || isLoading}
            className="flex-1 text-sm px-3 py-2 rounded-xl bg-[#8b5cf6]/15 text-[#8b5cf6] hover:bg-[#8b5cf6]/25 disabled:opacity-50 transition-colors"
          >
            {syncing ? "Syncing..." : "Sync Now"}
          </button>
          <button
            onClick={handleDisconnect}
            className="text-sm px-3 py-2 rounded-xl bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
          >
            Disconnect
          </button>
        </div>

        {syncError && (
          <p className="text-xs text-red-400 leading-relaxed">
            {syncError.includes("401") || syncError.includes("403")
              ? "Your cookies have expired. Disconnect and reconnect with fresh cookies from x.com."
              : syncError}
          </p>
        )}
        {lastCount !== null && !syncError && (
          <p className="text-xs text-[#52525b]">
            {lastCount === 0
              ? "Already up to date."
              : `Added ${lastCount.toLocaleString()} new post${lastCount === 1 ? "" : "s"}.`}
          </p>
        )}

        <p className="text-xs text-[#52525b] leading-relaxed">
          Freed syncs your home timeline every 30 minutes while the app is open.
          Cookies expire periodically — reconnect when sync stops working.
        </p>
      </div>
    );
  }

  if (showForm) {
    return (
      <div className="space-y-4">
        <div className="p-3 rounded-xl bg-white/5 text-xs text-[#a1a1aa] leading-relaxed space-y-2">
          <p className="font-medium text-white">How to get your cookies:</p>
          <ol className="list-decimal list-inside space-y-1">
            <li>Log in to <span className="text-white font-medium">x.com</span> in Chrome</li>
            <li>Open DevTools with <kbd className="px-1 py-0.5 bg-white/10 rounded text-[10px]">⌥⌘I</kbd></li>
            <li>Click the <span className="text-white">Application</span> tab</li>
            <li>Expand <span className="text-white">Cookies</span> → select <span className="font-mono text-[10px] text-[#c4b5fd]">https://x.com</span></li>
            <li>Copy the value for <span className="font-mono text-[#c4b5fd]">ct0</span></li>
            <li>Copy the value for <span className="font-mono text-[#c4b5fd]">auth_token</span></li>
          </ol>
        </div>

        <input
          type="text"
          placeholder="ct0 value"
          value={ct0}
          onChange={(e) => setCt0(e.target.value)}
          className="w-full text-sm px-3 py-2 bg-white/5 border border-[rgba(255,255,255,0.1)] rounded-xl text-white placeholder-[#52525b] focus:outline-none focus:border-[#8b5cf6]/50"
        />
        <input
          type="text"
          placeholder="auth_token value"
          value={authToken}
          onChange={(e) => setAuthToken(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleConnect(); }}
          className="w-full text-sm px-3 py-2 bg-white/5 border border-[rgba(255,255,255,0.1)] rounded-xl text-white placeholder-[#52525b] focus:outline-none focus:border-[#8b5cf6]/50"
        />

        {formError && <p className="text-xs text-red-400">{formError}</p>}

        <div className="flex gap-2">
          <button
            onClick={handleConnect}
            disabled={!ct0 || !authToken}
            className="flex-1 text-sm px-3 py-2 rounded-xl bg-[#8b5cf6]/15 text-[#8b5cf6] hover:bg-[#8b5cf6]/25 disabled:opacity-40 transition-colors"
          >
            Connect
          </button>
          <button
            onClick={() => { setShowForm(false); setFormError(""); }}
            className="text-sm px-3 py-2 rounded-xl bg-white/5 text-[#71717a] hover:bg-white/10 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-[#71717a] leading-relaxed">
        Pull your home timeline into Freed. Freed uses your existing browser session
        — no developer account or API key needed.
      </p>
      <button
        onClick={() => setShowForm(true)}
        className="text-sm px-4 py-2 rounded-xl bg-[#8b5cf6]/15 text-[#8b5cf6] hover:bg-[#8b5cf6]/25 transition-colors"
      >
        Connect X Account
      </button>
    </div>
  );
}
