/**
 * LinkedInSettingsSection -- Settings > Sources > LinkedIn
 *
 * Uses the Tauri WebView login flow: clicking "Log in with LinkedIn"
 * opens a real LinkedIn login page in a native window. Once the user
 * authenticates, the WebView's cookies are shared with the scraper.
 */

import { useState, useCallback, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useAppStore } from "../lib/store";
import {
  showLiLogin,
  checkLiAuth,
  disconnectLi,
  storeLiAuthState,
} from "../lib/li-auth";
import { captureLiFeed } from "../lib/li-capture";
import type { LiSyncDiag } from "../lib/li-capture";
import {
  getLiScraperDebugWindow,
  setLiScraperDebugWindow,
} from "../lib/scraper-prefs";
import { useProviderRiskGate } from "../hooks/useProviderRiskGate";

// =============================================================================
// Diagnostic Panel
// =============================================================================

interface DiagRowProps {
  label: string;
  value: string;
  warn?: boolean;
}

function DiagRow({ label, value, warn }: DiagRowProps) {
  return (
    <div className="flex justify-between gap-4">
      <span className={warn ? "text-amber-400" : "text-[#52525b]"}>{label}</span>
      <span className={warn ? "text-amber-400 font-medium" : "text-[#71717a]"}>
        {value}
      </span>
    </div>
  );
}

function LiDiagPanel({ diag }: { diag: LiSyncDiag }) {
  return (
    <details className="group">
      <summary className="text-xs text-[#52525b] hover:text-[#71717a] cursor-pointer select-none list-none flex items-center gap-1">
        <span className="group-open:rotate-90 transition-transform inline-block">
          ›
        </span>
        Sync details
      </summary>

      <div className="mt-2 space-y-1 text-xs font-mono pl-3 border-l border-white/10">
        <DiagRow
          label="Posts extracted"
          value={diag.postsExtracted.toLocaleString()}
          warn={diag.postsExtracted === 0}
        />
        <DiagRow
          label="After normalize"
          value={diag.itemsNormalized.toLocaleString()}
          warn={diag.itemsNormalized === 0 && diag.postsExtracted > 0}
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
            Failed at{" "}
            <span className="font-semibold">{diag.errorStage}</span>
            {diag.errorMessage ? `: ${diag.errorMessage}` : ""}
          </p>
        )}
      </div>
    </details>
  );
}

// =============================================================================
// Toggle
// =============================================================================

