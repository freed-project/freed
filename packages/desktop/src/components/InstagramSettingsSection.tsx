/**
 * InstagramSettingsSection -- Settings > Sources > Instagram
 *
 * Uses the Tauri WebView login flow: clicking "Log in with Instagram"
 * opens a real Instagram login page in a native window. Once the user
 * authenticates, the WebView's cookies are shared with the scraper.
 */

import { useState, useCallback, useEffect } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { SyncProviderSectionProps } from "@freed/ui/context";
import { useDebugStore } from "@freed/ui/lib/debug-store";
import {
  getProviderStatusLabel,
  getProviderStatusTone,
} from "@freed/ui/lib/provider-status";
import { ProviderStatusIndicator } from "@freed/ui/components/ProviderStatusIndicator";
import { useAppStore } from "../lib/store";
import {
  showIgLogin,
  checkIgAuth,
  disconnectIg,
  storeIgAuthState,
} from "../lib/instagram-auth";
import { captureIgFeed } from "../lib/instagram-capture";
import type { IgSyncDiag } from "../lib/instagram-capture";
import {
  getIgScraperWindowMode,
  setIgScraperWindowMode,
} from "../lib/scraper-prefs";
import {
  formatProviderReconnectMessage,
  needsProviderReconnect,
} from "../lib/provider-auth-errors";
import { useProviderRiskGate } from "../hooks/useProviderRiskGate";
import { ScraperWindowModeControl } from "./ScraperWindowModeControl";
import { ProviderHealthSectionSummary } from "./ProviderHealthSectionSummary";
import { ProviderSyncActionButton } from "./ProviderSyncActionButton";
import { SyncProviderSectionSurface } from "./SyncProviderSectionSurface";
import { withProviderSyncing } from "../lib/store";
import { clearProviderPause, resetProviderPauseState } from "../lib/provider-health";
import { MediaVaultSettingsCard } from "./MediaVaultSettingsCard";

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

