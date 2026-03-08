import { useEffect, useMemo, useCallback, useRef, useState, Profiler, type ProfilerOnRenderCallback } from "react";
import { AppShell } from "@freed/ui/components/layout";
import { FeedView } from "@freed/ui/components/feed";
import { PlatformProvider, type PlatformConfig } from "@freed/ui/context";
import { UpdateNotification, type UpdateState } from "./components/UpdateNotification";
import { CloudSyncNudge } from "./components/CloudSyncNudge";
import { useAppStore } from "./lib/store";
import { addRssFeed, importOPMLFeeds, exportFeedsAsOPML } from "./lib/capture";
import { startRssPoller, stopRssPoller } from "./lib/rss-poller";
import { relaunch } from "@tauri-apps/plugin-process";
import { open as shellOpen } from "@tauri-apps/plugin-shell";
import {
  startSync,
  stopSync,
  startAllCloudSyncs,
  stopAllCloudSyncs,
  getActiveProviders,
  getCloudToken,
  clearCloudProvider,
  deleteCloudFile,
} from "./lib/sync";
import { clearLocalDoc } from "./lib/automerge";
import { clearStoredCookies, storeCookies } from "./lib/x-auth";
import { disconnectIg, storeIgAuthState } from "./lib/instagram-auth";
import { disconnectFb, storeFbAuthState } from "./lib/fb-auth";
import { contentCache } from "./lib/content-cache";
import { saveUrlInDesktop } from "./lib/save-url";
import { importMarkdownFiles, exportLibrary } from "./lib/import-export";
import { secureStorage } from "./lib/secure-storage";
import { start as startContentFetcher, stop as stopContentFetcher } from "./lib/content-fetcher";
import { useAppStore as useDesktopStore } from "./lib/store";
import { pickContactViaTauri } from "./lib/contacts";
import { FeedEmptyState } from "./components/FeedEmptyState";
import { XSettingsSection } from "./components/XSettingsSection";
import { FacebookSettingsSection } from "./components/FacebookSettingsSection";
import { InstagramSettingsSection } from "./components/InstagramSettingsSection";
import { XSourceIndicator } from "./components/XSourceIndicator";
import { DesktopSyncIndicator } from "./components/DesktopSyncIndicator";
import { MobileSyncTab } from "./components/MobileSyncTab";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { generateSampleFeeds, generateSampleItems } from "@freed/shared";

const UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const JUST_UPDATED_KEY = "freed-updated-to";

// ---------------------------------------------------------------------------
// React Profiler — activated only under Playwright (VITE_TEST_TAURI=1)
// ---------------------------------------------------------------------------

// Accumulate React render phases when running under Playwright (VITE_TEST_TAURI=1)
interface ProfileEntry { id: string; phase: string; actualDuration: number; baseDuration: number }
if (import.meta.env.VITE_TEST_TAURI === "1") {
  (window as unknown as Record<string, unknown>).__FREED_REACT_PROFILE__ = [] as ProfileEntry[];
}
const onRender: ProfilerOnRenderCallback = (id, phase, actual, base) => {
  const w = window as unknown as Record<string, unknown>;
  const arr = w.__FREED_REACT_PROFILE__ as ProfileEntry[] | undefined;
  if (arr) arr.push({ id, phase, actualDuration: actual, baseDuration: base });
};

