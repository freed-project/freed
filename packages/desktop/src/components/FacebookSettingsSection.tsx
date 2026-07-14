/**
 * FacebookSettingsSection -- Settings > Sources > Facebook
 *
 * Uses the Tauri WebView login flow: clicking "Log in with Facebook"
 * opens a real Facebook login page in a native window. Once the user
 * authenticates, the WebView's cookies are shared with the scraper.
 */

import { useState, useCallback, useEffect, useRef, type ReactNode } from "react";
import { usePlatform, type SyncProviderSectionProps } from "@freed/ui/context";
import { addDebugEvent, useDebugStore } from "@freed/ui/lib/debug-store";
import {
  getProviderStatusLabel,
  getProviderStatusTone,
} from "@freed/ui/lib/provider-status";
import { ProviderStatusIndicator } from "@freed/ui/components/ProviderStatusIndicator";
import { SettingsListPanel } from "@freed/ui/components/settings/SettingsListPanel";
import { Tooltip } from "@freed/ui/components/Tooltip";
import type { FbGroupInfo, UserPreferences } from "@freed/shared";
import { TrashIcon } from "@freed/ui/components/icons";
import { useAppStore } from "../lib/store";
import {
  showFbLogin,
  checkFbAuth,
  disconnectFb,
  storeFbAuthState,
} from "../lib/fb-auth";
import {
  captureFbFeed,
  captureFbGroups,
  repairStoredFacebookGroupNamesFromItems,
  verifyFacebookGroupLeave,
} from "../lib/fb-capture";
import type { FbSyncDiag } from "../lib/fb-capture";
import { getFacebookGroupDisplayName } from "../lib/facebook-groups";
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
import { isRuntimeDeferredStage } from "../lib/social-capture-runtime";
import { log } from "../lib/logger";
import { usePostLoginAutoSync } from "../hooks/usePostLoginAutoSync";
import { isDesktopProviderAuthAllowed } from "../lib/provider-auth-lifecycle";
import { useFacebookGroupDiscovery } from "../lib/facebook-group-discovery";

const FACEBOOK_LEAVE_CHECK_DELAY_MS = import.meta.env.VITE_TEST_TAURI === "1" ? 100 : 60_000;
const FACEBOOK_LEAVE_CHECK_FOCUS_GRACE_MS = import.meta.env.VITE_TEST_TAURI === "1" ? 0 : 5_000;

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
  status,
  meta,
  testId,
  trailingAction,
  labelAccessory,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  status?: string;
  meta?: string;
  testId?: string;
  trailingAction?: ReactNode;
  labelAccessory?: ReactNode;
}) {
  return (
    <div className="flex h-8 items-center justify-between gap-4">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <p
            data-testid={testId ? `${testId}-label` : undefined}
            className="min-w-0 truncate text-sm text-[#a1a1aa]"
          >
            {label}
          </p>
          {labelAccessory}
        </div>
        {meta ? (
          <p
            data-testid={testId ? `${testId}-meta` : undefined}
            className="shrink-0 truncate text-[11px] text-[#71717a] text-right"
          >
            {meta}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Tooltip
          label={status ?? (checked ? "Included in future syncs" : "Hidden from future syncs")}
          side="left"
        >
          <button
            type="button"
            role="switch"
            aria-label={`${label}: ${status ?? (checked ? "Included in future syncs" : "Hidden from future syncs")}`}
            aria-checked={checked}
            data-testid={testId ? `${testId}-switch` : undefined}
            onClick={() => onChange(!checked)}
            className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
              checked ? "bg-[#8b5cf6]" : "bg-white/10"
            }`}
          >
            <span
              className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
                checked ? "translate-x-4" : "translate-x-0"
              }`}
            />
          </button>
        </Tooltip>
        {trailingAction}
      </div>
    </div>
  );
}

function getFacebookGroupUrl(group: FbGroupInfo): string {
  const url = group.url.trim();
  if (url) return url;
  return `https://www.facebook.com/groups/${encodeURIComponent(group.id)}`;
}

