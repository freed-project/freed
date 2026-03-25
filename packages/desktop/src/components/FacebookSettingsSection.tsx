/**
 * FacebookSettingsSection -- Settings > Sources > Facebook
 *
 * Uses the Tauri WebView login flow: clicking "Log in with Facebook"
 * opens a real Facebook login page in a native window. Once the user
 * authenticates, the WebView's cookies are shared with the scraper.
 */

import { useState, useCallback, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import type { FbGroupInfo } from "@freed/shared";
import { useAppStore } from "../lib/store";
import {
  showFbLogin,
  checkFbAuth,
  disconnectFb,
  storeFbAuthState,
} from "../lib/fb-auth";
import { captureFbFeed, captureFbGroups } from "../lib/fb-capture";
import type { FbSyncDiag } from "../lib/fb-capture";
import {
  getFbScraperDebugWindow,
  setFbScraperDebugWindow,
} from "../lib/scraper-prefs";

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

function FbDiagPanel({ diag }: { diag: FbSyncDiag }) {
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

export function FacebookSettingsSection() {
  const fbAuth = useAppStore((s) => s.fbAuth);
  const setFbAuth = useAppStore((s) => s.setFbAuth);
  const fbCapture = useAppStore((s) => s.preferences.fbCapture);
  const updatePreferences = useAppStore((s) => s.updatePreferences);
  const isLoading = useAppStore((s) => s.isLoading);
  const storeError = useAppStore((s) => s.error);
  const setError = useAppStore((s) => s.setError);

  const [syncing, setSyncing] = useState(false);
  const [checking, setChecking] = useState(false);
  const [refreshingGroups, setRefreshingGroups] = useState(false);
  const [lastDiag, setLastDiag] = useState<FbSyncDiag | null>(null);
  const [debugWindow, setDebugWindow] = useState(() => getFbScraperDebugWindow());

  const knownGroups = fbCapture?.knownGroups ?? {};
  const excludedGroupIds = fbCapture?.excludedGroupIds ?? {};
  const groups = Object.values(knownGroups).sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  // Auto-detect login success from the WebView's on_navigation callback
  useEffect(() => {
    const unlisten = listen<{ loggedIn: boolean }>("fb-auth-result", (event) => {
      if (event.payload.loggedIn) {
        const newState = { isAuthenticated: true, lastCheckedAt: Date.now() };
        setFbAuth(newState);
        storeFbAuthState(newState);
      }
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [setFbAuth]);

  const handleLogin = useCallback(async () => {
    setError(null);
    try {
      await showFbLogin();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to open login window");
    }
  }, [setError]);

  const handleCheckAuth = useCallback(async () => {
    setChecking(true);
    setError(null);
    try {
      const loggedIn = await checkFbAuth();
      const newState = { isAuthenticated: loggedIn, lastCheckedAt: Date.now() };
      setFbAuth(newState);
      storeFbAuthState(newState);

      if (!loggedIn) {
        setError("Not logged in. Please log in through the Facebook window first.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Auth check failed");
    } finally {
      setChecking(false);
    }
  }, [setFbAuth, setError]);

  const runSync = useCallback(async () => {
    setSyncing(true);
    setLastDiag(null);
    try {
      const result = await captureFbFeed();
      setLastDiag(result.diag);
    } catch (err) {
      console.error("Facebook feed capture failed:", err);
    } finally {
      setSyncing(false);
    }
  }, []);

  const setExcludedGroups = useCallback(
    async (nextExcludedGroupIds: Record<string, true>) => {
      await updatePreferences({
        fbCapture: {
          knownGroups,
          excludedGroupIds: nextExcludedGroupIds,
        },
      });
    },
    [knownGroups, updatePreferences],
  );

  const handleToggleGroup = useCallback(
    async (group: FbGroupInfo, included: boolean) => {
      const nextExcluded = { ...excludedGroupIds };
      if (included) {
        delete nextExcluded[group.id];
      } else {
        nextExcluded[group.id] = true;
      }
      await setExcludedGroups(nextExcluded);
    },
    [excludedGroupIds, setExcludedGroups],
  );

  const handleSelectAllGroups = useCallback(async () => {
    await setExcludedGroups({});
  }, [setExcludedGroups]);

  const handleDeselectAllGroups = useCallback(async () => {
    const nextExcluded = groups.reduce<Record<string, true>>((acc, group) => {
      acc[group.id] = true;
      return acc;
    }, {});
    await setExcludedGroups(nextExcluded);
  }, [groups, setExcludedGroups]);

  const handleRefreshGroups = useCallback(async () => {
    setRefreshingGroups(true);
    setError(null);
    try {
      await captureFbGroups();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to refresh Facebook groups");
    } finally {
      setRefreshingGroups(false);
    }
  }, [setError]);

  const handleDisconnect = useCallback(async () => {
    try {
      await disconnectFb();
    } catch {
      // Best-effort cleanup
    }
    setFbAuth({ isAuthenticated: false });
    setLastDiag(null);
    setError(null);
  }, [setFbAuth, setError]);

  const syncError = storeError && fbAuth.isAuthenticated ? storeError : null;

  // ── Connected state ──────────────────────────────────────────────────────

  if (fbAuth.isAuthenticated) {
    const statusLine = (() => {
      if (!lastDiag) return null;
      if (lastDiag.errorStage) return null;
      if (lastDiag.itemsAdded === 0 && lastDiag.postsExtracted === 0) {
        return (
          <p className="text-xs text-[#52525b]">
            Feed returned no posts. Facebook may need a moment to load.
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
      <div className="space-y-4">
        <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-white/5">
          <div className="w-2 h-2 rounded-full bg-green-400 shrink-0" />
          <span className="text-sm text-[#a1a1aa]">Connected</span>
        </div>

        <div className="flex gap-2">
          <button
            onClick={runSync}
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
              ? "Scrape timed out. Facebook may be slow to load. Try again."
              : syncError}
          </p>
        )}

        {statusLine}

        {lastDiag && <FbDiagPanel diag={lastDiag} />}

        {groups.length > 0 && (
          <div className="space-y-3 rounded-xl border border-white/10 bg-white/5 p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <p className="text-sm text-[#a1a1aa]">Groups</p>
                <button
                  type="button"
                  onClick={handleRefreshGroups}
                  disabled={refreshingGroups}
                  className="text-xs text-[#71717a] hover:text-[#a1a1aa] disabled:opacity-50 transition-colors"
                >
                  {refreshingGroups ? "Refreshing..." : "Refresh"}
                </button>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => { void handleSelectAllGroups(); }}
                  className="text-xs text-[#71717a] hover:text-[#a1a1aa] transition-colors"
                >
                  Select all
                </button>
                <button
                  type="button"
                  onClick={() => { void handleDeselectAllGroups(); }}
                  className="text-xs text-[#71717a] hover:text-[#a1a1aa] transition-colors"
                >
                  Deselect all
                </button>
              </div>
            </div>

            <div className="space-y-3">
              {groups.map((group) => {
                const included = !excludedGroupIds[group.id];
                return (
                  <Toggle
                    key={group.id}
                    label={group.name}
                    checked={included}
                    onChange={(nextIncluded) => {
                      void handleToggleGroup(group, nextIncluded);
                    }}
                    description={included ? "Included in future syncs" : "Hidden from future syncs"}
                  />
                );
              })}
            </div>
          </div>
        )}

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
                setFbScraperDebugWindow(v);
              }}
              description="Displays the Facebook browser window while syncing. Off by default -- the window runs off-screen so WebKit renders at full speed without interrupting you."
            />
          </div>
        </details>

        <p className="text-xs text-[#52525b] leading-relaxed">
          Freed reads your Facebook feed through a native browser session.
          Your traffic looks identical to normal browsing.
        </p>
      </div>
    );
  }

  // ── Disconnected state ───────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      <p className="text-sm text-[#71717a] leading-relaxed">
        Pull your Facebook feed into Freed. Log in through a native browser
        window. Freed reads your feed the same way you would, so your account
        stays safe.
      </p>
      <div className="flex gap-2">
        <button
          onClick={handleLogin}
          className="text-sm px-4 py-2 rounded-xl bg-[#1877F2]/15 text-[#1877F2] hover:bg-[#1877F2]/25 transition-colors"
        >
          Log in with Facebook
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
  );
}