function App() {
  const initialize = useAppStore((state) => state.initialize);
  const isInitialized = useAppStore((state) => state.isInitialized);
  const error = useAppStore((state) => state.error);

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
    // Start background content fetcher -- processes article HTML fetch queue.
    startContentFetcher();
    return () => {
      stopRssPoller();
      stopSync();
      stopContentFetcher();
    };
  }, [isInitialized]);

  // --- Update system ---

  // Single source of truth for update state, shared by the toast and the Settings flow.
  const [updateState, setUpdateState] = useState<UpdateState>({ phase: "idle" });
  const pendingUpdate = useRef<Update | null>(null);

  // Show a "just updated" banner for 5s after a process relaunch.
  const [justUpdated, setJustUpdated] = useState<string | null>(null);
  useEffect(() => {
    const version = localStorage.getItem(JUST_UPDATED_KEY);
    if (!version) return;
    localStorage.removeItem(JUST_UPDATED_KEY);
    setJustUpdated(version);
    const t = setTimeout(() => setJustUpdated(null), 5_000);
    return () => clearTimeout(t);
  }, []);

  // Poll for updates in the background every 30 minutes.
  useEffect(() => {
    async function poll() {
      try {
        const update = await check();
        if (update) {
          pendingUpdate.current = update;
          setUpdateState({ phase: "available", update });
        }
      } catch {
        // Silent — offline or endpoint down.
      }
    }
    const initial = setTimeout(poll, 5_000);
    const interval = setInterval(poll, UPDATE_CHECK_INTERVAL_MS);
    return () => {
      clearTimeout(initial);
      clearInterval(interval);
    };
  }, []);

  // Manual check triggered from Settings panel.
  const checkForUpdates = useCallback(async (): Promise<string | null> => {
    const update = await check();
    if (update) {
      pendingUpdate.current = update;
      setUpdateState({ phase: "available", update });
      return update.version;
    }
    return null;
  }, []);

  // Download + install with progress, then relaunch. Used by both the toast
  // and the "Install & Restart" button in Settings via PlatformContext.
  const applyUpdate = useCallback(async () => {
    const update = pendingUpdate.current;
    if (!update) return;

    let totalBytes = 0;
    let downloadedBytes = 0;
    setUpdateState({ phase: "downloading", percent: 0 });

    try {
      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            totalBytes = event.data.contentLength ?? 0;
            break;
          case "Progress":
            downloadedBytes += event.data.chunkLength;
            setUpdateState({
              phase: "downloading",
              percent: totalBytes > 0 ? (downloadedBytes / totalBytes) * 100 : 0,
            });
            break;
          case "Finished":
            setUpdateState({ phase: "ready" });
            break;
        }
      });

      // Persist the installed version across the relaunch so we can greet the user.
      localStorage.setItem(JUST_UPDATED_KEY, update.version);
      await relaunch();
    } catch (err) {
      setUpdateState({
        phase: "error",
        message: err instanceof Error ? err.message : "Update failed",
      });
    }
  }, []);

  const handleRelaunch = useCallback(() => relaunch(), []);
  const handleDismissUpdate = useCallback(() => setUpdateState({ phase: "idle" }), []);

  const handleFactoryReset = useCallback(async (deleteFromCloud: boolean) => {
    const providers = getActiveProviders();
    if (deleteFromCloud) {
      for (const provider of providers) {
        const token = getCloudToken(provider);
        if (token) await deleteCloudFile(provider, token);
      }
    } else {
      stopAllCloudSyncs();
    }
    clearStoredCookies();
    await disconnectFb().catch(() => {});
    await disconnectIg().catch(() => {});
    for (const provider of providers) clearCloudProvider(provider);
    await clearLocalDoc();
    location.reload();
  }, []);

  // Fake-authenticate all social providers for local testing. Writes stub
  // credentials to localStorage (matching the real auth persistence format)
  // and updates Zustand state so the sidebar dots light up without a real login.
  const seedSocialConnections = useCallback(() => {
    const { setXAuth, setFbAuth, setIgAuth } = useAppStore.getState();
    const now = Date.now();

    const xCookies = { ct0: "sample-ct0-token", authToken: "sample-auth-token" };
    storeCookies(xCookies);
    setXAuth({ isAuthenticated: true, cookies: xCookies, username: "sample_user" });

    const fbState = { isAuthenticated: true, lastCheckedAt: now };
    storeFbAuthState(fbState);
    setFbAuth(fbState);

    const igState = { isAuthenticated: true, lastCheckedAt: now };
    storeIgAuthState(igState);
    setIgAuth(igState);
  }, []);

  // In dev mode, auto-seed sample data on first page load of each browser
  // session. sessionStorage guard prevents re-seeding on hot-reload while
  // still running fresh on every full browser open (e.g. new worktree test).
  useEffect(() => {
    if (!isInitialized || !import.meta.env.DEV) return;
    if (sessionStorage.getItem("freed_dev_seeded")) return;
    sessionStorage.setItem("freed_dev_seeded", "1");

    const { addFeed, addItems } = useAppStore.getState();
    generateSampleFeeds().forEach((f) => addFeed(f));
    addItems(generateSampleItems());
    // Skip social auth seeding in the Tauri mock E2E environment -- tests
    // that verify the disconnected/connected states set auth explicitly.
    if (!import.meta.env.VITE_TEST_TAURI) {
      seedSocialConnections();
    }
  }, [isInitialized, seedSocialConnections]);

  const platform: PlatformConfig = useMemo(
    () => ({
      store: useAppStore,
      addRssFeed,
      importOPMLFeeds,
      exportFeedsAsOPML,
      headerDragRegion: true,
      SourceIndicator: XSourceIndicator,
      HeaderSyncIndicator: DesktopSyncIndicator,
      SettingsExtraSections: MobileSyncTab,
      FeedEmptyState: FeedEmptyState,
      XSettingsContent: XSettingsSection,
      FacebookSettingsContent: FacebookSettingsSection,
      InstagramSettingsContent: InstagramSettingsSection,
      checkForUpdates,
      applyUpdate,
      factoryReset: handleFactoryReset,
      seedSocialConnections,
      activeCloudProviderLabel: () => {
        const providers = getActiveProviders();
        if (providers.length === 0) return null;
        return providers
          .map((p) => (p === "gdrive" ? "Google Drive" : "Dropbox"))
          .join(" & ");
      },
      // Library import/export
      saveUrl: async (url, options) => {
        await saveUrlInDesktop(url, options);
      },
      importMarkdown: importMarkdownFiles,
      exportMarkdown: () => {
        const items = Object.values(useDesktopStore.getState().items ?? {});
        return exportLibrary(items);
      },
      // Local content cache (Tauri FS layer)
      getLocalContent: (globalId) => contentCache.get(globalId),
      // Encrypted API key store (type-widened: ApiKeyProvider -> string for PlatformConfig interface)
      secureStorage: secureStorage as {
        getApiKey: (provider: string) => Promise<string | null>;
        setApiKey: (provider: string, key: string) => Promise<void>;
        clearApiKey: (provider: string) => Promise<void>;
      },
      openUrl: (url: string) => { void shellOpen(url); },
      pickContact: pickContactViaTauri,
    }),
    [checkForUpdates, applyUpdate, handleFactoryReset, seedSocialConnections],
  );

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
    <Profiler id="App" onRender={onRender}>
    <PlatformProvider value={platform}>
      <div className="h-screen flex flex-col bg-transparent">
        <AppShell>
          <FeedView />
        </AppShell>
        <UpdateNotification
          state={updateState}
          onInstall={applyUpdate}
          onRelaunch={handleRelaunch}
          onDismiss={handleDismissUpdate}
        />
      </div>

      {/* Toast nudge — shown every launch while no cloud provider is connected */}
      <CloudSyncNudge />

      {/* Post-restart confirmation — shown for 5s after a successful update relaunch */}
      {justUpdated && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 animate-slide-up pointer-events-none">
          <div className="glass-card px-4 py-3 shadow-lg border border-[rgba(34,197,94,0.3)] flex items-center gap-2">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path d="M3 8l3.5 3.5L13 5" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="text-sm text-text-primary">
              Updated to <span className="font-mono font-bold">v{justUpdated}</span>
            </span>
          </div>
        </div>
      )}
    </PlatformProvider>
    </Profiler>
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