function FbDiagPanel({ diag }: { diag: FbSyncDiag }) {
  const runtimeDeferred = isRuntimeDeferredStage(diag.errorStage);
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
          label="Extraction passes"
          value={diag.extractionPasses.toLocaleString()}
        />
        <DiagRow
          label="Candidates seen"
          value={diag.totalCandidateCount.toLocaleString()}
          warn={diag.postsExtracted === 0 && diag.totalCandidateCount === 0}
        />
        <DiagRow
          label="Rejected candidates"
          value={(
            diag.totalRejected.suggestedOrSponsored +
            diag.totalRejected.missingAuthor +
            diag.totalRejected.missingContent
          ).toLocaleString()}
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
          <p
            className={`${
              runtimeDeferred ? "text-[#a1a1aa]" : "text-red-400"
            } pt-1 leading-relaxed`}
          >
            {runtimeDeferred ? "Deferred at" : "Failed at"}{" "}
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
  const excludedGroupIds = useAppStore(
    (s) => s.preferences.fbCapture.excludedGroupIds,
  );
  const updatePreferences = useAppStore((s) => s.updatePreferences);
  const isLoading = useAppStore((s) => s.isLoading);
  const items = useAppStore((s) => s.items);
  const syncing = useAppStore((s) => (s.providerSyncCounts.facebook ?? 0) > 0);
  const healthSnapshot = useDebugStore((s) => s.health?.providers.facebook ?? null);

  const [checking, setChecking] = useState(false);
  const [refreshingGroups, setRefreshingGroups] = useState(false);
  const [refreshingGroupId, setRefreshingGroupId] = useState<string | null>(null);
  const [lastDiag, setLastDiag] = useState<FbSyncDiag | null>(null);
  const [windowMode, setWindowMode] = useState(() => getFbScraperWindowMode());
  const [actionError, setActionError] = useState<string | null>(null);
  const [checkingLeaveGroupIds, setCheckingLeaveGroupIds] = useState<Record<string, true>>({});
  const pendingLeaveCheckRef = useRef<{ group: FbGroupInfo; openedAt: number } | null>(null);
  const leaveCheckTimerRef = useRef<number | null>(null);
  const leaveCheckInFlightRef = useRef(false);
  const { openUrl } = usePlatform();
  const copy = socialProviderCopy("facebook");
  const { confirm, dialog } = useProviderRiskGate("facebook");

  const knownGroups = useFacebookGroupDiscovery();
  const groups = Object.values(knownGroups).sort((a, b) =>
    getFacebookGroupDisplayName(a).localeCompare(getFacebookGroupDisplayName(b)),
  );
  const activeGroupCount = groups.filter((group) => !excludedGroupIds[group.id]).length;

  const runSync = useCallback(async (trigger: "manual" | "post_login" = "manual") => {
    setLastDiag(null);
    try {
      const result = await withProviderSyncing("facebook", () => captureFbFeed(trigger));
      setLastDiag(result.diag);
    } catch (err) {
      console.error("Facebook feed capture failed:", err);
    }
  }, []);

  const handleAuthResult = useCallback(
    (loggedIn: boolean) => {
      if (!isDesktopProviderAuthAllowed()) return;
      log.info(`[FB] auth result received logged_in=${loggedIn}`);
      const currentAuth = useAppStore.getState().fbAuth;
      const newState = {
        ...currentAuth,
        isAuthenticated: loggedIn,
        lastCheckedAt: Date.now(),
        lastCaptureError: loggedIn ? undefined : currentAuth.lastCaptureError,
      };
      setFbAuth(newState);
      storeFbAuthState(newState);
      if (loggedIn) {
        setActionError(null);
        addDebugEvent("change", "[FB] connection restored");
      }
    },
    [setFbAuth],
  );

  const postLoginSync = usePostLoginAutoSync({
    authEvent: "fb-auth-result",
    loginWindowClosedEvent: "fb-login-window-closed",
    scrapeHealthyEvent: "fb-scrape-healthy",
    scrapeStartFailedEvent: "fb-scrape-start-failed",
    hideLoginCommand: "fb_hide_login",
    providerLabel: "Facebook",
    isAuthenticated: () => useAppStore.getState().fbAuth.isAuthenticated,
    onAuthResult: handleAuthResult,
    runSync,
  });

  useEffect(() => {
    if (!fbAuth.isAuthenticated || items.length === 0) return;
    void repairStoredFacebookGroupNamesFromItems(items);
  }, [fbAuth.isAuthenticated, items]);

  const handleLogin = useCallback(async () => {
    log.info(
      `[FB] reconnect click auth=${fbAuth.isAuthenticated} reconnect=${needsProviderReconnect(fbAuth.lastCaptureError ?? actionError ?? null)}`,
    );
    addDebugEvent("change", "[FB] reconnect requested");
    await confirm(async () => {
      log.info("[FB] reconnect consent cleared");
      setActionError(null);
      try {
        await showFbLogin();
        if (!isDesktopProviderAuthAllowed()) return;
        log.info("[FB] reconnect login window requested");
      } catch (err) {
        if (!isDesktopProviderAuthAllowed()) return;
        const message = err instanceof Error ? err.message : "Failed to open login window";
        log.error(`[FB] reconnect failed: ${message}`);
        addDebugEvent("error", `[FB] reconnect failed: ${message}`);
        setActionError(message);
      }
    });
  }, [actionError, confirm, fbAuth.isAuthenticated, fbAuth.lastCaptureError]);

  const handleCheckAuth = useCallback(async () => {
    await confirm(async () => {
      setChecking(true);
      setActionError(null);
      try {
        const loggedIn = await checkFbAuth();
        if (!isDesktopProviderAuthAllowed()) return;
        const newState = { isAuthenticated: loggedIn, lastCheckedAt: Date.now() };
        setFbAuth(newState);
        storeFbAuthState(newState);

        if (!loggedIn) {
          setActionError("Not logged in. Please log in through the Facebook window first.");
        }
      } catch (err) {
        if (!isDesktopProviderAuthAllowed()) return;
        setActionError(err instanceof Error ? err.message : "Auth check failed");
      } finally {
        if (isDesktopProviderAuthAllowed()) setChecking(false);
      }
    });
  }, [confirm, setFbAuth]);

  const setExcludedGroups = useCallback(
    async (nextExcludedGroupIds: Record<string, true>) => {
      await updatePreferences({
        fbCapture: {
          excludedGroupIds: nextExcludedGroupIds,
        } as UserPreferences["fbCapture"],
      });
    },
    [updatePreferences],
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

  const runPendingLeaveCheck = useCallback(async () => {
    const pending = pendingLeaveCheckRef.current;
    if (!pending || leaveCheckInFlightRef.current) return;
    if (Date.now() - pending.openedAt < FACEBOOK_LEAVE_CHECK_FOCUS_GRACE_MS) return;

    pendingLeaveCheckRef.current = null;
    if (leaveCheckTimerRef.current !== null) {
      window.clearTimeout(leaveCheckTimerRef.current);
      leaveCheckTimerRef.current = null;
    }

    leaveCheckInFlightRef.current = true;
    setCheckingLeaveGroupIds((current) => ({ ...current, [pending.group.id]: true }));
    setActionError(null);
    try {
      await verifyFacebookGroupLeave(pending.group);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to verify Facebook group leave";
      setActionError(message);
      addDebugEvent("error", `[FB] leave check failed: ${message}`);
    } finally {
      leaveCheckInFlightRef.current = false;
      setCheckingLeaveGroupIds((current) => {
        const next = { ...current };
        delete next[pending.group.id];
        return next;
      });
    }
  }, []);

  useEffect(() => {
    const handleFocus = () => {
      void runPendingLeaveCheck();
    };
    window.addEventListener("focus", handleFocus);
    return () => {
      window.removeEventListener("focus", handleFocus);
      if (leaveCheckTimerRef.current !== null) {
        window.clearTimeout(leaveCheckTimerRef.current);
        leaveCheckTimerRef.current = null;
      }
    };
  }, [runPendingLeaveCheck]);

  const handleLeaveGroupViaFacebook = useCallback(
    (group: FbGroupInfo) => {
      const url = getFacebookGroupUrl(group);
      if (openUrl) {
        openUrl(url);
      } else {
        window.open(url, "_blank", "noopener,noreferrer");
      }

      pendingLeaveCheckRef.current = { group, openedAt: Date.now() };
      if (leaveCheckTimerRef.current !== null) {
        window.clearTimeout(leaveCheckTimerRef.current);
      }
      leaveCheckTimerRef.current = window.setTimeout(() => {
        void runPendingLeaveCheck();
      }, FACEBOOK_LEAVE_CHECK_DELAY_MS);
    },
    [openUrl, runPendingLeaveCheck],
  );

  const handleRefreshGroups = useCallback(async () => {
    await confirm(async () => {
      setRefreshingGroups(true);
      setRefreshingGroupId(null);
      setActionError(null);
      try {
        await withProviderSyncing("facebook", () =>
          captureFbGroups({
            onCheckingGroup: setRefreshingGroupId,
          }),
        );
      } catch (err) {
        setActionError(err instanceof Error ? err.message : "Failed to refresh Facebook groups");
      } finally {
        setRefreshingGroups(false);
        setRefreshingGroupId(null);
      }
    });
  }, [confirm]);

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

          {postLoginSync.message && (
            <p className="text-xs text-[#a1a1aa] leading-relaxed">
              {postLoginSync.message}
            </p>
          )}

          <div className="flex gap-2">
            <ProviderSyncActionButton
              onClick={() => {
                if (needsReconnect) {
                  void handleLogin();
                  return;
                }
                void confirm(async () => {
                  postLoginSync.cancel();
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

          <ProviderHealthSectionSummary
            provider="facebook"
            showMessages={surface === "debug-card" && !syncError && !actionError}
          />

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
            listClassName="space-y-1"
            estimateItemSize={36}
            reserveScrollHeight
            itemKey={(group) => group.id}
            getSearchText={(group) => {
              const { title, lastActiveText } = splitFacebookGroupName(
                getFacebookGroupDisplayName(group),
              );
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
                    Refresh groups
                  </button>
                </>
              );
            }}
            renderItem={(group) => {
              const included = !excludedGroupIds[group.id];
              const checkingLeave = Boolean(checkingLeaveGroupIds[group.id]);
              const refreshingGroup = refreshingGroupId === group.id;
              const { title, lastActiveText } = splitFacebookGroupName(
                getFacebookGroupDisplayName(group),
              );
              return (
                <Toggle
                  testId={`facebook-group-${group.id}`}
                  label={title}
                  checked={included}
                  onChange={(nextIncluded) => {
                    void handleToggleGroup(group, nextIncluded);
                  }}
                  meta={lastActiveText}
                  status={included ? "Included in future syncs" : "Hidden from future syncs"}
                  labelAccessory={
                    refreshingGroup ? (
                      <span
                        aria-label={`Refreshing group: ${title}`}
                        data-testid={`facebook-group-${group.id}-refreshing`}
                        className="h-3 w-3 shrink-0 rounded-full border border-[#8b5cf6]/50 border-t-[#c4b5fd] animate-spin"
                      />
                    ) : null
                  }
                  trailingAction={
                    <Tooltip
                      label={checkingLeave ? "Checking leave status" : "Leave group via Facebook"}
                      side="left"
                    >
                      <button
                        type="button"
                        aria-label={
                          checkingLeave
                            ? `Checking leave status: ${title}`
                            : `Leave group via Facebook: ${title}`
                        }
                        data-testid={`facebook-group-${group.id}-leave`}
                        disabled={checkingLeave}
                        onClick={() => handleLeaveGroupViaFacebook(group)}
                        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[#71717a] transition-colors hover:bg-red-500/10 hover:text-red-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/50"
                      >
                        <TrashIcon className="h-3.5 w-3.5" />
                      </button>
                    </Tooltip>
                  }
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
        <ProviderHealthSectionSummary
          provider="facebook"
          showMessages={surface === "debug-card" && !actionError}
        />
      </div>
    </SyncProviderSectionSurface>
    {dialog}
    </>
  );
}
