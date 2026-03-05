/**
 * XSettingsSection — Settings > Sources > X / Twitter
 *
 * Cookie-based X authentication, manual sync, disconnect, and a per-stage
 * diagnostic panel that surfaces exactly where the pipeline stalls when
 * "All caught up" appears without any data.
 */

import { useState } from "react";
import { useAppStore } from "../lib/store";
import { connectX, loadStoredCookies, disconnectX } from "../lib/x-auth";
import { captureXTimeline } from "../lib/x-capture";
import type { XSyncDiag } from "../lib/x-capture";

// =============================================================================
// Diagnostic Panel
// =============================================================================

interface DiagRowProps {
  label: string;
  value: string;
  /** Highlight amber when a stage produced 0 after a prior stage produced >0 */
  warn?: boolean;
}

function DiagRow({ label, value, warn }: DiagRowProps) {
  return (
    <div className="flex justify-between gap-4">
      <span className={warn ? "text-amber-400" : "text-[#52525b]"}>{label}</span>
      <span className={warn ? "text-amber-400 font-medium" : "text-[#71717a]"}>{value}</span>
    </div>
  );
}

interface DiagPanelProps {
  diag: XSyncDiag;
}

function DiagPanel({ diag }: DiagPanelProps) {
  const [copied, setCopied] = useState(false);

  const copyPreview = () => {
    navigator.clipboard.writeText(diag.rawResponsePreview).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const showRawCopy =
    diag.tweetsExtracted === 0 && diag.rawResponsePreview.length > 0;

  return (
    <details className="group">
      <summary className="text-xs text-[#52525b] hover:text-[#71717a] cursor-pointer select-none list-none flex items-center gap-1">
        <span className="group-open:rotate-90 transition-transform inline-block">›</span>
        Sync details
      </summary>

      <div className="mt-2 space-y-1 text-xs font-mono pl-3 border-l border-white/10">
        <DiagRow
          label="Response"
          value={
            diag.rawResponseBytes > 0
              ? `${diag.rawResponseBytes.toLocaleString()} bytes`
              : "—"
          }
        />
        <DiagRow
          label="Instructions"
          value={diag.instructionsFound.toLocaleString()}
          warn={diag.instructionsFound === 0 && diag.rawResponseBytes > 0}
        />
        <DiagRow
          label="Tweets extracted"
          value={diag.tweetsExtracted.toLocaleString()}
          warn={diag.tweetsExtracted === 0 && diag.instructionsFound > 0}
        />
        <DiagRow
          label="After normalize"
          value={diag.itemsNormalized.toLocaleString()}
          warn={diag.itemsNormalized === 0 && diag.tweetsExtracted > 0}
        />
        <DiagRow
          label="After dedup"
          value={diag.itemsDeduplicated.toLocaleString()}
          warn={diag.itemsDeduplicated === 0 && diag.itemsNormalized > 0}
        />
        <DiagRow
          label="New items added"
          value={diag.itemsAdded.toLocaleString()}
        />

        {diag.errorStage && (
          <p className="text-red-400 pt-1 leading-relaxed">
            Failed at <span className="font-semibold">{diag.errorStage}</span>
            {diag.errorMessage ? `: ${diag.errorMessage}` : ""}
          </p>
        )}

        {showRawCopy && (
          <button
            onClick={copyPreview}
            className="mt-2 text-[10px] px-2 py-1 rounded bg-white/5 text-[#71717a] hover:bg-white/10 hover:text-[#a1a1aa] transition-colors"
          >
            {copied ? "Copied!" : "Copy raw response preview"}
          </button>
        )}
      </div>
    </details>
  );
}

// =============================================================================
// Main Component
// =============================================================================

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
  const [lastDiag, setLastDiag] = useState<XSyncDiag | null>(null);

  const runSync = async (cookies: Parameters<typeof captureXTimeline>[0]) => {
    setSyncing(true);
    setLastDiag(null);
    try {
      const result = await captureXTimeline(cookies);
      setLastDiag(result.diag);
    } catch (err) {
      console.error("X timeline capture failed:", err);
    } finally {
      setSyncing(false);
    }
  };

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
    await runSync(cookies);
  };

  const handleSync = async () => {
    const cookies = loadStoredCookies();
    if (!cookies) return;
    setError(null);
    await runSync(cookies);
  };

  const handleDisconnect = () => {
    disconnectX();
    setXAuth({ isAuthenticated: false });
    setLastDiag(null);
    setError(null);
    setShowForm(false);
  };

  const syncError = storeError && xAuth.isAuthenticated ? storeError : null;

  if (xAuth.isAuthenticated) {
    const statusLine = (() => {
      if (!lastDiag) return null;
      if (lastDiag.errorStage) return null; // error is shown separately
      if (lastDiag.itemsAdded === 0 && lastDiag.tweetsExtracted === 0) {
        return <p className="text-xs text-[#52525b]">Timeline returned no posts.</p>;
      }
      if (lastDiag.itemsAdded === 0) {
        return <p className="text-xs text-[#52525b]">Already up to date.</p>;
      }
      return (
        <p className="text-xs text-[#52525b]">
          Added {lastDiag.itemsAdded.toLocaleString()} new post
          {lastDiag.itemsAdded === 1 ? "" : "s"}.
        </p>
      );
    })();

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
            {syncError.includes("401") || syncError.includes("403") || syncError.includes("auth")
              ? "Your cookies have expired. Disconnect and reconnect with fresh cookies from x.com."
              : syncError}
          </p>
        )}

        {statusLine}

        {lastDiag && <DiagPanel diag={lastDiag} />}

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
