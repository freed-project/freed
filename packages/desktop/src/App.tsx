import { useEffect, useMemo, useCallback, useRef, useState, Profiler, type ProfilerOnRenderCallback } from "react";
import {
  formatReleaseVersion,
  getWebsiteHostForChannel,
  type ReleaseChannel,
} from "@freed/shared";
import { AppShell } from "@freed/ui/components/layout";
import { FeedView } from "@freed/ui/components/feed";
import { BugReportBoundary } from "@freed/ui/components/BugReportBoundary";
import { FatalErrorScreen } from "@freed/ui/components/FatalErrorScreen";
import { LocalPreviewBadge } from "@freed/ui/components/LocalPreviewBadge";
import { LegalGate } from "@freed/ui/components/legal/LegalGate";
import { GoogleContactsSection } from "@freed/ui/components/settings/GoogleContactsSection";
import { ToastContainer, toast } from "@freed/ui/components/Toast";
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
import { addRssFeed, importOPMLFeeds, exportFeedsAsOPML, refreshRssFeeds } from "./lib/capture";
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
  getValidCloudToken,
  forceRefreshCloudToken,
  clearCloudProvider,
  deleteCloudFile,
  startCloudSync,
  setGoogleDriveFetch,
  initiateDesktopOAuth,
  isOAuthCanceledError,
  storeCloudToken,
  type CloudProvider,
} from "./lib/sync";
import { clearLocalDoc, getCachedDocStats, getItemPreservedText } from "./lib/automerge";
import { invoke, isTauri } from "@tauri-apps/api/core";
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
import { hydrateReaderItem as hydrateReaderItemForDesktop } from "./lib/reader-hydration";
import { importMarkdownFiles, exportLibrary } from "./lib/import-export";
import { secureStorage } from "./lib/secure-storage";
import { localAIModels } from "./lib/local-ai-models";
import { pinReaderItem, start as startContentFetcher, stop as stopContentFetcher } from "./lib/content-fetcher";
import { start as startSemanticClassifier, stop as stopSemanticClassifier } from "./lib/semantic-classifier";
import { useAppStore as useDesktopStore, withProviderSyncing } from "./lib/store";
import { pickContactViaTauri } from "./lib/contacts";
import { fetchGoogleContactsViaTauri } from "./lib/google-contacts";
import { googleDriveFetchViaTauri } from "./lib/google-drive";
import { FeedEmptyState } from "./components/FeedEmptyState";
import { XSettingsSection } from "./components/XSettingsSection";
import { FacebookSettingsSection } from "./components/FacebookSettingsSection";
import { InstagramSettingsSection } from "./components/InstagramSettingsSection";
import { LinkedInSettingsSection } from "./components/LinkedInSettingsSection";
import { XSourceIndicator } from "./components/XSourceIndicator";
import { MobileSyncTab } from "./components/MobileSyncTab";
import { DesktopLegalSettingsSection } from "./components/DesktopLegalSettingsSection";
import { refreshSampleLibraryData } from "@freed/ui/lib/sample-library-seed";
import { acceptDesktopBundle, hasAcceptedDesktopBundle } from "./lib/legal-consent";
import { clearProviderPause, forgetRssFeedHealth, initProviderHealth } from "./lib/provider-health";
import { getDesktopSourceStatus } from "./lib/source-status";
import { clearContactSyncState, setContactSyncError } from "./lib/contact-sync-storage";
import { clearSnapshots, startSnapshotManager, stopSnapshotManager } from "./lib/snapshots";
import { useDesktopNavigationHistory } from "./lib/navigation-history";
import { desktopBugReporting } from "./lib/bug-report";
import { importMetaExportFiles } from "./lib/meta-export-import";
import { summarizeMediaVault } from "./lib/media-vault";
import { publishStoryWallToGitHubPages } from "./lib/story-wall-publisher";
import { clearFatalRuntimeError, useFatalRuntimeError } from "@freed/ui/lib/bug-report";
import { startMemoryMonitor, stopMemoryMonitor } from "./lib/memory-monitor";
import {
  noteMemoryPressure,
  noteRendererHeartbeat,
  noteRendererRecoveryState,
  type RendererRecoveryStateEvent,
} from "./lib/background-runtime-coordinator";
import {
  bootstrapDesktopReleaseChannel,
  loadDesktopReleaseChannelState,
  persistDesktopInstalledReleaseChannel,
  persistDesktopReleaseChannel,
} from "./lib/release-channel";
import {
  checkDesktopUpdate,
  installPendingDesktopUpdate,
  JUST_UPDATED_KEY,
  type PendingDesktopUpdate,
  resolveDesktopDownloadFallbackUrl,
} from "./lib/desktop-updater";
import { rendererHeartbeatTiming } from "./lib/renderer-heartbeat";
import { DESKTOP_CHANGELOG_PREVIEW } from "./lib/changelog-preview";

const UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const IS_LOCAL_PREVIEW = import.meta.env.DEV && import.meta.env.VITE_TEST_TAURI !== "1";
const LOCAL_PREVIEW_LABEL = import.meta.env.VITE_FREED_PREVIEW_LABEL?.trim() || null;
const RENDERER_HEARTBEAT_INTERVAL_MS = 15 * 1000;
const LOCKED_STARTUP_RECHECK_MS = 30 * 1000;

interface DesktopSessionState {
  available: boolean;
  screenLocked: boolean;
  error?: string | null;
}

type LockedStartupState = "checking" | "ready" | "locked";

type FriendGraphSurfacePerf = {
  modelBuildMs?: number;
  layoutMs?: number;
  sceneSyncMs?: number;
  labelPassMs?: number;
  sceneSyncCount?: number;
  contentSyncCount?: number;
  transformOnlySyncCount?: number;
  edgeRebuildCount?: number;
  nodeRestyleCount?: number;
  labelLayoutCount?: number;
  avatarDisplayCount?: number;
  visibleLabelCount?: number;
  visibleNodeLabelCount?: number;
  visibleProviderLabelCount?: number;
  denseRenderMode?: "dense" | "containers";
  denseInteractionEligible?: boolean;
  denseInteractionNodeCount?: number;
  denseInteractionCulled?: boolean;
  denseInteractionRebuildCount?: number;
  qualityMode?: string;
  nodeCount?: number;
  linkCount?: number;
  personCount?: number;
  channelCount?: number;
  transformScale?: number;
};

type SurfacePerfSnapshot = {
  activeSurface: "feed" | "friends_graph" | "map" | "settings" | "dialog" | "unknown";
  friendsGraph?: FriendGraphSurfacePerf;
  map?: {
    ready: boolean;
    moving: boolean;
    dense: boolean;
    renderedMarkers: number;
    totalMarkers: number;
  };
};

