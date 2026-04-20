import { useEffect, useMemo, useState, useCallback } from "react";
import {
  getWebsiteHostForChannel,
  type ReleaseChannel,
} from "@freed/shared";
import { AppShell } from "@freed/ui/components/layout";
import { BugReportBoundary } from "@freed/ui/components/BugReportBoundary";
import { FeedView } from "@freed/ui/components/feed";
import { GoogleContactsSection } from "@freed/ui/components/settings/GoogleContactsSection";
import { FatalErrorScreen } from "@freed/ui/components/FatalErrorScreen";
import { LocalPreviewBadge } from "@freed/ui/components/LocalPreviewBadge";
import { ToastContainer } from "@freed/ui/components/Toast";
import { LegalGate } from "@freed/ui/components/legal/LegalGate";
import { OAuthCallback } from "./components/OAuthCallback";
import {
  PlatformProvider,
  type AvailableUpdateInfo,
  type PlatformConfig,
} from "@freed/ui/context";
import { useAppStore } from "./lib/store";
import { exportFeedsAsOPML, subscribeToFeed } from "./lib/capture";
import {
  connect,
  disconnect,
  onStatusChange,
  getStoredRelayUrl,
  clearStoredRelayUrl,
  startCloudSync,
  stopCloudSync,
  getCloudProvider,
  getCloudToken,
  clearCloudSync,
  deleteCloudFile,
} from "./lib/sync";
import { clearLocalDoc, docAddStubItem } from "./lib/automerge";
import { checkForPwaUpdate, applyPwaUpdate, initPwaUpdater, onUpdateAvailable } from "./lib/pwa-updater";
import { pickContactViaWebApi } from "./lib/contacts";
import { PwaFeedEmptyState } from "./components/PwaFeedEmptyState";
import { PwaSyncSettings } from "./components/PwaSyncSettings";
import {
  PwaFacebookSettings,
  PwaInstagramSettings,
  PwaLinkedInSettings,
  PwaXSettings,
} from "./components/PwaSocialProviderSettings";
import { PwaLegalSettingsSection } from "./components/PwaLegalSettingsSection";
import { initiateGDriveOAuth } from "./lib/cloud-oauth";
import { acceptPwaBundle, hasAcceptedPwaBundle } from "./lib/legal-consent";
import { useBrowserNavigationHistory } from "./lib/navigation-history";
import { pwaBugReporting } from "./lib/bug-report";
import { clearFatalRuntimeError, useFatalRuntimeError } from "@freed/ui/lib/bug-report";
import {
  bootstrapReleaseChannel,
  buildPwaReleaseChannelUrl,
  persistReleaseChannel,
} from "@freed/ui/lib/release-channel";

const LOCAL_PREVIEW_LABEL = import.meta.env.VITE_FREED_PREVIEW_LABEL?.trim() || null;

function OAuthRouter() {
  if (window.location.pathname === "/oauth-callback") {
    return <OAuthCallback />;
  }

  return <App />;
}

