import { useEffect, useMemo, useState, useCallback } from "react";
import { AppShell } from "@freed/ui/components/layout";
import { FeedView } from "@freed/ui/components/feed";
import { ToastContainer } from "@freed/ui/components/Toast";
import { OAuthCallback } from "./components/OAuthCallback";
import { PlatformProvider, type PlatformConfig } from "@freed/ui/context";
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
import { checkForPwaUpdate, applyPwaUpdate, onUpdateAvailable } from "./lib/pwa-updater";
import { pickContactViaWebApi } from "./lib/contacts";
import { SyncIndicator } from "./components/layout/SyncIndicator";
import { PwaFeedEmptyState } from "./components/PwaFeedEmptyState";
import { PwaSyncSettings } from "./components/PwaSyncSettings";

function App() {
  // Intercept OAuth callback before rendering the main app.
  if (window.location.pathname === "/oauth-callback") {
    return <OAuthCallback />;
  }
  const initialize = useAppStore((state) => state.initialize);
  const isInitialized = useAppStore((state) => state.isInitialized);
  const isLoading = useAppStore((state) => state.isLoading);
  const error = useAppStore((state) => state.error);
  const setSyncConnected = useAppStore((state) => state.setSyncConnected);
  const [showUpdateBanner, setShowUpdateBanner] = useState(false);

  useEffect(() => {
    initialize();
  }, [initialize]);

  useEffect(() => {
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
  }, [setSyncConnected]);

  useEffect(() => {
    return onUpdateAvailable(() => setShowUpdateBanner(true));
  }, []);

  const checkForUpdates = useCallback(() => checkForPwaUpdate(), []);

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
      addRssFeed: subscribeToFeed,
      exportFeedsAsOPML,
      SourceIndicator: null,
      HeaderSyncIndicator: SyncIndicator,
      SettingsExtraSections: PwaSyncSettings,
      FeedEmptyState: PwaFeedEmptyState,
      XSettingsContent: null,
      checkForUpdates,
      applyUpdate: applyPwaUpdate,
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
    }),
    [checkForUpdates, handleFactoryReset],
  );

  if (!isInitialized && isLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-freed-black">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-glow-purple border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-text-secondary">Loading your feed...</p>
        </div>
      </div>
    );
  }

  if (error && !isInitialized) {
    return (
      <div className="h-screen flex items-center justify-center bg-freed-black">
        <div className="text-center max-w-md p-6">
          <p className="text-red-400 mb-4">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="btn-primary"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <PlatformProvider value={platform}>
      <AppShell>
        <FeedView />
      </AppShell>
      <ToastContainer />
      {showUpdateBanner && (
        <div className="fixed bottom-4 right-4 z-50 max-w-sm animate-slide-up">
          <div className="bg-[#141414] border border-[rgba(139,92,246,0.3)] rounded-xl p-4 shadow-lg flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white">New version available</p>
              <p className="text-xs text-[#71717a] mt-0.5">Reload to apply the update.</p>
            </div>
            <button
              onClick={applyPwaUpdate}
              className="shrink-0 text-xs font-semibold px-3 py-1.5 rounded-md bg-[#8b5cf6] text-white hover:bg-[#7c3aed] transition-colors"
            >
              Reload
            </button>
            <button
              onClick={() => setShowUpdateBanner(false)}
              className="shrink-0 text-[#71717a] hover:text-white transition-colors"
              aria-label="Dismiss"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </PlatformProvider>
  );
}

export default App;
