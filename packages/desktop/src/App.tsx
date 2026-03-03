import { useEffect, useMemo, useCallback, useRef, useState } from "react";
import { AppShell } from "@freed/ui/components/layout";
import { FeedView } from "@freed/ui/components/feed";
import { PlatformProvider, type PlatformConfig } from "@freed/ui/context";
import { UpdateNotification } from "./components/UpdateNotification";
import { CloudSyncSetupDialog, isCloudSetupDone } from "./components/CloudSyncSetupDialog";
import { useAppStore } from "./lib/store";
import { addRssFeed, importOPMLFeeds, exportFeedsAsOPML } from "./lib/capture";
import { startRssPoller, stopRssPoller } from "./lib/rss-poller";
import { relaunch } from "@tauri-apps/plugin-process";
import { startSync, stopSync, startAllCloudSyncs } from "./lib/sync";
import { XFeedEmptyState } from "./components/XFeedEmptyState";
import { XAuthSection } from "./components/XAuthSection";
import { XSourceIndicator } from "./components/XSourceIndicator";
import { DesktopSyncIndicator } from "./components/DesktopSyncIndicator";
import { MobileSyncTab } from "./components/MobileSyncTab";
import { check, type Update } from "@tauri-apps/plugin-updater";

function App() {
  const initialize = useAppStore((state) => state.initialize);
  const isInitialized = useAppStore((state) => state.isInitialized);
  const isLoading = useAppStore((state) => state.isLoading);
  const error = useAppStore((state) => state.error);

  // Show the first-launch cloud sync setup dialog until the user dismisses it.
  const [showCloudSetup, setShowCloudSetup] = useState(!isCloudSetupDone());

  useEffect(() => {
    initialize();
  }, [initialize]);

  useEffect(() => {
    if (!isInitialized) return;
    startRssPoller();
    // Wire the LAN relay change subscription + client-count polling.
    startSync();
    // Resume cloud sync loops for any previously authenticated providers.
    startAllCloudSyncs();
    return () => {
      stopRssPoller();
      stopSync();
    };
  }, [isInitialized]);

  const pendingUpdate = useRef<Update | null>(null);

  const checkForUpdates = useCallback(async (): Promise<string | null> => {
    const update = await check();
    if (update) {
      pendingUpdate.current = update;
      return update.version;
    }
    return null;
  }, []);

  const applyUpdate = useCallback(async () => {
    const update = pendingUpdate.current;
    if (!update) return;
    await update.downloadAndInstall();
    await relaunch();
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
      FeedEmptyState: XFeedEmptyState,
      checkForUpdates,
      applyUpdate,
    }),
    [checkForUpdates, applyUpdate],
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
      {showCloudSetup && (
        <CloudSyncSetupDialog onDismiss={() => setShowCloudSetup(false)} />
      )}
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
