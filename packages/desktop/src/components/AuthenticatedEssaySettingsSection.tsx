import { useEffect, useMemo, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { SyncProviderSectionProps } from "@freed/ui/context";
import { ProviderStatusIndicator } from "@freed/ui/components/ProviderStatusIndicator";
import { useDebugStore, type HealthProviderId } from "@freed/ui/lib/debug-store";
import { getProviderStatusLabel, getProviderStatusTone } from "@freed/ui/lib/provider-status";
import { useProviderRiskGate } from "../hooks/useProviderRiskGate";
import type { ScraperWindowMode } from "../lib/scraper-prefs";
import { clearProviderPause, resetProviderPauseState } from "../lib/provider-health";
import { socialProviderCopy, type SocialProviderId } from "../lib/social-provider-copy";
import { useAppStore, withProviderSyncing } from "../lib/store";
import { ProviderHealthSectionSummary } from "./ProviderHealthSectionSummary";
import { ProviderSyncActionButton } from "./ProviderSyncActionButton";
import { ScraperWindowModeControl } from "./ScraperWindowModeControl";
import { SyncProviderSectionSurface } from "./SyncProviderSectionSurface";

type EssayProviderId = Extract<SocialProviderId, "substack" | "medium">;

interface EssayProviderAuthState {
  isAuthenticated: boolean;
  lastCheckedAt?: number;
  lastCapturedAt?: number;
  lastCaptureError?: string;
  pausedUntil?: number;
  pauseReason?: string;
  pauseLevel?: 1 | 2 | 3;
}

interface EssayProviderConfig {
  provider: EssayProviderId;
  authEvent: "substack-auth-result" | "medium-auth-result";
  getAuth: () => EssayProviderAuthState;
  setAuth: (auth: EssayProviderAuthState) => void;
  storeAuth: (auth: EssayProviderAuthState) => void;
  showLogin: () => Promise<void>;
  checkAuth: () => Promise<boolean>;
  disconnect: () => Promise<void>;
  capture: () => Promise<unknown>;
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
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const { confirm, dialog } = useProviderRiskGate(provider);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    void listen<{ loggedIn: boolean }>(config.authEvent, (event) => {
      if (cancelled) return;
      const next = {
        ...config.getAuth(),
        isAuthenticated: event.payload.loggedIn,
        lastCheckedAt: Date.now(),
        lastCaptureError: event.payload.loggedIn ? undefined : config.getAuth().lastCaptureError,
      };
      config.setAuth(next);
      config.storeAuth(next);
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [config]);

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
    if (auth.lastCaptureError) return auth.lastCaptureError;
    if (auth.lastCapturedAt) return `Last synced ${new Date(auth.lastCapturedAt).toLocaleString()}`;
    return auth.isAuthenticated ? copy.connectedInfo : copy.disconnectedSettings;
  }, [auth.isAuthenticated, auth.lastCaptureError, auth.lastCapturedAt, copy]);

  const updateMode = (next: ScraperWindowMode) => {
    setMode(next);
    config.setWindowMode(next);
  };

  const connect = async () => {
    await confirm(async () => {
      setBusy(true);
      try {
        await config.showLogin();
      } finally {
        setBusy(false);
      }
    });
  };

  const check = async () => {
    setChecking(true);
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
    } finally {
      setChecking(false);
    }
  };

  const syncNow = async () => {
    await confirm(async () => {
      if (snapshot?.status === "paused") await clearProviderPause(provider);
      await withProviderSyncing(provider, config.capture);
    });
  };

  const disconnect = async () => {
    await config.disconnect();
    config.setAuth({ isAuthenticated: false });
  };

  return (
    <SyncProviderSectionSurface surface={surface} title={copy.settingsTitle}>
      {dialog}
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-4 rounded-xl border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-card)] p-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <ProviderStatusIndicator
                tone={statusTone}
                syncing={syncing}
                label={statusLabel}
                testId={`provider-status-${provider}`}
              />
              <p className="text-sm font-medium text-[var(--theme-text-primary)]">{copy.settingsTitle}</p>
            </div>
            <p className="mt-2 text-sm text-[var(--theme-text-secondary)]">{details}</p>
          </div>
          <span className="shrink-0 rounded-full border border-[var(--theme-border-subtle)] px-2 py-1 text-xs text-[var(--theme-text-secondary)]">
            {statusLabel}
          </span>
        </div>

        <div className="flex flex-wrap gap-2">
          <ProviderSyncActionButton
            busy={busy}
            onClick={connect}
            testId={`provider-connect-${provider}`}
          >
            {auth.isAuthenticated ? "Reconnect" : `Log in with ${copy.label}`}
          </ProviderSyncActionButton>
          <button
            type="button"
            onClick={check}
            disabled={checking || !isTauri()}
            className="rounded-xl border border-[var(--theme-border-subtle)] px-3 py-2 text-sm text-[var(--theme-text-primary)] transition-colors hover:bg-[var(--theme-bg-card-hover)] disabled:opacity-50"
          >
            {checking ? "Checking" : "Check login"}
          </button>
          <ProviderSyncActionButton
            busy={syncing}
            disabled={!auth.isAuthenticated}
            onClick={syncNow}
            testId={`provider-sync-action-${provider}`}
          >
            Sync now
          </ProviderSyncActionButton>
          <button
            type="button"
            onClick={async () => {
              await resetProviderPauseState(provider);
            }}
            className="rounded-xl border border-[var(--theme-border-subtle)] px-3 py-2 text-sm text-[var(--theme-text-primary)] transition-colors hover:bg-[var(--theme-bg-card-hover)]"
          >
            Reset health
          </button>
          <button
            type="button"
            onClick={disconnect}
            className="rounded-xl border border-[var(--theme-border-subtle)] px-3 py-2 text-sm text-[var(--theme-text-primary)] transition-colors hover:bg-[var(--theme-bg-card-hover)]"
          >
            Disconnect
          </button>
        </div>

        <ScraperWindowModeControl mode={mode} onChange={updateMode} sourceLabel={copy.label} />
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