function IgDiagPanel({ diag }: { diag: IgSyncDiag }) {
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

export function InstagramSettingsSection({
  surface = "settings",
}: SyncProviderSectionProps) {
  const igAuth = useAppStore((s) => s.igAuth);
  const setIgAuth = useAppStore((s) => s.setIgAuth);
  const isLoading = useAppStore((s) => s.isLoading);
  const storeError = useAppStore((s) => s.error);
  const setError = useAppStore((s) => s.setError);
  const items = useAppStore((s) => s.items);
  const syncing = useAppStore((s) => (s.providerSyncCounts.instagram ?? 0) > 0);
  const healthSnapshot = useDebugStore((s) => s.health?.providers.instagram ?? null);

  const [checking, setChecking] = useState(false);
  const [lastDiag, setLastDiag] = useState<IgSyncDiag | null>(null);
  const [windowMode, setWindowMode] = useState(() => getIgScraperWindowMode());
  const { confirm, dialog } = useProviderRiskGate("instagram");

  // Auto-detect login success from the WebView's on_navigation callback
  useEffect(() => {
    if (!isTauri()) return;

    const unlisten = listen<{ loggedIn: boolean }>("ig-auth-result", (event) => {
      if (event.payload.loggedIn) {
        const newState = { isAuthenticated: true, lastCheckedAt: Date.now() };
        setIgAuth(newState);
        storeIgAuthState(newState);
      }
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [setIgAuth]);

  const handleLogin = useCallback(async () => {
    await confirm(async () => {
      setError(null);
      try {
        await showIgLogin();
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
        const loggedIn = await checkIgAuth();
        const newState = { isAuthenticated: loggedIn, lastCheckedAt: Date.now() };
        setIgAuth(newState);
        storeIgAuthState(newState);

        if (!loggedIn) {
          setError("Not logged in. Please log in through the Instagram window first.");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Auth check failed");
      } finally {
        setChecking(false);
      }
    });
  }, [confirm, setIgAuth, setError]);

  const runSync = useCallback(async () => {
    setLastDiag(null);
    try {
      const result = await withProviderSyncing("instagram", () => captureIgFeed());
      setLastDiag(result.diag);
    } catch (err) {
      console.error("Instagram feed capture failed:", err);
    }
  }, []);

  const handleDisconnect = useCallback(async () => {
    try {
      await disconnectIg();
    } catch {
      // Best-effort cleanup
    }
    await resetProviderPauseState("instagram");
    setIgAuth({ isAuthenticated: false });
    setLastDiag(null);
    setError(null);
  }, [setIgAuth, setError]);

  const syncError = storeError && igAuth.isAuthenticated ? storeError : null;
  const authError = igAuth.lastCaptureError ?? syncError;
  const needsReconnect = needsProviderReconnect(authError);
  const statusTone = getProviderStatusTone({
    isConnected: igAuth.isAuthenticated,
    authError,
    snapshot: healthSnapshot,
  });
  const statusLabel = getProviderStatusLabel({
    isConnected: igAuth.isAuthenticated,
    authError,
    snapshot: healthSnapshot,
  });
  const isPaused = !!healthSnapshot?.pause && healthSnapshot.pause.pausedUntil > Date.now();
  // ── Connected state ──────────────────────────────────────────────────────

  if (igAuth.isAuthenticated) {
    const statusLine = (() => {
      if (!lastDiag) return null;
      if (lastDiag.errorStage) return null;
      if (lastDiag.itemsAdded === 0 && lastDiag.postsExtracted === 0) {
        return (
          <p className="text-xs text-[#52525b]">
            Feed returned no posts. Instagram may need a moment to load.
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
      <SyncProviderSectionSurface surface={surface} title="Instagram">
        <div className="space-y-4">
          <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-white/5">
            <ProviderStatusIndicator
              tone={statusTone}
              syncing={syncing}
              label={statusLabel}
              testId="provider-status-instagram"
              size="sm"
            />
            <span className="text-sm text-[#a1a1aa]">
              {statusLabel}
            </span>
          </div>

          <div className="flex gap-2">
            <ProviderSyncActionButton
              onClick={() => {
                if (needsReconnect) {
                  void handleLogin();
                  return;
                }
                void confirm(async () => {
                  if (isPaused) {
                    await clearProviderPause("instagram");
                  }
                  await runSync();
                });
              }}
              busy={syncing}
              busyLabel={needsReconnect ? "Reconnecting..." : isPaused ? "Resuming..." : "Syncing"}
              disabled={
                (!needsReconnect && (syncing || isLoading)) ||
                (needsReconnect && isLoading)
              }
              testId="provider-sync-action-instagram"
            >
              {needsReconnect ? "Reconnect Instagram" : isPaused ? "Resume Now" : "Sync Now"}
            </ProviderSyncActionButton>
            <button
              onClick={handleDisconnect}
              className="text-sm px-3 py-2 rounded-xl bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
            >
              Disconnect
            </button>
          </div>

          {needsReconnect && (
            <p className="text-xs text-red-400 leading-relaxed">
              {formatProviderReconnectMessage("Instagram", authError)}
            </p>
          )}

          {syncError && !needsReconnect && (
            <p className="text-xs text-red-400 leading-relaxed">
              {syncError.includes("timeout")
                ? "Scrape timed out. Instagram may be slow to load. Try again."
                : syncError}
            </p>
          )}

          <ProviderHealthSectionSummary provider="instagram" />

          {statusLine}

          {lastDiag && <IgDiagPanel diag={lastDiag} />}

          <MediaVaultSettingsCard
            provider="instagram"
            providerLabel="Instagram"
            items={items}
            authenticated={igAuth.isAuthenticated}
          />

          <details className="group">
            <summary className="text-xs text-[#52525b] hover:text-[#71717a] cursor-pointer select-none list-none flex items-center gap-1">
              <span className="group-open:rotate-90 transition-transform inline-block">›</span>
              Advanced
            </summary>
            <div className="mt-3 pl-3 border-l border-white/10">
              <ScraperWindowModeControl
                sourceLabel="Instagram"
                mode={windowMode}
                onChange={(nextMode) => {
                  setWindowMode(nextMode);
                  setIgScraperWindowMode(nextMode);
                }}
              />
            </div>
          </details>

          <p className="text-xs text-[#52525b] leading-relaxed">
            Freed reads your Instagram feed through a native browser session.
            Your traffic looks identical to normal browsing.
          </p>
        </div>
      </SyncProviderSectionSurface>
      {dialog}
      </>
    );
  }

  // ── Disconnected state ───────────────────────────────────────────────────

  return (
    <>
    <SyncProviderSectionSurface surface={surface} title="Instagram">
      <div className="space-y-4">
        <p className="text-sm text-[#71717a] leading-relaxed">
          {needsReconnect
            ? "Your Instagram session is no longer valid. Sign in again to restore sync."
            : "Pull your Instagram feed into Freed. Log in through a native browser window. Freed reads your feed the same way you would, so your account stays safe."}
        </p>
        <div className="flex gap-2">
          <button
            onClick={handleLogin}
            className="text-sm px-4 py-2 rounded-xl bg-[#E1306C]/15 text-[#E1306C] hover:bg-[#E1306C]/25 transition-colors"
          >
            {needsReconnect ? "Reconnect Instagram" : "Log in with Instagram"}
          </button>
          <button
            onClick={handleCheckAuth}
            disabled={checking}
            className="text-sm px-4 py-2 rounded-xl bg-white/5 text-[#71717a] hover:bg-white/10 disabled:opacity-50 transition-colors"
          >
            {checking ? "Checking..." : "Check Connection"}
          </button>
        </div>
        {needsReconnect && authError && (
          <p className="text-xs text-amber-400 leading-relaxed">
            {formatProviderReconnectMessage("Instagram", authError)}
          </p>
        )}
        <ProviderHealthSectionSummary provider="instagram" />
      </div>
    </SyncProviderSectionSurface>
    {dialog}
    </>
  );
}