function App() {
  const initialize = useAppStore((state) => state.initialize);
  const isInitialized = useAppStore((state) => state.isInitialized);
  const error = useAppStore((state) => state.error);
  const setSyncConnected = useAppStore((state) => state.setSyncConnected);
  const [showUpdateBanner, setShowUpdateBanner] = useState(false);
  const [legalResolved, setLegalResolved] = useState(false);
  const [legalAccepted, setLegalAccepted] = useState(false);
  const [releaseChannel, setReleaseChannelState] = useState<ReleaseChannel>(() =>
    bootstrapReleaseChannel(),
  );
  const fatalError = useFatalRuntimeError();

  useBrowserNavigationHistory(legalAccepted);

  useEffect(() => {
    setLegalAccepted(hasAcceptedPwaBundle());
    setLegalResolved(true);
  }, []);

  useEffect(() => {
    if (!legalAccepted) return;
    initialize();
  }, [initialize, legalAccepted]);

  useEffect(() => {
    if (!legalAccepted) return;
    const unsubscribe = onStatusChange((connected) => {
      setSyncConnected(connected);
    });

    // Resume LAN relay connection if previously paired.
    const storedUrl = getStoredRelayUrl();
    if (storedUrl) {
      connect(storedUrl);
    }

    // Resume cloud sync if previously authenticated.
    const provider = getCloudProvider();
    if (provider) {
      const token = getCloudToken(provider);
      if (token) {
        startCloudSync(provider, token).catch((err) => {
          console.error("[App] Failed to resume cloud sync:", err);
        });
      }
    }

    return () => {
      unsubscribe();
      disconnect();
    };
  }, [legalAccepted, setSyncConnected]);

  useEffect(() => {
    if (!legalAccepted) return;
    const stopPolling = initPwaUpdater();
    const unsubscribe = onUpdateAvailable(() => setShowUpdateBanner(true));
    return () => {
      unsubscribe();
      stopPolling();
    };
  }, [legalAccepted]);

  const checkForUpdates = useCallback(async (): Promise<AvailableUpdateInfo | null> => {
    const version = await checkForPwaUpdate();
    return version ? { version, channel: releaseChannel } : null;
  }, [releaseChannel]);
  const setReleaseChannel = useCallback((channel: ReleaseChannel) => {
    if (channel === releaseChannel) {
      return;
    }

    persistReleaseChannel(channel);
    setReleaseChannelState(channel);

    const nextUrl = buildPwaReleaseChannelUrl(window.location.href, channel);
    if (nextUrl !== window.location.href) {
      window.location.assign(nextUrl);
    }
  }, [releaseChannel]);

  const handleFactoryReset = useCallback(async (deleteFromCloud: boolean) => {
    const provider = getCloudProvider();
    const token = provider ? getCloudToken(provider) : null;
    if (deleteFromCloud && provider && token) {
      await deleteCloudFile(provider, token);
    } else {
      stopCloudSync();
    }
    clearStoredRelayUrl();
    if (provider) clearCloudSync(provider);
    await clearLocalDoc();
    location.reload();
  }, []);

  const platform: PlatformConfig = useMemo(
    () => ({
      store: useAppStore,
      feedMediaPreviews: "inline",
      addRssFeed: subscribeToFeed,
      exportFeedsAsOPML,
      SourceIndicator: null,
      HeaderSyncIndicator: null,
      SettingsExtraSections: PwaSyncSettings,
      LegalSettingsContent: PwaLegalSettingsSection,
      FeedEmptyState: PwaFeedEmptyState,
      XSettingsContent: PwaXSettings,
      FacebookSettingsContent: PwaFacebookSettings,
      InstagramSettingsContent: PwaInstagramSettings,
      LinkedInSettingsContent: PwaLinkedInSettings,
      GoogleContactsSettingsContent: GoogleContactsSection,
      checkForUpdates,
      applyUpdate: applyPwaUpdate,
      releaseChannel,
      setReleaseChannel,
      factoryReset: handleFactoryReset,
      activeCloudProviderLabel: () => {
        const p = getCloudProvider();
        if (p === "gdrive") return "Google Drive";
        if (p === "dropbox") return "Dropbox";
        return null;
      },
      // PWA save URL: writes a stub that the desktop fetcher picks up via relay
      saveUrl: async (url, options) => {
        await docAddStubItem(url, options?.tags);
      },
      // PWA local content: check the Workbox Cache API
      getLocalContent: async (globalId: string) => {
        if (!("caches" in window)) return null;
        try {
          const cache = await caches.open("freed-articles-v1");
          const resp = await cache.match(`/content/${globalId}`);
          return resp ? resp.text() : null;
        } catch {
          return null;
        }
      },
      // Web Contact Picker API — available on iOS/Android, absent on desktop browsers.
      // FriendEditor falls back to manual entry when this is undefined at runtime.
      pickContact: pickContactViaWebApi,
      googleContacts: {
        getToken: () => localStorage.getItem("freed_cloud_token_gdrive"),
        connect: initiateGDriveOAuth,
      },
      openUrl: (url: string) => { window.open(url, "_blank", "noopener,noreferrer"); },
      bugReporting: pwaBugReporting,
    }),
    [checkForUpdates, handleFactoryReset, releaseChannel, setReleaseChannel],
  );

  if (!legalResolved) {
    return <div className="app-theme-shell h-screen" />;
  }

  if (!legalAccepted) {
    return (
      <LegalGate
        productName="Freed"
        acceptLabel="Agree and open Freed"
        declineLabel="Leave"
        onAccept={() => {
          acceptPwaBundle();
          setLegalAccepted(true);
        }}
        onDecline={() => {
          window.location.assign(
            `https://${getWebsiteHostForChannel(releaseChannel)}`,
          );
        }}
      />
    );
  }

  if (error && !isInitialized) {
    return (
      <PlatformProvider value={platform}>
        <FatalErrorScreen
          error={{ message: error }}
          productName="Freed"
          onRetry={() => window.location.reload()}
        />
      </PlatformProvider>
    );
  }

  if (fatalError) {
    return (
      <PlatformProvider value={platform}>
        <FatalErrorScreen
          error={fatalError}
          productName="Freed"
          onRetry={() => {
            clearFatalRuntimeError();
            window.location.reload();
          }}
        />
      </PlatformProvider>
    );
  }

  return (
    <PlatformProvider value={platform}>
      <BugReportBoundary>
        <LocalPreviewBadge label={LOCAL_PREVIEW_LABEL} />
        <AppShell>
          <FeedView />
        </AppShell>
        <ToastContainer />
        {showUpdateBanner && (
          <div className="fixed bottom-4 right-4 z-[120] max-w-sm animate-slide-up">
            <div className="theme-panel flex items-center gap-3 rounded-xl p-4">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-[var(--theme-text-primary)]">New version available</p>
                <p className="mt-0.5 text-xs text-[var(--theme-text-muted)]">Reload to apply the update.</p>
              </div>
              <button
                onClick={applyPwaUpdate}
                className="btn-primary shrink-0 px-3 py-1.5 text-xs font-semibold"
              >
                Reload
              </button>
              <button
                onClick={() => setShowUpdateBanner(false)}
                className="shrink-0 text-[var(--theme-text-muted)] transition-colors hover:text-[var(--theme-text-primary)]"
                aria-label="Dismiss"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          </div>
        )}
      </BugReportBoundary>
    </PlatformProvider>
  );
}

export default OAuthRouter;
