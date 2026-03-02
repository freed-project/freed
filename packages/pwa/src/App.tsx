import { useEffect, useMemo, useState, useCallback } from "react";
import { AppShell } from "./components/layout/AppShell";
import { FeedView } from "./components/feed/FeedView";
import { ToastContainer } from "./components/Toast";
import { PlatformProvider, type PlatformConfig } from "./context/PlatformContext";
import { useAppStore } from "./lib/store";
import { addRssFeed, importOPMLFeeds, exportFeedsAsOPML } from "./lib/capture";
import {
  connect,
  disconnect,
  onStatusChange,
  getStoredRelayUrl,
} from "./lib/sync";
import { checkForPwaUpdate, applyPwaUpdate, onUpdateAvailable } from "./lib/pwa-updater";
import { SyncIndicator } from "./components/layout/SyncIndicator";
import { PwaFeedEmptyState } from "./components/PwaFeedEmptyState";

function App() {
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

    const storedUrl = getStoredRelayUrl();
    if (storedUrl) {
      connect(storedUrl);
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

  const platform: PlatformConfig = useMemo(
    () => ({
      store: useAppStore,
      addRssFeed,
      importOPMLFeeds,
      exportFeedsAsOPML,
      SidebarConnectionSection: null,
      SourceIndicator: null,
      HeaderSyncIndicator: SyncIndicator,
      SettingsExtraSections: null,
      FeedEmptyState: PwaFeedEmptyState,
      checkForUpdates,
      applyUpdate: applyPwaUpdate,
    }),
    [checkForUpdates],
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
