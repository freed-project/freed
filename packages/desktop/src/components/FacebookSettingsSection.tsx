/**
 * FacebookSettingsSection -- Settings > Sources > Facebook
 *
 * Uses the Tauri WebView login flow: clicking "Log in with Facebook"
 * opens a real Facebook login page in a native window. Once the user
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
import { SettingsListPanel } from "@freed/ui/components/settings/SettingsListPanel";
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
  getFbScraperWindowMode,
  setFbScraperWindowMode,
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
import { socialProviderCopy } from "../lib/social-provider-copy";

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

function splitFacebookGroupName(rawName: string): {
  title: string;
  lastActiveText?: string;
} {
  const trimmed = rawName.trim();
  const match = trimmed.match(/^(.*?)(last active.+)$/i);
  if (!match) {
    return { title: trimmed };
  }

  const title = match[1]?.trim();
  const lastActiveText = match[2]?.trim();

  if (!title || !lastActiveText) {
    return { title: trimmed };
  }

  return {
    title,
    lastActiveText: lastActiveText.charAt(0).toUpperCase() + lastActiveText.slice(1),
  };
}

function Toggle({
  label,
  checked,
  onChange,
  description,
  meta,
  testId,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  description?: string;
  meta?: string;
  testId?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <p
            data-testid={testId ? `${testId}-label` : undefined}
            className="min-w-0 text-sm text-[#a1a1aa] truncate"
          >
            {label}
          </p>
          {meta ? (
            <p
              data-testid={testId ? `${testId}-meta` : undefined}
              className="shrink-0 pt-0.5 text-[11px] text-[#71717a] text-right"
            >
              {meta}
            </p>
          ) : null}
        </div>
        {description ? (
          <p className="text-xs text-[#52525b] mt-0.5">{description}</p>
        ) : null}
      </div>
      <button
        type="button"
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

export function FacebookSettingsSection({
  surface = "settings",
}: SyncProviderSectionProps) {
  const fbAuth = useAppStore((s) => s.fbAuth);
  const setFbAuth = useAppStore((s) => s.setFbAuth);
  const fbCapture = useAppStore((s) => s.preferences.fbCapture);
  const updatePreferences = useAppStore((s) => s.updatePreferences);
  const isLoading = useAppStore((s) => s.isLoading);
  const items = useAppStore((s) => s.items);
  const syncing = useAppStore((s) => (s.providerSyncCounts.facebook ?? 0) > 0);
  const healthSnapshot = useDebugStore((s) => s.health?.providers.facebook ?? null);

  const [checking, setChecking] = useState(false);
  const [refreshingGroups, setRefreshingGroups] = useState(false);
  const [lastDiag, setLastDiag] = useState<FbSyncDiag | null>(null);
  const [windowMode, setWindowMode] = useState(() => getFbScraperWindowMode());
  const [actionError, setActionError] = useState<string | null>(null);
  const copy = socialProviderCopy("facebook");
  const { confirm, dialog } = useProviderRiskGate("facebook");

  const knownGroups = fbCapture?.knownGroups ?? {};
  const excludedGroupIds = fbCapture?.excludedGroupIds ?? {};
  const groups = Object.values(knownGroups).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const activeGroupCount = groups.filter((group) => !excludedGroupIds[group.id]).length;

  // Auto-detect login success from the WebView's on_navigation callback
  useEffect(() => {
    if (!isTauri()) return;

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
    await confirm(async () => {
      setActionError(null);
      try {
        await showFbLogin();
      } catch (err) {
        setActionError(err instanceof Error ? err.message : "Failed to open login window");
      }
    });
  }, [confirm]);

  const handleCheckAuth = useCallback(async () => {
    await confirm(async () => {
      setChecking(true);
      setActionError(null);
      try {
        const loggedIn = await checkFbAuth();
        const newState = { isAuthenticated: loggedIn, lastCheckedAt: Date.now() };
        setFbAuth(newState);
        storeFbAuthState(newState);

        if (!loggedIn) {
          setActionError("Not logged in. Please log in through the Facebook window first.");
        }
      } catch (err) {
        setActionError(err instanceof Error ? err.message : "Auth check failed");
      } finally {
        setChecking(false);
      }
    });
  }, [confirm, setFbAuth]);

  const runSync = useCallback(async () => {
    setLastDiag(null);
    try {
      const result = await withProviderSyncing("facebook", () => captureFbFeed());
      setLastDiag(result.diag);
    } catch (err) {
      console.error("Facebook feed capture failed:", err);
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

  const handleSelectShownGroups = useCallback(
    async (shownGroups: readonly FbGroupInfo[]) => {
      if (shownGroups.length === groups.length) {
        await handleSelectAllGroups();
        return;
      }
      const nextExcluded = { ...excludedGroupIds };
      for (const group of shownGroups) {
        delete nextExcluded[group.id];
      }
      await setExcludedGroups(nextExcluded);
    },
    [excludedGroupIds, groups.length, handleSelectAllGroups, setExcludedGroups],
  );

  const handleDeselectShownGroups = useCallback(
    async (shownGroups: readonly FbGroupInfo[]) => {
      if (shownGroups.length === groups.length) {
        await handleDeselectAllGroups();
        return;
      }
      const nextExcluded = { ...excludedGroupIds };
      for (const group of shownGroups) {
        nextExcluded[group.id] = true;
      }
      await setExcludedGroups(nextExcluded);
    },
    [excludedGroupIds, groups.length, handleDeselectAllGroups, setExcludedGroups],
  );

  const handleRefreshGroups = useCallback(async () => {
    setRefreshingGroups(true);
    setActionError(null);
    try {
      await captureFbGroups();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to refresh Facebook groups");
    } finally {
      setRefreshingGroups(false);
    }
  }, []);

  const handleDisconnect = useCallback(async () => {
    try {
      await disconnectFb();
    } catch {
      // Best-effort cleanup
    }
    await resetProviderPauseState("facebook");
    setFbAuth({ isAuthenticated: false });
    setLastDiag(null);
    setActionError(null);
  }, [setFbAuth]);

  const syncError = fbAuth.isAuthenticated ? fbAuth.lastCaptureError ?? null : null;
  const authError = fbAuth.lastCaptureError ?? actionError;
  const needsReconnect = needsProviderReconnect(authError);
  const statusTone = getProviderStatusTone({
    isConnected: fbAuth.isAuthenticated,
    authError,
    snapshot: healthSnapshot,
  });
  const statusLabel = getProviderStatusLabel({
    isConnected: fbAuth.isAuthenticated,
    authError,
    snapshot: healthSnapshot,
  });
  const isPaused = !!healthSnapshot?.pause && healthSnapshot.pause.pausedUntil > Date.now();
  // ── Connected state ──────────────────────────────────────────────────────

  if (fbAuth.isAuthenticated) {
    const statusLine = (() => {
      if (!lastDiag) return null;
      if (lastDiag.errorStage) return null;
      if (lastDiag.itemsAdded === 0 && lastDiag.postsExtracted === 0) {
        return (
          <p className="text-xs text-[#52525b]">
            {copy.feedReturnedEmpty}
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
      <SyncProviderSectionSurface surface={surface} title="Facebook">
        <div className="space-y-4">
          <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-white/5">
            <ProviderStatusIndicator
              tone={statusTone}
              syncing={syncing}
              label={statusLabel}
              testId="provider-status-facebook"
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
                    await clearProviderPause("facebook");
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
              testId="provider-sync-action-facebook"
            >
              {needsReconnect ? "Reconnect Facebook" : isPaused ? "Resume Now" : "Sync Now"}
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
              {formatProviderReconnectMessage(copy.label, authError)}
            </p>
          )}

          {actionError && !needsReconnect && (
            <p className="text-xs text-red-400 leading-relaxed">{actionError}</p>
          )}

          {syncError && !needsReconnect && (
            <p className="text-xs text-red-400 leading-relaxed">
              {syncError.includes("timeout")
                ? copy.timeout
                : syncError}
            </p>
          )}

          <ProviderHealthSectionSummary provider="facebook" />

          {statusLine}

          {lastDiag && <FbDiagPanel diag={lastDiag} />}

          <MediaVaultSettingsCard
            provider="facebook"
            providerLabel="Facebook"
            items={items}
            authenticated={fbAuth.isAuthenticated}
          />

          <SettingsListPanel
            items={groups}
            title="Groups"
            summary={`${activeGroupCount.toLocaleString()} active of ${groups.length.toLocaleString()} total`}
            searchPlaceholder="Filter groups"
            ariaLabel="Filter Facebook groups"
            emptyLabel="No groups found."
            noMatchesLabel="No groups match that filter."
            dataTestId="facebook-groups-list"
            searchDataTestId="facebook-groups-filter"
            scrollDataTestId="facebook-groups-list-scroll"
            className="border-white/10 bg-white/5"
            listClassName="space-y-3"
            reserveScrollHeight
            itemKey={(group) => group.id}
            getSearchText={(group) => {
              const { title, lastActiveText } = splitFacebookGroupName(group.name);
              return [title, lastActiveText, group.id, group.url, group.name].filter(Boolean).join(" ");
            }}
            actions={(shownGroups, query) => {
              const bulkTargetLabel = query ? "shown" : "all";
              return (
                <>
                  <button
                    type="button"
                    onClick={() => { void handleSelectShownGroups(shownGroups); }}
                    disabled={shownGroups.length === 0}
                    className="text-xs text-[#71717a] hover:text-[#a1a1aa] disabled:opacity-50 transition-colors"
                  >
                    Activate {bulkTargetLabel}
                  </button>
                  <button
                    type="button"
                    onClick={() => { void handleDeselectShownGroups(shownGroups); }}
                    disabled={shownGroups.length === 0}
                    className="text-xs text-[#71717a] hover:text-[#a1a1aa] disabled:opacity-50 transition-colors"
                  >
                    Deactivate {bulkTargetLabel}
                  </button>
                  <button
                    type="button"
                    onClick={handleRefreshGroups}
                    disabled={refreshingGroups}
                    className="text-xs text-[#71717a] hover:text-[#a1a1aa] disabled:opacity-50 transition-colors"
                  >
                    {refreshingGroups ? "Refreshing..." : "Refresh"}
                  </button>
                </>
              );
            }}
            renderItem={(group) => {
              const included = !excludedGroupIds[group.id];
              const { title, lastActiveText } = splitFacebookGroupName(group.name);
              return (
                <Toggle
                  testId={`facebook-group-${group.id}`}
                  label={title}
                  checked={included}
                  onChange={(nextIncluded) => {
                    void handleToggleGroup(group, nextIncluded);
                  }}
                  meta={lastActiveText}
                  description={included ? "Included in future syncs" : "Hidden from future syncs"}
                />
              );
            }}
          />

          <details className="group">
            <summary className="text-xs text-[#52525b] hover:text-[#71717a] cursor-pointer select-none list-none flex items-center gap-1">
              <span className="group-open:rotate-90 transition-transform inline-block">›</span>
              Advanced
            </summary>
            <div className="mt-3 pl-3 border-l border-white/10">
              <ScraperWindowModeControl
                sourceLabel="Facebook"
                mode={windowMode}
                onChange={(nextMode) => {
                  setWindowMode(nextMode);
                  setFbScraperWindowMode(nextMode);
                }}
              />
            </div>
          </details>

          <p className="text-xs text-[#52525b] leading-relaxed">
            {copy.connectedInfo}
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
    <SyncProviderSectionSurface surface={surface} title="Facebook">
      <div className="space-y-4">
        <p className="text-sm text-[#71717a] leading-relaxed">
          {needsReconnect
            ? "Your Facebook session is no longer valid. Sign in again to restore sync."
            : copy.disconnectedSettings}
        </p>
        <div className="flex gap-2">
          <button
            onClick={handleLogin}
            className="text-sm px-4 py-2 rounded-xl bg-[#1877F2]/15 text-[#1877F2] hover:bg-[#1877F2]/25 transition-colors"
          >
            {needsReconnect ? "Reconnect Facebook" : "Log in with Facebook"}
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
            {formatProviderReconnectMessage(copy.label, authError)}
          </p>
        )}
        {actionError && !needsReconnect && (
          <p className="text-xs text-red-400 leading-relaxed">{actionError}</p>
        )}
        <ProviderHealthSectionSummary provider="facebook" />
      </div>
    </SyncProviderSectionSurface>
    {dialog}
    </>
  );
}
