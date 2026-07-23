import { useCallback, useMemo, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import type { SyncProviderSectionProps } from "@freed/ui/context";
import { ProviderStatusIndicator } from "@freed/ui/components/ProviderStatusIndicator";
import { useDebugStore, type HealthProviderId } from "@freed/ui/lib/debug-store";
import { getProviderStatusLabel, getProviderStatusTone } from "@freed/ui/lib/provider-status";
import { useProviderRiskGate } from "../hooks/useProviderRiskGate";
import { usePostLoginAutoSync } from "../hooks/usePostLoginAutoSync";
import {
  formatProviderReconnectMessage,
  needsProviderReconnect,
} from "../lib/provider-auth-errors";
import type { SocialScrapeTrigger } from "../lib/runtime-health-events";
import type { ScraperWindowMode } from "../lib/scraper-prefs";
import { clearProviderPause, resetProviderPauseState } from "../lib/provider-health";
import { socialProviderCopy, type SocialProviderId } from "../lib/social-provider-copy";
import { useAppStore, withProviderSyncing } from "../lib/store";
import { ProviderHealthSectionSummary } from "./ProviderHealthSectionSummary";
import { ProviderSyncActionButton } from "./ProviderSyncActionButton";
import { ScraperWindowModeControl } from "./ScraperWindowModeControl";
import { SyncProviderSectionSurface } from "./SyncProviderSectionSurface";

type EssayProviderId = Extract<SocialProviderId, "substack" | "medium">;
type EssayProviderAction = "connect" | "check" | "reset" | "disconnect";

interface EssayProviderAuthState {
  isAuthenticated: boolean;
  lastCheckedAt?: number;
  lastCapturedAt?: number;
  lastCaptureError?: string;
  captureCooldownUntil?: number;
  pausedUntil?: number;
  pauseReason?: string;
  pauseLevel?: 1 | 2 | 3;
}

interface EssayProviderConfig {
  provider: EssayProviderId;
  authEvent: "substack-auth-result" | "medium-auth-result";
  loginWindowClosedEvent: "substack-login-window-closed" | "medium-login-window-closed";
  scrapeHealthyEvent: "substack-scrape-healthy" | "medium-scrape-healthy";
  scrapeStartFailedEvent: "substack-scrape-start-failed" | "medium-scrape-start-failed";
  hideLoginCommand: "substack_hide_login" | "medium_hide_login";
  getAuth: () => EssayProviderAuthState;
  setAuth: (auth: EssayProviderAuthState) => void;
  storeAuth: (auth: EssayProviderAuthState) => void;
  showLogin: () => Promise<void>;
  checkAuth: () => Promise<boolean>;
  disconnect: () => Promise<void>;
  capture: (trigger?: SocialScrapeTrigger) => Promise<{
    diag: { errorStage: string | null; errorMessage: string | null };
  }>;
  getWindowMode: () => ScraperWindowMode;
  setWindowMode: (mode: ScraperWindowMode) => void;
}

function AuthenticatedEssaySettingsSection({
  surface = "settings",
  config,
}: SyncProviderSectionProps & {
  config: EssayProviderConfig;
}) {
  const { provider } = config;
  const copy = socialProviderCopy(provider);
  const auth = useAppStore(config.getAuth);
  const syncing = useAppStore((state) => (state.providerSyncCounts[provider] ?? 0) > 0);
  const snapshot = useDebugStore((state) => state.health?.providers[provider as HealthProviderId] ?? null);
  const [mode, setMode] = useState<ScraperWindowMode>(() => config.getWindowMode());
  const [activeAction, setActiveAction] = useState<EssayProviderAction | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const { confirm, dialog } = useProviderRiskGate(provider);
  const nativeRuntimeAvailable = isTauri() || import.meta.env.VITE_TEST_TAURI === "1";

  const handleAuthResult = useCallback((loggedIn: boolean) => {
    const current = config.getAuth();
    const next = loggedIn
      ? { ...current, isAuthenticated: true, lastCheckedAt: Date.now(), lastCaptureError: undefined }
      : { ...current, isAuthenticated: false, lastCheckedAt: Date.now() };
    config.setAuth(next);
    config.storeAuth(next);
  }, [config]);

  const runSync = useCallback(async (trigger: "manual" | "post_login" = "manual") => {
    setActionError(null);
    try {
      const result = await withProviderSyncing(provider, () => config.capture(trigger));
      if (!result.diag.errorStage) return;
      const message = result.diag.errorMessage ?? `${copy.label} sync failed.`;
      setActionError(message);
      throw new Error(message);
    } catch (error) {
      const message = error instanceof Error ? error.message : `${copy.label} sync failed.`;
      setActionError(message);
      throw error instanceof Error ? error : new Error(message);
    }
  }, [config, copy.label, provider]);

  const postLoginSync = usePostLoginAutoSync({
    authEvent: config.authEvent,
    loginWindowClosedEvent: config.loginWindowClosedEvent,
    scrapeHealthyEvent: config.scrapeHealthyEvent,
    scrapeStartFailedEvent: config.scrapeStartFailedEvent,
    hideLoginCommand: config.hideLoginCommand,
    providerLabel: copy.label,
    isAuthenticated: () => config.getAuth().isAuthenticated,
    onAuthResult: handleAuthResult,
    runSync,
  });

  const statusLabel = getProviderStatusLabel({
    isConnected: auth.isAuthenticated,
    authError: auth.lastCaptureError,
    snapshot,
  });
  const statusTone = getProviderStatusTone({
    isConnected: auth.isAuthenticated,
    authError: auth.lastCaptureError,
    snapshot,
  });

  const details = useMemo(() => {
    if (actionError) return actionError;
    if (auth.lastCaptureError) return auth.lastCaptureError;
    if (postLoginSync.message) return postLoginSync.message;
    if (auth.lastCapturedAt) return `Last synced ${new Date(auth.lastCapturedAt).toLocaleString()}`;
    return auth.isAuthenticated ? copy.connectedInfo : copy.disconnectedSettings;
  }, [actionError, auth.isAuthenticated, auth.lastCaptureError, auth.lastCapturedAt, copy, postLoginSync.message]);

  const updateMode = (next: ScraperWindowMode) => {
    setMode(next);
    config.setWindowMode(next);
  };

  const connect = async () => {
    await confirm(async () => {
      setActiveAction("connect");
      setActionError(null);
      try {
        await config.showLogin();
      } catch (error) {
        setActionError(error instanceof Error ? error.message : `Could not open ${copy.label} login.`);
      } finally {
        setActiveAction(null);
      }
    });
  };

  const check = async () => {
    await confirm(async () => {
      setActiveAction("check");
      setActionError(null);
      try {
        const loggedIn = await config.checkAuth();
        const next = {
          ...config.getAuth(),
          isAuthenticated: loggedIn,
          lastCheckedAt: Date.now(),
          lastCaptureError: loggedIn ? undefined : "Login was not detected.",
        };
        config.setAuth(next);
        config.storeAuth(next);
        if (!loggedIn) setActionError(`Freed could not confirm the ${copy.label} session.`);
      } catch (error) {
        setActionError(error instanceof Error ? error.message : `${copy.label} login check failed.`);
      } finally {
        setActiveAction(null);
      }
    });
  };

  const syncNow = async () => {
    await confirm(async () => {
      try {
        if (snapshot?.status === "paused") await clearProviderPause(provider);
        postLoginSync.cancel();
        await runSync();
      } catch (error) {
        setActionError(error instanceof Error ? error.message : `${copy.label} sync failed.`);
      }
    });
  };

  const resetHealth = async () => {
    setActiveAction("reset");
    setActionError(null);
    try {
      await resetProviderPauseState(provider);
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : `Could not reset ${copy.label} health.`,
      );
    } finally {
      setActiveAction(null);
    }
  };

  const disconnect = async () => {
    setActiveAction("disconnect");
    setActionError(null);
    let cleanupFailed = false;
    const disconnectedAuth: EssayProviderAuthState = { isAuthenticated: false };
    const clearLocalAuth = () => {
      config.setAuth(disconnectedAuth);
      try {
        config.storeAuth(disconnectedAuth);
      } catch {
        cleanupFailed = true;
      }
    };
    try {
      await config.disconnect();
    } catch {
      cleanupFailed = true;
    }
    clearLocalAuth();
    try {
      await resetProviderPauseState(provider);
    } catch {
      cleanupFailed = true;
    } finally {
      postLoginSync.cancel();
      clearLocalAuth();
      setActiveAction(null);
    }
    if (cleanupFailed) {
      setActionError(
        `Freed could not fully clear the ${copy.label} browser session. Restart Freed Desktop before reconnecting.`,
      );
    }
  };

  const reconnect = needsProviderReconnect(auth.lastCaptureError ?? actionError);

  return (
    <SyncProviderSectionSurface surface={surface} title={copy.settingsTitle}>
      {dialog}
      <div className="space-y-4">
        <div className="flex items-center gap-3 rounded-xl bg-[var(--theme-bg-card)] px-3 py-2.5">
          <ProviderStatusIndicator
            tone={statusTone}
            syncing={syncing}
            label={statusLabel}
            testId={`provider-status-${provider}`}
            size="sm"
          />
          <span className="text-sm text-[var(--theme-text-secondary)]">{statusLabel}</span>
        </div>
        <p className="text-sm text-[var(--theme-text-secondary)]">{details}</p>

        <div className="flex flex-wrap gap-2">
          <ProviderSyncActionButton
            busy={activeAction === "connect"}
            busyLabel="Opening login"
            disabled={activeAction !== null || syncing || !nativeRuntimeAvailable}
            onClick={connect}
            testId={`provider-connect-${provider}`}
          >
            {auth.isAuthenticated || reconnect ? `Reconnect ${copy.label}` : `Log in with ${copy.label}`}
          </ProviderSyncActionButton>
          <button
            type="button"
            data-testid={`provider-check-auth-${provider}`}
            onClick={check}
            disabled={activeAction !== null || syncing || !nativeRuntimeAvailable}
            className="rounded-xl border border-[var(--theme-border-subtle)] px-3 py-2 text-sm text-[var(--theme-text-primary)] transition-colors hover:bg-[var(--theme-bg-card-hover)] disabled:opacity-50"
          >
            {activeAction === "check" ? "Checking" : "Check login"}
          </button>
          <ProviderSyncActionButton
            busy={syncing}
            disabled={activeAction !== null || syncing || !auth.isAuthenticated}
            onClick={syncNow}
            testId={`provider-sync-action-${provider}`}
          >
            Sync now
          </ProviderSyncActionButton>
          <button
            type="button"
            disabled={activeAction !== null || syncing}
            onClick={resetHealth}
            className="rounded-xl border border-[var(--theme-border-subtle)] px-3 py-2 text-sm text-[var(--theme-text-primary)] transition-colors hover:bg-[var(--theme-bg-card-hover)] disabled:opacity-50"
          >
            {activeAction === "reset" ? "Resetting" : "Reset health"}
          </button>
          <button
            type="button"
            data-testid={`provider-disconnect-${provider}`}
            disabled={activeAction !== null || syncing}
            onClick={disconnect}
            className="rounded-xl border border-[var(--theme-border-subtle)] px-3 py-2 text-sm text-[var(--theme-text-primary)] transition-colors hover:bg-[var(--theme-bg-card-hover)] disabled:opacity-50"
          >
            {activeAction === "disconnect" ? "Disconnecting" : "Disconnect"}
          </button>
        </div>

        <ScraperWindowModeControl mode={mode} onChange={updateMode} sourceLabel={copy.label} />
        {reconnect && (auth.lastCaptureError ?? actionError) ? (
          <p className="text-xs text-[rgb(var(--theme-feedback-warning-rgb))]">
            {formatProviderReconnectMessage(copy.label, auth.lastCaptureError ?? actionError)}
          </p>
        ) : null}
        <ProviderHealthSectionSummary provider={provider} />
      </div>
    </SyncProviderSectionSurface>
  );
}

export function createAuthenticatedEssaySettingsSection(config: EssayProviderConfig) {
  return function EssaySettingsSection(props: SyncProviderSectionProps) {
    return <AuthenticatedEssaySettingsSection {...props} config={config} />;
  };
}