function readNumberDatasetValue(element: HTMLElement, key: string): number | undefined {
  const value = element.dataset[key];
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function collectSurfacePerf(): SurfacePerfSnapshot {
  const settingsOpen = Boolean(document.querySelector(".theme-settings-shell"));
  if (settingsOpen) return { activeSurface: "settings" };
  const dialogOpen = Boolean(document.querySelector(".theme-dialog-shell"));
  if (dialogOpen) return { activeSurface: "dialog" };

  const friendGraph = document.querySelector<HTMLElement>('[data-testid="friend-graph-viewport"]');
  if (friendGraph) {
    const graphPerf = (window as typeof window & {
      __FREED_GRAPH_PERF__?: FriendGraphSurfacePerf;
    }).__FREED_GRAPH_PERF__;
    return {
      activeSurface: "friends_graph",
      friendsGraph: graphPerf
        ? { ...graphPerf }
        : {
            nodeCount: readNumberDatasetValue(friendGraph, "graphNodeCount"),
            linkCount: readNumberDatasetValue(friendGraph, "graphLinkCount"),
            personCount: readNumberDatasetValue(friendGraph, "graphPersonCount"),
            channelCount: readNumberDatasetValue(friendGraph, "graphChannelCount"),
            visibleLabelCount: readNumberDatasetValue(friendGraph, "visibleLabelCount"),
            qualityMode: friendGraph.dataset.graphQualityMode,
          },
    };
  }

  const mapSurface = document.querySelector<HTMLElement>('[data-testid="map-surface"]');
  if (mapSurface) {
    return {
      activeSurface: "map",
      map: {
        ready: mapSurface.dataset.mapReady === "true",
        moving: mapSurface.dataset.mapMoving === "true",
        dense: mapSurface.dataset.mapDense === "true",
        renderedMarkers: readNumberDatasetValue(mapSurface, "mapRenderedMarkers") ?? 0,
        totalMarkers: readNumberDatasetValue(mapSurface, "mapTotalMarkers") ?? 0,
      },
    };
  }

  if (document.querySelector("main")) return { activeSurface: "feed" };
  return { activeSurface: "unknown" };
}

// Register the desktop log transport so addDebugEvent calls from ui/ flow
// through the native logger in both local preview and release builds.
setLogTransport((level, msg) => log[level](msg));
setGoogleDriveFetch(googleDriveFetchViaTauri);

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
  const tauriRuntimeAvailable = import.meta.env.VITE_TEST_TAURI === "1" || isTauri();
  const [lockedStartupState, setLockedStartupState] = useState<LockedStartupState>(
    tauriRuntimeAvailable ? "checking" : "ready",
  );
  const [legalResolved, setLegalResolved] = useState(false);
  const [legalAccepted, setLegalAccepted] = useState(false);
  const [releaseChannel, setReleaseChannelState] = useState<ReleaseChannel>(() =>
    bootstrapDesktopReleaseChannel(),
  );
  const [installedReleaseChannel, setInstalledReleaseChannel] = useState<ReleaseChannel>(() =>
    bootstrapDesktopReleaseChannel(),
  );
  const [releaseChannelResolved, setReleaseChannelResolved] = useState(IS_LOCAL_PREVIEW);
  const fatalError = useFatalRuntimeError();

  useDesktopNavigationHistory(legalAccepted);

  useEffect(() => {
    if (!tauriRuntimeAvailable) {
      setLockedStartupState("ready");
      return;
    }

    let cancelled = false;
    let timeoutId: number | null = null;

    async function checkLockedSession() {
      try {
        const state = await invoke<DesktopSessionState>("get_desktop_session_state");
        if (cancelled) return;
        if (state?.screenLocked) {
          setLockedStartupState("locked");
          timeoutId = window.setTimeout(checkLockedSession, LOCKED_STARTUP_RECHECK_MS);
          return;
        }
        setLockedStartupState("ready");
      } catch (error) {
        if (cancelled) return;
        log.warn(
          `[startup] desktop session state unavailable: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        setLockedStartupState("ready");
      }
    }

    void checkLockedSession();

    return () => {
      cancelled = true;
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [tauriRuntimeAvailable]);

  useEffect(() => {
    if (IS_LOCAL_PREVIEW) return;

    let cancelled = false;
    void loadDesktopReleaseChannelState()
      .then(({ selectedChannel, installedChannel }) => {
        if (!cancelled) {
          setReleaseChannelState(selectedChannel);
          setInstalledReleaseChannel(installedChannel);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setReleaseChannelResolved(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

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
    if (!legalAccepted || lockedStartupState !== "ready") return;
    initialize();
  }, [initialize, legalAccepted, lockedStartupState]);

  useEffect(() => {
    if (!legalAccepted || !isInitialized) return;
    startMemoryMonitor({
      getAutomergeStats: getCachedDocStats,
      onCriticalPressure: () => {
        stopContentFetcher();
        stopSemanticClassifier();
        toast.error("Freed paused background fetch because memory is critically high", {
          actionLabel: "Restart",
          onAction: () => {
            void relaunch();
          },
        });
      },
      onSample: (snapshot) => {
        noteMemoryPressure(snapshot);
      },
    });
    void initProviderHealth();
    startRssPoller();
    // Wire the LAN relay change subscription and client-count polling.
    startSync();
    // Resume cloud sync loops for any previously authenticated providers.
    startAllCloudSyncs();
    if (isTauri()) {
      void startSnapshotManager();
    }
    // Start background content fetcher, which processes the article HTML queue.
    void contentCache.pruneOversized();
    startContentFetcher({ startupDelayMs: 5 * 60_000, memoryGuard: true });
    startSemanticClassifier({
      isEnabled: () => {
        const prefs = useDesktopStore.getState().preferences.ai;
        return prefs.provider === "integrated" && prefs.extractTopics;
      },
      subscribeToPreferenceChanges: (callback) =>
        useDesktopStore.subscribe((state, previous) => {
          if (state.preferences.ai !== previous.preferences.ai) {
            callback();
          }
        }),
    });
    return () => {
      stopRssPoller();
      stopSync();
      stopSnapshotManager();
      stopContentFetcher();
      stopSemanticClassifier();
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

    listen<RendererRecoveryStateEvent>("renderer-recovery-state", (event) => {
      noteRendererRecoveryState(event.payload);
      if (typeof document !== "undefined") {
        document.documentElement.dataset.rendererRecoveryPhase = event.payload.phase;
        document.documentElement.dataset.rendererSafeMode = String(Boolean(event.payload.safeModeActive));
      }
      if (event.payload.phase === "safe_mode") {
        stopContentFetcher();
        stopSemanticClassifier();
        toast.error("Freed paused background work while the renderer recovers", {
          actionLabel: "Restart",
          onAction: () => {
            void relaunch();
          },
        });
      }
      if (event.payload.phase === "recovered" && typeof document !== "undefined") {
        document.documentElement.dataset.rendererSafeMode = "false";
      }
    }).then((unlisten) => cleanups.push(unlisten));

    return () => cleanups.forEach((fn) => fn());
  }, [legalAccepted]);

  useEffect(() => {
    const hasTauriMock = "__TAURI_INTERNALS__" in window;
    const canEmitRendererHeartbeat =
      import.meta.env.VITE_TEST_TAURI === "1" || isTauri() || hasTauriMock;
    if (!canEmitRendererHeartbeat) return;

    let heartbeatSeq = 0;
    const pageLoadId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now().toLocaleString()}-${Math.random().toString(36).slice(2)}`;
    const startedAt = performance.now();
    let expectedHeartbeatAt = performance.now();
    let lastInputAt = performance.now();

    const noteInput = () => {
      lastInputAt = performance.now();
    };

    const sendRendererHeartbeat = (reason: string) => {
      heartbeatSeq += 1;
      const now = performance.now();
      const perf = performance as Performance & {
        memory?: {
          usedJSHeapSize?: number;
          totalJSHeapSize?: number;
        };
      };
      const visibility = document.visibilityState;
      const timing = rendererHeartbeatTiming(
        visibility,
        now,
        expectedHeartbeatAt,
        RENDERER_HEARTBEAT_INTERVAL_MS,
      );
      const payload = {
        seq: heartbeatSeq,
        ts: Date.now(),
        reason,
        visibility,
        href: window.location.href,
        pageLoadId,
        uptimeMs: Math.max(0, Math.round(now - startedAt)),
        appPhase: legalAccepted ? "ready" : "legal",
        eventLoopLagMs: timing.eventLoopLagMs,
        hiddenTimerThrottled: timing.hiddenTimerThrottled,
        domNodeCount: document.getElementsByTagName("*").length,
        rendererHeapUsedBytes: perf.memory?.usedJSHeapSize,
        rendererHeapTotalBytes: perf.memory?.totalJSHeapSize,
        lastInputAgeMs: Math.max(0, Math.round(now - lastInputAt)),
        settingsOpen: Boolean(document.querySelector(".theme-settings-shell")),
        dialogOpen: Boolean(document.querySelector(".theme-dialog-shell")),
        surfacePerf: collectSurfacePerf(),
      };
      expectedHeartbeatAt = now + RENDERER_HEARTBEAT_INTERVAL_MS;
      noteRendererHeartbeat(payload);
      if (import.meta.env.VITE_TEST_TAURI === "1") {
        const testWindow = window as unknown as {
          __FREED_RENDERER_HEARTBEATS__?: number;
          __FREED_LAST_RENDERER_HEARTBEAT__?: typeof payload;
        };
        testWindow.__FREED_RENDERER_HEARTBEATS__ =
          (testWindow.__FREED_RENDERER_HEARTBEATS__ ?? 0) + 1;
        testWindow.__FREED_LAST_RENDERER_HEARTBEAT__ = payload;
      }
      void emit("renderer-heartbeat", payload).catch(() => {
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
    window.addEventListener("pointerdown", noteInput, { passive: true });
    window.addEventListener("keydown", noteInput);
    window.addEventListener("pagehide", handlePageHide);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pointerdown", noteInput);
      window.removeEventListener("keydown", noteInput);
      window.removeEventListener("pagehide", handlePageHide);
      sendRendererHeartbeat("cleanup");
    };
  }, [legalAccepted]);

  // --- Update system ---

  // Single source of truth for update state, shared by the toast and the Settings flow.
  const [updateState, setUpdateState] = useState<UpdateState>({ phase: "idle" });
  const pendingUpdate = useRef<PendingDesktopUpdate | null>(null);
  const crashRecoveryUpdateCheckStarted = useRef(false);
  const launchUpdateCheckStarted = useRef(false);
  const [fallbackDownloadUrl, setFallbackDownloadUrl] = useState(
    `https://${getWebsiteHostForChannel(releaseChannel)}/get`,
  );

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

  useEffect(() => {
    if (IS_LOCAL_PREVIEW) return;

    let cancelled = false;
    void resolveDesktopDownloadFallbackUrl(releaseChannel)
      .then((url) => {
        if (!cancelled) {
          setFallbackDownloadUrl(url);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFallbackDownloadUrl(
            `https://${getWebsiteHostForChannel(releaseChannel)}/get`,
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [releaseChannel]);

  const setAvailableUpdate = useCallback((availableUpdate: PendingDesktopUpdate) => {
    pendingUpdate.current = availableUpdate;
    setFallbackDownloadUrl(availableUpdate.fallbackDownloadUrl);
    setUpdateState({
      phase: "available",
      channel: availableUpdate.channel,
      update: availableUpdate.update,
    });
  }, []);

  const runDesktopUpdateCheck = useCallback(
    async ({ showCheckingState }: { showCheckingState: boolean }): Promise<AvailableUpdateInfo | null> => {
      if (IS_LOCAL_PREVIEW) return null;

      if (showCheckingState) {
        setUpdateState({ phase: "checking" });
      }

      const availableUpdate = await checkDesktopUpdate(releaseChannel);
      if (availableUpdate) {
        setAvailableUpdate(availableUpdate);
        return {
          version: availableUpdate.update.version,
          channel: availableUpdate.channel,
        };
      }

      pendingUpdate.current = null;
      if (showCheckingState) {
        setUpdateState({ phase: "idle" });
      }
      return null;
    },
    [releaseChannel, setAvailableUpdate],
  );

  // Check once at launch, then continue polling in the background every 30 minutes.
  useEffect(() => {
    if (!legalAccepted || IS_LOCAL_PREVIEW || !releaseChannelResolved) return;

    async function poll() {
      try {
        await runDesktopUpdateCheck({ showCheckingState: false });
      } catch {
        // Silent, offline or endpoint down.
      }
    }

    if (!launchUpdateCheckStarted.current) {
      launchUpdateCheckStarted.current = true;
      void poll();
    }
    const interval = setInterval(poll, UPDATE_CHECK_INTERVAL_MS);
    return () => {
      clearInterval(interval);
    };
  }, [legalAccepted, releaseChannelResolved, runDesktopUpdateCheck]);

  // Manual check triggered from Settings panel.
  const checkForUpdates = useCallback(async (): Promise<AvailableUpdateInfo | null> => {
    return runDesktopUpdateCheck({ showCheckingState: true });
  }, [runDesktopUpdateCheck]);

  const isStartupCrash = Boolean(error && !isInitialized);
  const isCrashState = isStartupCrash || Boolean(fatalError);

  // Recovery mode should trigger its own immediate update check.
  useEffect(() => {
    if (!legalAccepted || IS_LOCAL_PREVIEW || !releaseChannelResolved || !isCrashState) {
      crashRecoveryUpdateCheckStarted.current = false;
      return;
    }
    if (crashRecoveryUpdateCheckStarted.current) return;
    crashRecoveryUpdateCheckStarted.current = true;
    void runDesktopUpdateCheck({ showCheckingState: false }).catch(() => {
      // Silent. Recovery still exposes the manual download path.
    });
  }, [isCrashState, legalAccepted, releaseChannelResolved, runDesktopUpdateCheck]);

  // Download + install with progress, then relaunch. Used by both the toast
  // and the "Install & Restart" button in Settings via PlatformContext.
  const applyUpdate = useCallback(async () => {
    const pending = pendingUpdate.current;
    if (!pending) return;
    setUpdateState({ phase: "downloading", percent: 0 });

    try {
      const version = await installPendingDesktopUpdate(pending, (progress) => {
        if (progress.phase === "downloading") {
          setUpdateState({
            phase: "downloading",
            percent: progress.percent,
          });
          return;
        }

        setUpdateState({ phase: "ready" });
      });

      // Persist the installed version across the relaunch so we can greet the user.
      await persistDesktopInstalledReleaseChannel(pending.channel);
      setInstalledReleaseChannel(pending.channel);
      await persistDesktopReleaseChannel(releaseChannel);
      localStorage.setItem(JUST_UPDATED_KEY, version);
      await relaunch();
    } catch (err) {
      setUpdateState({
        phase: "error",
        message: err instanceof Error ? err.message : "Update failed",
      });
    }
  }, [releaseChannel]);

  const handleRelaunch = useCallback(() => relaunch(), []);
  const handleDismissUpdate = useCallback(() => setUpdateState({ phase: "idle" }), []);
  const handleOpenLatestDownload = useCallback(() => {
    void shellOpen(fallbackDownloadUrl);
  }, [fallbackDownloadUrl]);
  const setReleaseChannel = useCallback(async (channel: ReleaseChannel) => {
    if (channel === releaseChannel) {
      return;
    }

    await persistDesktopReleaseChannel(channel);
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
    const token = await getValidCloudToken(provider);
    if (!token) return;
    await startCloudSync(provider, token);
  }, []);

  const recordGoogleContactsConnectError = useCallback((error: unknown) => {
    if (isOAuthCanceledError(error)) return;
    const message = error instanceof Error ? error.message : "Google Contacts connection failed.";
    setContactSyncError(message, "auth");
    log.warn(`[contacts] Google reconnect failed: ${message}`);
  }, []);

  const reconnectCloudProvider = useCallback(async (provider: CloudProvider) => {
    clearCloudProvider(provider);
    try {
      const token = await initiateDesktopOAuth(provider);
      storeCloudToken(provider, token);
      await startCloudSync(provider, token.accessToken);
    } catch (error) {
      throw error;
    }
  }, []);

  const connectGoogleContacts = useCallback(async (options?: { signal?: AbortSignal }) => {
    let token: Awaited<ReturnType<typeof initiateDesktopOAuth>>;
    try {
      token = await initiateDesktopOAuth("gdrive", options);
    } catch (error) {
      if (isOAuthCanceledError(error)) {
        log.info("[contacts] Google reconnect canceled");
        throw error;
      }
      recordGoogleContactsConnectError(error);
      throw error;
    }

    storeCloudToken("gdrive", token);
    try {
      await startCloudSync("gdrive", token.accessToken);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.warn(`[contacts] Google Drive sync failed after Contacts reconnect: ${message}`);
    }
  }, [recordGoogleContactsConnectError]);

  const fetchGoogleContactsForDesktop = useCallback(async (
    accessToken: string,
    syncToken?: string | null,
  ) => {
    log.info(`[contacts] Google sync requested mode=${syncToken ? "incremental" : "full"}`);
    try {
      const result = await fetchGoogleContactsViaTauri(accessToken, syncToken);
      log.info(
        `[contacts] Google sync fetched contacts=${result.contacts.length.toLocaleString()} deleted=${result.deleted.length.toLocaleString()} next_sync_token=${result.nextSyncToken ? "yes" : "no"}`,
      );
      return result;
    } catch (error) {
      const status = typeof error === "object" && error !== null && "status" in error
        ? (error as { status?: number }).status
        : undefined;
      if (status === 401) {
        let refreshedToken: string | null = null;
        try {
          refreshedToken = await forceRefreshCloudToken("gdrive");
        } catch (refreshError) {
          const message = refreshError instanceof Error
            ? refreshError.message
            : "Google token refresh failed.";
          setContactSyncError(message, "auth");
          log.warn(`[contacts] Google token refresh failed during sync: ${message}`);
          throw refreshError;
        }
        if (refreshedToken && refreshedToken !== accessToken) {
          log.info("[contacts] Google sync retrying after token refresh");
          const result = await fetchGoogleContactsViaTauri(refreshedToken, syncToken);
          log.info(
            `[contacts] Google sync fetched contacts=${result.contacts.length.toLocaleString()} deleted=${result.deleted.length.toLocaleString()} next_sync_token=${result.nextSyncToken ? "yes" : "no"}`,
          );
          return result;
        }
      }
      const message = error instanceof Error ? error.message : String(error);
      log.warn(`[contacts] Google sync failed: ${message}`);
      throw error;
    }
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
      GoogleContactsSettingsContent: tauriRuntimeAvailable ? GoogleContactsSection : null,
      checkForUpdates: IS_LOCAL_PREVIEW ? undefined : checkForUpdates,
      changelogPreview: DESKTOP_CHANGELOG_PREVIEW,
      applyUpdate: IS_LOCAL_PREVIEW ? undefined : applyUpdate,
      releaseChannel: IS_LOCAL_PREVIEW || !releaseChannelResolved ? undefined : releaseChannel,
      installedReleaseChannel: IS_LOCAL_PREVIEW || !releaseChannelResolved ? undefined : installedReleaseChannel,
      setReleaseChannel: IS_LOCAL_PREVIEW || !releaseChannelResolved ? undefined : setReleaseChannel,
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
      syncRssNow: refreshRssFeeds,
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
          await refreshRssFeeds();
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
      hydrateReaderItem: hydrateReaderItemForDesktop,
      pinReaderItem,
      // Encrypted API key store (type-widened: ApiKeyProvider -> string for PlatformConfig interface)
      secureStorage: secureStorage as {
        getApiKey: (provider: string) => Promise<string | null>;
        setApiKey: (provider: string, key: string) => Promise<void>;
        clearApiKey: (provider: string) => Promise<void>;
      },
      localAIModels,
      importInstagramStoryWallArchive: (files) => importMetaExportFiles("instagram", files),
      getStoryWallArchiveSummaries: async () => {
        const [facebook, instagram] = await Promise.all([
          summarizeMediaVault("facebook"),
          summarizeMediaVault("instagram"),
        ]);
        return [
          { provider: "facebook", ...facebook },
          { provider: "instagram", ...instagram },
        ];
      },
      publishStoryWall: publishStoryWallToGitHubPages,
      openUrl: (url: string) => { void shellOpen(url); },
      pickContact: pickContactViaTauri,
      googleContacts: tauriRuntimeAvailable
        ? {
            getToken: async () => {
              try {
                return await getValidCloudToken("gdrive");
              } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                log.warn(`[contacts] Google token lookup failed: ${message}`);
                return null;
              }
            },
            connect: connectGoogleContacts,
            fetchContacts: fetchGoogleContactsForDesktop,
          }
        : undefined,
      updateDownloadProgress: ((): UpdateDownloadProgress | null => {
        if (updateState.phase === "downloading") return { phase: "downloading", percent: updateState.percent };
        if (updateState.phase === "error") return { phase: "error", message: updateState.message };
        return null;
      })(),
      bugReporting: desktopBugReporting,
    }),
     [checkForUpdates, applyUpdate, connectGoogleContacts, fetchGoogleContactsForDesktop, handleFactoryReset, installedReleaseChannel, reconnectCloudProvider, releaseChannel, releaseChannelResolved, retryCloudProvider, seedSocialConnections, setReleaseChannel, tauriRuntimeAvailable, updateState],
  );

  if (lockedStartupState !== "ready") {
    return (
      <div className="h-screen flex items-center justify-center bg-transparent">
        <div className="rounded-2xl border border-white/10 bg-[rgba(10,10,10,0.72)] px-5 py-4 text-sm text-white/80 shadow-2xl shadow-black/60 backdrop-blur-xl">
          {lockedStartupState === "locked"
            ? "Freed Desktop will finish opening after you unlock this Mac."
            : "Opening Freed Desktop..."}
        </div>
      </div>
    );
  }

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
                    Updated to <span className="font-mono font-bold">v{formatReleaseVersion(justUpdated, installedReleaseChannel)}</span>
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
