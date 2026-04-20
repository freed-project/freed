import { useEffect, useMemo, useCallback, useRef, useState, Profiler, type ProfilerOnRenderCallback } from "react";
import { formatReleaseVersion, type ReleaseChannel } from "@freed/shared";
import { AppShell } from "@freed/ui/components/layout";
import { FeedView } from "@freed/ui/components/feed";
import { BugReportBoundary } from "@freed/ui/components/BugReportBoundary";
import { FatalErrorScreen } from "@freed/ui/components/FatalErrorScreen";
import { LocalPreviewBadge } from "@freed/ui/components/LocalPreviewBadge";
import { LegalGate } from "@freed/ui/components/legal/LegalGate";
import { GoogleContactsSection } from "@freed/ui/components/settings/GoogleContactsSection";
import { ToastContainer } from "@freed/ui/components/Toast";
import {
  PlatformProvider,
  type AvailableUpdateInfo,
  type PlatformConfig,
  type UpdateDownloadProgress,
} from "@freed/ui/context";
import { useDebugStore } from "@freed/ui/lib/debug-store";
import { UpdateNotification, type UpdateState } from "./components/UpdateNotification";
import { CloudSyncNudge } from "./components/CloudSyncNudge";
import { useAppStore } from "./lib/store";
import { addRssFeed, importOPMLFeeds, exportFeedsAsOPML, refreshAllFeeds } from "./lib/capture";
import { startRssPoller, stopRssPoller } from "./lib/rss-poller";
import { exit, relaunch } from "@tauri-apps/plugin-process";
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
  startCloudSync,
  initiateDesktopOAuth,
  storeCloudToken,
  type CloudProvider,
} from "./lib/sync";
import { clearLocalDoc, getItemPreservedText } from "./lib/automerge";
import { isTauri } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { log } from "./lib/logger";
import { setLogTransport } from "@freed/ui/lib/debug-store";
import { clearStoredCookies, storeCookies } from "./lib/x-auth";
import { disconnectIg, storeIgAuthState } from "./lib/instagram-auth";
import { disconnectFb, storeFbAuthState } from "./lib/fb-auth";
import { disconnectLi, storeLiAuthState } from "./lib/li-auth";
import { captureXTimeline } from "./lib/x-capture";
import { captureFbFeed } from "./lib/fb-capture";
import { captureIgFeed } from "./lib/instagram-capture";
import { captureLiFeed } from "./lib/li-capture";
import { contentCache } from "./lib/content-cache";
import { saveUrlInDesktop } from "./lib/save-url";
import { importMarkdownFiles, exportLibrary } from "./lib/import-export";
import { secureStorage } from "./lib/secure-storage";
import { start as startContentFetcher, stop as stopContentFetcher } from "./lib/content-fetcher";
import { useAppStore as useDesktopStore, withProviderSyncing } from "./lib/store";
import { pickContactViaTauri } from "./lib/contacts";
import { FeedEmptyState } from "./components/FeedEmptyState";
import { XSettingsSection } from "./components/XSettingsSection";
import { FacebookSettingsSection } from "./components/FacebookSettingsSection";
import { InstagramSettingsSection } from "./components/InstagramSettingsSection";
import { LinkedInSettingsSection } from "./components/LinkedInSettingsSection";
import { XSourceIndicator } from "./components/XSourceIndicator";
import { MobileSyncTab } from "./components/MobileSyncTab";
import { DesktopLegalSettingsSection } from "./components/DesktopLegalSettingsSection";
import { refreshSampleLibraryData } from "@freed/ui/lib/sample-library-seed";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { acceptDesktopBundle, hasAcceptedDesktopBundle } from "./lib/legal-consent";
import { clearProviderPause, forgetRssFeedHealth, initProviderHealth } from "./lib/provider-health";
import { getDesktopSourceStatus } from "./lib/source-status";
import { clearContactSyncState } from "./lib/contact-sync-storage";
import { clearSnapshots, startSnapshotManager, stopSnapshotManager } from "./lib/snapshots";
import { useDesktopNavigationHistory } from "./lib/navigation-history";
import { desktopBugReporting } from "./lib/bug-report";
import { clearFatalRuntimeError, useFatalRuntimeError } from "@freed/ui/lib/bug-report";
import { startMemoryMonitor, stopMemoryMonitor } from "./lib/memory-monitor";
import {
  bootstrapDesktopReleaseChannel,
  getDesktopUpdateTargets,
  persistDesktopReleaseChannel,
} from "./lib/release-channel";

const UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const JUST_UPDATED_KEY = "freed-updated-to";
const IS_LOCAL_PREVIEW = import.meta.env.DEV && import.meta.env.VITE_TEST_TAURI !== "1";
const LOCAL_PREVIEW_LABEL = import.meta.env.DEV
  ? import.meta.env.VITE_FREED_PREVIEW_LABEL?.trim() || null
  : null;
const RENDERER_HEARTBEAT_INTERVAL_MS = 60 * 1000;
const DOWNLOAD_PAGE_URL = "https://freed.wtf/get";

type PendingDesktopUpdate = {
  channel: ReleaseChannel;
  update: Update;
};

// Register the desktop log transport so addDebugEvent calls from ui/ flow
// through the native logger in both local preview and release builds.
setLogTransport((level, msg) => log[level](msg));

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
  const [legalResolved, setLegalResolved] = useState(false);
  const [legalAccepted, setLegalAccepted] = useState(false);
  const [releaseChannel, setReleaseChannelState] = useState<ReleaseChannel>(() =>
    bootstrapDesktopReleaseChannel(),
  );
  const fatalError = useFatalRuntimeError();

  useDesktopNavigationHistory(legalAccepted);

  useEffect(() => {
    void hasAcceptedDesktopBundle()
      .then((accepted) => {
        setLegalAccepted(accepted);
      })
      .catch((error) => {
        log.error(
          `[legal] failed to resolve desktop bundle consent: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        setLegalAccepted(false);
      })
      .finally(() => {
        setLegalResolved(true);
      });
  }, []);

  useEffect(() => {
    if (!legalAccepted) return;
    initialize();
  }, [initialize, legalAccepted]);

  useEffect(() => {
    if (!legalAccepted || !isInitialized) return;
    void initProviderHealth();
    startRssPoller();
    // Wire the LAN relay change subscription + client-count polling.
    startSync();
    // Resume cloud sync loops for any previously authenticated providers.
    startAllCloudSyncs();
    void startSnapshotManager();
    // Start background content fetcher -- processes article HTML fetch queue.
    startContentFetcher();
    startMemoryMonitor();
    return () => {
      stopRssPoller();
      stopSync();
      stopSnapshotManager();
      stopContentFetcher();
      stopMemoryMonitor();
    };
  }, [isInitialized, legalAccepted]);

  // Log OS sleep/wake transitions so the log file shows where overnight
  // freezes begin. These events are emitted by Tauri on macOS suspend/resume.
  useEffect(() => {
    if (!legalAccepted) return;
    log.info("[app] desktop app started");
    if (!isTauri()) return;

    const cleanups: Array<() => void> = [];

    listen("tauri://suspend", () => {
      log.info("[app] system suspend (sleep)");
    }).then((unlisten) => cleanups.push(unlisten));

    listen("tauri://resume", () => {
      log.info("[app] system resume (wake)");
    }).then((unlisten) => cleanups.push(unlisten));

    return () => cleanups.forEach((fn) => fn());
  }, [legalAccepted]);

  useEffect(() => {
    if (!isTauri()) return;

    let heartbeatSeq = 0;

    const sendRendererHeartbeat = (reason: string) => {
      heartbeatSeq += 1;
      void emit("renderer-heartbeat", {
        seq: heartbeatSeq,
        ts: Date.now(),
        reason,
        visibility: document.visibilityState,
        href: window.location.href,
      }).catch(() => {
        // If the renderer is already failing, heartbeat delivery may fail too.
      });
    };

    sendRendererHeartbeat("startup");

    const interval = window.setInterval(() => {
      sendRendererHeartbeat("interval");
    }, RENDERER_HEARTBEAT_INTERVAL_MS);

    const handleVisibilityChange = () => {
      sendRendererHeartbeat(`visibility:${document.visibilityState}`);
    };

    const handlePageHide = () => {
      sendRendererHeartbeat("pagehide");
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pagehide", handlePageHide);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pagehide", handlePageHide);
      sendRendererHeartbeat("cleanup");
    };
  }, []);

  // --- Update system ---

  // Single source of truth for update state, shared by the toast and the Settings flow.
  const [updateState, setUpdateState] = useState<UpdateState>({ phase: "idle" });
  const pendingUpdate = useRef<PendingDesktopUpdate | null>(null);
  const crashRecoveryUpdateCheckStarted = useRef(false);

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

  const findAvailableUpdate = useCallback(async (): Promise<PendingDesktopUpdate | null> => {
    const targets = await getDesktopUpdateTargets(releaseChannel);
    for (const candidate of targets) {
      const update = await check({ target: candidate.target });
      if (update) {
        return { channel: candidate.channel, update };
      }
    }
    return null;
  }, [releaseChannel]);

  // Poll for updates in the background every 30 minutes.
  useEffect(() => {
    if (!legalAccepted || IS_LOCAL_PREVIEW) return;

    async function poll() {
      try {
        const availableUpdate = await findAvailableUpdate();
        if (availableUpdate) {
          pendingUpdate.current = availableUpdate;
          setUpdateState({
            phase: "available",
            channel: availableUpdate.channel,
            update: availableUpdate.update,
          });
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
  }, [findAvailableUpdate, legalAccepted]);

  // Manual check triggered from Settings panel.
  const checkForUpdates = useCallback(async (): Promise<AvailableUpdateInfo | null> => {
    if (IS_LOCAL_PREVIEW) return null;

    const availableUpdate = await findAvailableUpdate();
    if (availableUpdate) {
      pendingUpdate.current = availableUpdate;
      setUpdateState({
        phase: "available",
        channel: availableUpdate.channel,
        update: availableUpdate.update,
      });
      return {
        version: availableUpdate.update.version,
        channel: availableUpdate.channel,
      };
    }
    return null;
  }, [findAvailableUpdate]);

  const isStartupCrash = Boolean(error && !isInitialized);
  const isCrashState = isStartupCrash || Boolean(fatalError);

  // Recovery mode should not wait for the 5 second background poll.
  useEffect(() => {
    if (!legalAccepted || IS_LOCAL_PREVIEW || !isCrashState) {
      crashRecoveryUpdateCheckStarted.current = false;
      return;
    }
    if (crashRecoveryUpdateCheckStarted.current) return;
    crashRecoveryUpdateCheckStarted.current = true;
    void checkForUpdates().catch(() => {
      // Silent. Recovery still exposes the manual download path.
    });
  }, [checkForUpdates, isCrashState, legalAccepted]);

  // Download + install with progress, then relaunch. Used by both the toast
  // and the "Install & Restart" button in Settings via PlatformContext.
  const applyUpdate = useCallback(async () => {
    const pending = pendingUpdate.current;
    if (!pending) return;
    const update = pending.update;

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
  const handleOpenLatestDownload = useCallback(() => {
    void shellOpen(DOWNLOAD_PAGE_URL);
  }, []);
  const setReleaseChannel = useCallback((channel: ReleaseChannel) => {
    if (channel === releaseChannel) {
      return;
    }

    persistDesktopReleaseChannel(channel);
    pendingUpdate.current = null;
    setUpdateState({ phase: "idle" });
    setReleaseChannelState(channel);
  }, [releaseChannel]);

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
    await disconnectLi().catch(() => {});
    for (const provider of providers) clearCloudProvider(provider);
    clearContactSyncState();
    await clearSnapshots();
    await clearLocalDoc();
    location.reload();
  }, []);

  const retryCloudProvider = useCallback(async (provider: CloudProvider) => {
    const token = getCloudToken(provider);
    if (!token) return;
    await startCloudSync(provider, token);
  }, []);

  const reconnectCloudProvider = useCallback(async (provider: CloudProvider) => {
    clearCloudProvider(provider);
    const token = await initiateDesktopOAuth(provider);
    storeCloudToken(provider, token);
    await startCloudSync(provider, token);
  }, []);

  const connectGoogleContacts = useCallback(async () => {
    const token = await initiateDesktopOAuth("gdrive");
    storeCloudToken("gdrive", token);
    await startCloudSync("gdrive", token);
  }, []);

  // Fake-authenticate all social providers for local testing. Writes stub
  // credentials to localStorage (matching the real auth persistence format)
  // and updates Zustand state so the sidebar dots light up without a real login.
  const seedSocialConnections = useCallback(() => {
    const { setXAuth, setFbAuth, setIgAuth, setLiAuth } = useAppStore.getState();
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

    const liState = { isAuthenticated: true, lastCheckedAt: now };
    storeLiAuthState(liState);
    setLiAuth(liState);
  }, []);

  // In dev mode, auto-seed sample data on first page load of each browser
  // session. sessionStorage guard prevents re-seeding on hot-reload while
  // still running fresh on every full browser open (e.g. new worktree test).
  // Skip entirely under VITE_TEST_TAURI: E2E tests manage their own data
  // setup, and the burst of addFeed/addItems state updates causes re-renders
  // that detach DOM elements while Playwright is filling form fields.
  useEffect(() => {
    if (!isInitialized || !import.meta.env.DEV || import.meta.env.VITE_TEST_TAURI === "1") return;
    if (sessionStorage.getItem("freed_dev_seeded")) return;
    sessionStorage.setItem("freed_dev_seeded", "1");

    void refreshSampleLibraryData({
      ...useAppStore.getState(),
      seedSocialConnections,
    });
  }, [isInitialized, seedSocialConnections]);

  const platform: PlatformConfig = useMemo(
    () => ({
      store: useAppStore,
      feedMediaPreviews: "reader-only",
      addRssFeed,
      importOPMLFeeds,
      exportFeedsAsOPML,
      headerDragRegion: true,
      startWindowDrag:
        import.meta.env.VITE_TEST_TAURI === "1" || isTauri()
          ? () => getCurrentWindow().startDragging()
          : undefined,
      SourceIndicator: XSourceIndicator,
      HeaderSyncIndicator: null,
      SettingsExtraSections: MobileSyncTab,
      LegalSettingsContent: DesktopLegalSettingsSection,
      FeedEmptyState: FeedEmptyState,
      XSettingsContent: XSettingsSection,
      FacebookSettingsContent: FacebookSettingsSection,
      InstagramSettingsContent: InstagramSettingsSection,
      LinkedInSettingsContent: LinkedInSettingsSection,
      GoogleContactsSettingsContent: GoogleContactsSection,
      checkForUpdates: IS_LOCAL_PREVIEW ? undefined : checkForUpdates,
      applyUpdate: IS_LOCAL_PREVIEW ? undefined : applyUpdate,
      releaseChannel: IS_LOCAL_PREVIEW ? undefined : releaseChannel,
      setReleaseChannel: IS_LOCAL_PREVIEW ? undefined : setReleaseChannel,
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
      retryCloudProvider,
      reconnectCloudProvider,
      forgetRssFeedHealth,
      syncRssNow: refreshAllFeeds,
      syncSourceNow: async (sourceId) => {
        const state = useDesktopStore.getState();
        const health = useDebugStore.getState().health;
        const isPaused =
          (sourceId === "x" ||
            sourceId === "facebook" ||
            sourceId === "instagram" ||
            sourceId === "linkedin") &&
          health?.providers[sourceId]?.status === "paused";

        if (sourceId === "rss") {
          await refreshAllFeeds();
          return;
        }

        if (sourceId === "x" && state.xAuth.isAuthenticated && state.xAuth.cookies) {
          if (isPaused) {
            await clearProviderPause("x");
          }
          await withProviderSyncing("x", () => captureXTimeline(state.xAuth.cookies!));
          return;
        }

        if (sourceId === "facebook" && state.fbAuth.isAuthenticated) {
          if (isPaused) {
            await clearProviderPause("facebook");
          }
          await withProviderSyncing("facebook", () => captureFbFeed());
          return;
        }

        if (sourceId === "instagram" && state.igAuth.isAuthenticated) {
          if (isPaused) {
            await clearProviderPause("instagram");
          }
          await withProviderSyncing("instagram", () => captureIgFeed());
          return;
        }

        if (sourceId === "linkedin" && state.liAuth.isAuthenticated) {
          if (isPaused) {
            await clearProviderPause("linkedin");
          }
          await withProviderSyncing("linkedin", () => captureLiFeed());
        }
      },
      getSourceStatus: (sourceId) => {
        const desktopState = useDesktopStore.getState();
        const health = useDebugStore.getState().health;
        return getDesktopSourceStatus(sourceId, desktopState, health);
      },
      // Local content cache (Tauri FS layer)
      getLocalContent: (globalId) => contentCache.get(globalId),
      getLocalPreservedText: (globalId) => getItemPreservedText(globalId),
      // Encrypted API key store (type-widened: ApiKeyProvider -> string for PlatformConfig interface)
      secureStorage: secureStorage as {
        getApiKey: (provider: string) => Promise<string | null>;
        setApiKey: (provider: string, key: string) => Promise<void>;
        clearApiKey: (provider: string) => Promise<void>;
      },
      openUrl: (url: string) => { void shellOpen(url); },
      pickContact: pickContactViaTauri,
      googleContacts: {
        getToken: () => localStorage.getItem("freed_cloud_token_gdrive"),
        connect: connectGoogleContacts,
      },
      updateDownloadProgress: ((): UpdateDownloadProgress | null => {
        if (updateState.phase === "downloading") return { phase: "downloading", percent: updateState.percent };
        if (updateState.phase === "error") return { phase: "error", message: updateState.message };
        return null;
      })(),
      bugReporting: desktopBugReporting,
    }),
     [checkForUpdates, applyUpdate, connectGoogleContacts, handleFactoryReset, reconnectCloudProvider, releaseChannel, retryCloudProvider, seedSocialConnections, setReleaseChannel, updateState],
  );

  if (!legalResolved) {
    return (
      <div className="h-screen flex items-center justify-center bg-transparent">
        <div className="rounded-2xl border border-white/10 bg-[rgba(10,10,10,0.72)] px-5 py-4 text-sm text-white/80 shadow-2xl shadow-black/60 backdrop-blur-xl">
          Opening Freed Desktop...
        </div>
      </div>
    );
  }

  if (!legalAccepted) {
    return (
      <LegalGate
        productName="Freed Desktop"
        includeEula
        acceptLabel="Agree and open Freed Desktop"
        declineLabel="Quit"
        openUrl={(url: string) => {
          void shellOpen(url);
        }}
        onAccept={async () => {
          await acceptDesktopBundle();
          setLegalAccepted(true);
        }}
        onDecline={async () => {
          await exit(0);
        }}
      />
    );
  }

  return (
    <Profiler id="App" onRender={onRender}>
      <PlatformProvider value={platform}>
        {isStartupCrash ? (
          <FatalErrorScreen
            error={{ message: error ?? "Unknown fatal error" }}
            productName="Freed Desktop"
            onRetry={() => window.location.reload()}
            onSecondaryAction={handleOpenLatestDownload}
            secondaryActionLabel="Download latest Freed Desktop"
          />
        ) : fatalError ? (
          <FatalErrorScreen
            error={fatalError}
            productName="Freed Desktop"
            onRetry={() => {
              clearFatalRuntimeError();
              window.location.reload();
            }}
            onSecondaryAction={handleOpenLatestDownload}
            secondaryActionLabel="Download latest Freed Desktop"
          />
        ) : (
          <>
            <BugReportBoundary>
              <div className="h-screen flex flex-col bg-transparent">
                <LocalPreviewBadge label={LOCAL_PREVIEW_LABEL} />
                <AppShell>
                  <FeedView />
                </AppShell>
              </div>
            </BugReportBoundary>

            {/* Toast nudge — shown every launch while no cloud provider is connected */}
            <CloudSyncNudge />
            <ToastContainer />

            {/* Post-restart confirmation — shown for 5s after a successful update relaunch */}
            {justUpdated && (
              <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 animate-slide-up pointer-events-none">
                <div className="rounded-2xl bg-[var(--freed-surface)] px-4 py-3 shadow-lg border border-[rgba(34,197,94,0.3)] flex items-center gap-2">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
                    <path d="M3 8l3.5 3.5L13 5" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span className="text-sm text-text-primary">
                    Updated to <span className="font-mono font-bold">v{formatReleaseVersion(justUpdated)}</span>
                  </span>
                </div>
              </div>
            )}
          </>
        )}

        <UpdateNotification
          state={updateState}
          onInstall={applyUpdate}
          onRelaunch={handleRelaunch}
          onDismiss={handleDismissUpdate}
        />
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
