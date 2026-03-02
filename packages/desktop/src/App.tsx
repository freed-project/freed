import { useEffect, useMemo, useCallback } from "react";
import { AppShell } from "@freed/pwa/components/layout";
import { FeedView } from "@freed/pwa/components/feed";
import { PlatformProvider, type PlatformConfig } from "@freed/pwa/context";
import { UpdateNotification } from "./components/UpdateNotification";
import { useAppStore } from "./lib/store";
import { addRssFeed, importOPMLFeeds, exportFeedsAsOPML } from "./lib/capture";
import { startRssPoller, stopRssPoller } from "./lib/rss-poller";
import { XAuthSection } from "./components/XAuthSection";
import { XSourceIndicator } from "./components/XSourceIndicator";
import { DesktopSyncIndicator } from "./components/DesktopSyncIndicator";
import { MobileSyncTab } from "./components/MobileSyncTab";
import { check } from "@tauri-apps/plugin-updater";

function App() {
  const initialize = useAppStore((state) => state.initialize);
  const isInitialized = useAppStore((state) => state.isInitialized);
  const isLoading = useAppStore((state) => state.isLoading);
  const error = useAppStore((state) => state.error);

  useEffect(() => {
    initialize();
  }, [initialize]);

  useEffect(() => {
    if (!isInitialized) return;
    startRssPoller();
    return () => stopRssPoller();
  }, [isInitialized]);

  const checkForUpdates = useCallback(async (): Promise<string | null> => {
    const update = await check();
    return update?.version ?? null;
  }, []);

  const platform: PlatformConfig = useMemo(
    () => ({
      store: useAppStore,
      addRssFeed,
      importOPMLFeeds,
      exportFeedsAsOPML,
      headerDragRegion: true,
      SidebarConnectionSection: XAuthSection,
      SourceIndicator: XSourceIndicator,
      HeaderSyncIndicator: DesktopSyncIndicator,
      SettingsExtraSections: MobileSyncTab,
      FeedEmptyState: null,
      checkForUpdates,
    }),
    [checkForUpdates],
  );

  if (!isInitialized && isLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-transparent">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-glow-purple border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-text-secondary">Loading your feed...</p>
        </div>
      </div>
    );
  }

  if (error && !isInitialized) {
    return (
      <div className="h-screen flex items-center justify-center bg-transparent">
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
      <div className="h-screen flex flex-col bg-transparent">
        <AppShell>
          <FeedView />
        </AppShell>
        <UpdateNotification />
      </div>
    </PlatformProvider>
  );
}

export default App;

declare global {
  interface Window {
    __TAURI__?: {
      core: {
        invoke: (
          cmd: string,
          args?: Record<string, unknown>,
        ) => Promise<unknown>;
      };
    };
  }
}
