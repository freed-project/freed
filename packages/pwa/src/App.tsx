import { useEffect, useMemo } from "react";
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
import { SyncIndicator } from "./components/layout/SyncIndicator";
import { PwaFeedEmptyState } from "./components/PwaFeedEmptyState";

function App() {
  const initialize = useAppStore((state) => state.initialize);
  const isInitialized = useAppStore((state) => state.isInitialized);
  const isLoading = useAppStore((state) => state.isLoading);
  const error = useAppStore((state) => state.error);
  const setSyncConnected = useAppStore((state) => state.setSyncConnected);

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
    }),
    [],
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
    </PlatformProvider>
  );
}

export default App;