function Toggle({
  label,
  checked,
  onChange,
  description,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  description?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="text-sm text-[#a1a1aa]">{label}</p>
        {description && (
          <p className="text-xs text-[#52525b] mt-0.5">{description}</p>
        )}
      </div>
      <button
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative shrink-0 w-9 h-5 rounded-full transition-colors ${
          checked ? "bg-[#8b5cf6]" : "bg-white/10"
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
            checked ? "translate-x-4" : "translate-x-0"
          }`}
        />
      </button>
    </div>
  );
}

// =============================================================================
// Main Component
// =============================================================================

export function LinkedInSettingsSection() {
  const liAuth = useAppStore((s) => s.liAuth);
  const setLiAuth = useAppStore((s) => s.setLiAuth);
  const isLoading = useAppStore((s) => s.isLoading);
  const storeError = useAppStore((s) => s.error);
  const setError = useAppStore((s) => s.setError);

  const [syncing, setSyncing] = useState(false);
  const [checking, setChecking] = useState(false);
  const [lastDiag, setLastDiag] = useState<LiSyncDiag | null>(null);
  const [debugWindow, setDebugWindow] = useState(() => getLiScraperDebugWindow());
  const { confirm, dialog } = useProviderRiskGate("linkedin");

  const runSync = useCallback(async () => {
    setSyncing(true);
    setLastDiag(null);
    try {
      const result = await captureLiFeed();
      setLastDiag(result.diag);
    } catch (err) {
      console.error("LinkedIn feed capture failed:", err);
    } finally {
      setSyncing(false);
    }
  }, []);

  // Auto-detect login success from the WebView's on_navigation callback
  useEffect(() => {
    const unlisten = listen<{ loggedIn: boolean }>("li-auth-result", (event) => {
      if (event.payload.loggedIn) {
        const newState = { isAuthenticated: true, lastCheckedAt: Date.now() };
        setLiAuth(newState);
        storeLiAuthState(newState);
        if (!liAuth.isAuthenticated) {
          void runSync();
        }
      }
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [liAuth.isAuthenticated, runSync, setLiAuth]);

  const handleLogin = useCallback(async () => {
    await confirm(async () => {
      setError(null);
      try {
        await showLiLogin();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to open login window");
      }
    });
  }, [confirm, setError]);

  const handleCheckAuth = useCallback(async () => {
    await confirm(async () => {
      setChecking(true);
      setError(null);
      try {
        const loggedIn = await checkLiAuth();
        const newState = { isAuthenticated: loggedIn, lastCheckedAt: Date.now() };
        setLiAuth(newState);
        storeLiAuthState(newState);

        if (!loggedIn) {
          setError("Not logged in. Please log in through the LinkedIn window first.");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Auth check failed");
      } finally {
        setChecking(false);
      }
    });
  }, [confirm, setLiAuth, setError]);

  const handleDisconnect = useCallback(async () => {
    try {
      await disconnectLi();
    } catch {
      // Best-effort cleanup
    }
    setLiAuth({ isAuthenticated: false });
    setLastDiag(null);
    setError(null);
  }, [setLiAuth, setError]);

  const syncError = storeError && liAuth.isAuthenticated ? storeError : null;

  // ── Connected state ──────────────────────────────────────────────────────

  if (liAuth.isAuthenticated) {
    const statusLine = (() => {
      if (!lastDiag) return null;
      if (lastDiag.errorStage) return null;
      if (lastDiag.itemsAdded === 0 && lastDiag.postsExtracted === 0) {
        return (
          <p className="text-xs text-[#52525b]">
            Feed returned no posts. LinkedIn may need a moment to load.
          </p>
        );
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
      <>
      <div className="space-y-4">
        <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-white/5">
          <div className="w-2 h-2 rounded-full bg-green-400 shrink-0" />
          <span className="text-sm text-[#a1a1aa]">Connected</span>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => {
              void confirm(runSync);
            }}
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
            {syncError.includes("timeout")
              ? "Scrape timed out. LinkedIn may be slow to load. Try again."
              : syncError}
          </p>
        )}

        {statusLine}

        {lastDiag && <LiDiagPanel diag={lastDiag} />}

        <details className="group">
          <summary className="text-xs text-[#52525b] hover:text-[#71717a] cursor-pointer select-none list-none flex items-center gap-1">
            <span className="group-open:rotate-90 transition-transform inline-block">›</span>
            Advanced
          </summary>
          <div className="mt-3 pl-3 border-l border-white/10">
            <Toggle
              label="Show scraper window"
              checked={debugWindow}
              onChange={(v) => {
                setDebugWindow(v);
                setLiScraperDebugWindow(v);
              }}
              description="Displays the LinkedIn browser window while syncing. Off by default. The window runs off-screen so WebKit renders at full speed without interrupting you."
            />
          </div>
        </details>

        <p className="text-xs text-[#52525b] leading-relaxed">
          Freed reads your LinkedIn feed through a native browser session.
          Your traffic looks identical to normal browsing.
        </p>
      </div>
      {dialog}
      </>
    );
  }

  // ── Disconnected state ───────────────────────────────────────────────────

  return (
    <>
    <div className="space-y-4">
      <p className="text-sm text-[#71717a] leading-relaxed">
        Pull your LinkedIn feed into Freed. Log in through a native browser
        window. Freed reads your feed the same way you would, so your account
        stays safe.
      </p>
      <div className="flex gap-2">
        <button
          onClick={handleLogin}
          className="text-sm px-4 py-2 rounded-xl bg-[#0A66C2]/15 text-[#0A66C2] hover:bg-[#0A66C2]/25 transition-colors"
        >
          Log in with LinkedIn
        </button>
        <button
          onClick={handleCheckAuth}
          disabled={checking}
          className="text-sm px-4 py-2 rounded-xl bg-white/5 text-[#71717a] hover:bg-white/10 disabled:opacity-50 transition-colors"
        >
          {checking ? "Checking..." : "Check Connection"}
        </button>
      </div>
    </div>
    {dialog}
    </>
  );
}
