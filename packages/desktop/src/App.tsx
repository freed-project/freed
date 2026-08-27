import { useEffect, useMemo, useCallback, useRef, useState, Profiler, type ProfilerOnRenderCallback } from "react";
import {
  formatReleaseVersion,
  getWebsiteHostForChannel,
  type ProviderRiskId,
  type ReleaseChannel,
} from "@freed/shared";
import {
  executeLibraryCoreScopeActionV1,
  digestLibraryCoreScopeActionRequestV1,
  libraryCoreFeedBrowseFilterInputFromV1,
  searchLibraryCoreNormalizedItemsV1,
  type LibraryCoreScopeActionStagePageV1,
} from "@freed/shared/library-core";
import { AppShell } from "@freed/ui/components/layout";
import { FeedView } from "@freed/ui/components/feed";
import { BugReportBoundary } from "@freed/ui/components/BugReportBoundary";
import { FatalErrorScreen } from "@freed/ui/components/FatalErrorScreen";
import { LocalPreviewBadge } from "@freed/ui/components/LocalPreviewBadge";
import { LegalGate } from "@freed/ui/components/legal/LegalGate";
import { GoogleContactsSection } from "@freed/ui/components/settings/GoogleContactsSection";
import { ToastContainer, toast } from "@freed/ui/components/Toast";
import { useSettingsStore } from "@freed/ui/lib/settings-store";
import {
  PlatformProvider,
  type AvailableUpdateInfo,
  type PlatformConfig,
  type ScanLibraryItems,
  type SearchLibraryItems,
  type UpdateDownloadProgress,
} from "@freed/ui/context";
import { useDebugStore } from "@freed/ui/lib/debug-store";
import {
  getDeviceAIPreferences,
  subscribeDeviceAIPreferences,
} from "@freed/ui/lib/device-ai-preferences";
import { UpdateNotification, type UpdateState } from "./components/UpdateNotification";
import { CloudSyncNudge } from "./components/CloudSyncNudge";
import { useAppStore } from "./lib/store";
import { addRssFeed, importOPMLFeeds, exportFeedsAsOPML, refreshRssFeeds } from "./lib/capture";
import {
  startRssPoller,
  stopRssPoller,
  stopRssPollerAndDrain,
} from "./lib/rss-poller";
import {
  startProviderSyncScheduler,
  stopProviderSyncScheduler,
  stopProviderSyncSchedulerAndDrain,
  wakeProviderSyncScheduler,
  wakeProviderSyncSchedulerFromNative,
} from "./lib/provider-sync-scheduler";
import { wasDesktopClientRegistrationCreatedThisLaunch } from "./lib/desktop-client-registration";
import {
  clearProviderScheduleStateForFactoryReset,
  rescheduleProviderAfterExternalSettlement,
} from "./lib/provider-sync-schedule-state";
import { clearRssSyncScheduleForFactoryReset } from "./lib/rss-sync-schedule-state";
import type { AutomaticSyncProvider } from "./lib/provider-sync-cadence";
import { exit, relaunch } from "@tauri-apps/plugin-process";
import { open as shellOpen } from "@tauri-apps/plugin-shell";
import {
  stopSync,
  restartCloudSync,
  startAllCloudSyncs,
  stopAllCloudSyncs,
  getActiveProviders,
  getValidCloudToken,
  forceRefreshCloudToken,
  captureCloudLifecycle,
  clearCloudProvider,
  clearStoredCloudDataForFactoryReset,
  startCloudSync,
  setGoogleDriveFetch,
  initiateDesktopOAuth,
  isOAuthCanceledError,
  quiesceDesktopOAuthForFactoryReset,
  storeCloudToken,
  type CloudProvider,
} from "./lib/sync";
import {
  clearLocalDoc,
  docArchiveItems,
  docMarkItemsAsRead,
} from "./lib/library-client";
import {
  openBoundedDesktopFeedReader,
  openBoundedDesktopFriendsFeedReader,
  readDesktopFeedSignalCounts,
} from "./lib/library-core-feed-browse-reader-runtime";
import { openBoundedDesktopSavedFeedReader } from "./lib/library-core-saved-feed-reader-runtime";
import {
  mutateNormalizedDeviceContacts,
  queryNormalizedDeviceContacts,
  queryNormalizedLibrary,
} from "./lib/library-core-normalized-query-client";
import {
  readLibraryCoreFacetSummary,
  readLibraryCoreFriendsGraph,
  readLibraryCoreFriendsLocationItem,
  readLibraryCoreItemDetail,
  readLibraryCoreMapCandidates,
  readLibraryCoreAccountDetail,
  readLibraryCorePersonTimeline,
  readLibraryCorePersonDetail,
  readLibraryCoreFriendDetail,
  readLibraryCoreSavedAnalytics,
  readLibraryCoreStoryWallCandidates,
  scanLibraryCoreBackgroundItems,
} from "./lib/library-core-item-detail-runtime";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { log } from "./lib/logger";
import { safeUnlisten } from "./lib/safe-unlisten";
import { setLogTransport } from "@freed/ui/lib/debug-store";
import {
  finishBackgroundActivity,
  startBackgroundActivity,
  updateBackgroundActivity,
} from "@freed/ui/lib/background-activity-store";
import { clearStoredCookies, storeCookies } from "./lib/x-auth";
import { disconnectIgForFactoryReset, storeIgAuthState } from "./lib/instagram-auth";
import { disconnectFbForFactoryReset, storeFbAuthState } from "./lib/fb-auth";
import { disconnectLiForFactoryReset, storeLiAuthState } from "./lib/li-auth";
import {
  disconnectSubstackForFactoryReset,
  storeSubstackAuthState,
} from "./lib/substack-auth";
import {
  disconnectMediumForFactoryReset,
  storeMediumAuthState,
} from "./lib/medium-auth";
import { disconnectYouTubeForFactoryReset } from "./lib/youtube-auth";
import { captureXTimeline } from "./lib/x-capture";
import { captureFbFeed } from "./lib/fb-capture";
import { captureIgFeed } from "./lib/instagram-capture";
import { captureLiFeed } from "./lib/li-capture";
import { captureSubstackFeed } from "./lib/substack-capture";
import { captureMediumFeed } from "./lib/medium-capture";
import { captureYouTube } from "./lib/youtube-capture";
import { addYouTubeVideoToOfflinePlaylist } from "./lib/youtube-playlist";
import { contentCache } from "./lib/content-cache";
import {
  clearDesktopClientWarningAcknowledgement,
  desktopClientWarningSignature,
  isDesktopClientWarningAcknowledged,
} from "./lib/desktop-client-warning";
import { clearDeviceAIPreferences } from "@freed/ui/lib/device-ai-preferences";
import { clearDeviceDisplayPreferences } from "@freed/ui/lib/device-display-preferences";
import { clearDeviceGraphLayout } from "@freed/ui/lib/device-graph-layout";
import { resetFeedCardDensity } from "@freed/ui/lib/feed-card-density";
import { resetInterfaceZoom } from "@freed/ui/lib/interface-zoom";
import {
  clearFactoryResetCloudCleanupBarrier,
  beginFactoryResetBoundary,
  hasFactoryResetCloudCleanupBarrier,
  runFactoryResetOperations,
  runFactoryResetWithRecovery,
} from "@freed/ui/lib/factory-reset";
import { getDesktopFactoryResetFailureRecovery } from "./lib/factory-reset-recovery";
import { resetThemePreference } from "@freed/ui/lib/theme";
import { saveUrlInDesktop } from "./lib/save-url";
import { hydrateReaderItem as hydrateReaderItemForDesktop } from "./lib/reader-hydration";
import { importMarkdownFiles, exportLibrary } from "./lib/import-export";
import { secureStorage } from "./lib/secure-storage";
import { localAIModels } from "./lib/local-ai-models";
import { checkOllamaReachable } from "./lib/ai-summarizer";
import {
  pinReaderItem,
  start as startContentFetcher,
  stop as stopContentFetcher,
  stopAndDrain as stopAndDrainContentFetcher,
} from "./lib/content-fetcher";
import {
  start as startSemanticClassifier,
  stop as stopSemanticClassifier,
  stopAndDrain as stopAndDrainSemanticClassifier,
} from "./lib/semantic-classifier";
import {
  quiesceDesktopStoreForFactoryReset,
  useAppStore as useDesktopStore,
  withProviderSyncing,
} from "./lib/store";
import { pickContactViaTauri } from "./lib/contacts";
import { fetchGoogleContactsViaTauri } from "./lib/google-contacts";
import { googleDriveFetchViaTauri } from "./lib/google-drive";
import { FeedEmptyState } from "./components/FeedEmptyState";
import { XSettingsSection } from "./components/XSettingsSection";
import { FacebookSettingsSection } from "./components/FacebookSettingsSection";
import { InstagramSettingsSection } from "./components/InstagramSettingsSection";
import { LinkedInSettingsSection } from "./components/LinkedInSettingsSection";
import { SubstackSettingsSection } from "./components/SubstackSettingsSection";
import { MediumSettingsSection } from "./components/MediumSettingsSection";
import { YouTubeSettingsSection } from "./components/YouTubeSettingsSection";
import { XSourceIndicator } from "./components/XSourceIndicator";
import { MobileSyncTab } from "./components/MobileSyncTab";
import { DesktopLegalSettingsSection } from "./components/DesktopLegalSettingsSection";
import { DesktopShortcutsSettingsSection } from "./components/DesktopShortcutsSettingsSection";
import { DesktopFeedsSettingsSection } from "./components/DesktopFeedsSettingsSection";
import { refreshSampleLibraryData, summarizeSampleData } from "@freed/ui/lib/sample-library-seed";
import { acceptDesktopBundle, acceptProviderRisk, hasAcceptedDesktopBundle } from "./lib/legal-consent";
import {
  clearProviderPause,
  forgetRssFeedHealth,
  initProviderHealth,
} from "./lib/provider-health";
import { getDesktopSourceStatus } from "./lib/source-status";

import { clearSnapshots, startSnapshotManager, stopSnapshotManager } from "./lib/snapshots";
import {
  appendSqliteLibraryPersonReachOut,
  assignSqliteLibraryAccountToPerson,
  isSqliteLibraryActive,
  removeSqliteLibraryPerson,
  replaceSqliteLibraryFriend,
  upsertSqliteLibraryPerson,
  upsertSqliteLibraryAccount,
} from "./lib/sqlite-library";
import { useDesktopNavigationHistory } from "./lib/navigation-history";
import { desktopBugReporting } from "./lib/bug-report";
import { importMetaExportFiles } from "./lib/meta-export-import";
import { summarizeMediaVault } from "./lib/media-vault";
import { publishStoryWallToGitHubPages } from "./lib/story-wall-publisher";
import { clearFatalRuntimeError, useFatalRuntimeError } from "@freed/ui/lib/bug-report";
import {
  captureShellMemoryBaseline,
  startMemoryMonitor,
  stopMemoryMonitor,
} from "./lib/memory-monitor";
import {
  getBackgroundRuntimeStatus,
  noteMemoryPressure,
  noteRendererHeartbeat,
  noteRendererRecoveryState,
  type RendererRecoveryStateEvent,
} from "./lib/background-runtime-coordinator";
import { quiesceDesktopProviderAuthForFactoryReset } from "./lib/provider-auth-lifecycle";
import {
  assertFactoryResetEpoch,
  runFactoryResetSensitiveDesktopOperation,
} from "./lib/factory-reset-guard";
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
import { useClipboardSaveShortcut } from "./hooks/useClipboardSaveShortcut";
import { clearClipboardSaveShortcutConfig } from "./lib/clipboard-save-shortcut";

async function runManualProviderSync<T>(
  provider: AutomaticSyncProvider,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await withProviderSyncing(provider, operation);
  } finally {
    rescheduleProviderAfterExternalSettlement({ provider });
  }
}

const scanLibraryCoreItemsForDesktop: ScanLibraryItems =
  scanLibraryCoreBackgroundItems;

const searchLibraryCoreItemsForDesktop: SearchLibraryItems = async (
  query,
  _searchCorpusVersion,
  visit,
  options,
) =>
  searchLibraryCoreNormalizedItemsV1(
    {
      query: queryNormalizedLibrary,
      randomId: () => crypto.randomUUID(),
    },
    {
      filter: options?.filter ?? {},
      identityMode: options?.identityMode ?? "all_content",
      query,
      signal: options?.signal,
    },
    visit,
  );

const executeDesktopLibraryScopeAction: NonNullable<
  PlatformConfig["executeLibraryScopeAction"]
> = async (request) => {
  const filter = libraryCoreFeedBrowseFilterInputFromV1(request.filter);
  let stagedCount = 0;
  return executeLibraryCoreScopeActionV1(request, {
    scan: async (visit) => {
      if (request.query !== null) {
        await searchLibraryCoreItemsForDesktop(
          request.query,
          0,
          async (matches) => {
            await visit(matches.map((match) => match.item));
            return "continue" as const;
          },
          { filter, identityMode: request.identityMode },
        );
        return;
      }
      const reader =
        request.identityMode === "friends"
          ? await openBoundedDesktopFriendsFeedReader(filter, Date.now())
          : await openBoundedDesktopFeedReader(filter, Date.now());
      try {
        for (;;) {
          const items = await reader.readNext();
          if (items.length === 0) return;
          await visit(items);
        }
      } finally {
        await reader.close();
      }
    },
    beginStage: async (stageRequest) => {
      const stageId = `scope-action:${crypto.randomUUID()}`;
      stagedCount = 0;
      await invoke("begin_normalized_scope_action", {
        actionKind: stageRequest.action,
        createdAt: Date.now(),
        requestDigest: digestLibraryCoreScopeActionRequestV1(stageRequest),
        stageId,
      });
      return stageId;
    },
    appendStage: async (stageId, entityIds) => {
      await invoke("append_normalized_scope_action", {
        entityIds,
        expectedOrdinal: stagedCount,
        stageId,
      });
      stagedCount += entityIds.length;
    },
    finalizeStage: async (stageId) => {
      await invoke("finalize_normalized_scope_action", {
        expectedMemberCount: stagedCount,
        stageId,
      });
      return stagedCount;
    },
    readStage: async (stageId, afterOrdinal) => {
      const page = await invoke<LibraryCoreScopeActionStagePageV1>(
        "page_normalized_scope_action",
        { afterOrdinal, stageId },
      );
      return { entityIds: page.entityIds, nextOrdinal: page.nextOrdinal };
    },
    closeStage: (stageId) =>
      invoke("close_normalized_scope_action", { stageId }).then(() => {}),
    commitBatch: (action, entityIds) =>
      action === "read"
        ? docMarkItemsAsRead([...entityIds])
        : docArchiveItems([...entityIds]),
  });
};

const UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const IS_FEATURE_PREVIEW = import.meta.env.VITE_FREED_FEATURE_PREVIEW === "1";
const IS_LOCAL_PREVIEW = IS_FEATURE_PREVIEW || (import.meta.env.DEV && import.meta.env.VITE_TEST_TAURI !== "1");
const LOCAL_PREVIEW_LABEL = import.meta.env.VITE_FREED_PREVIEW_LABEL?.trim() || null;
const PREVIEW_PROVIDER_RISKS: ProviderRiskId[] = [
  "x",
  "facebook",
  "instagram",
  "linkedin",
  "substack",
  "medium",
  "youtube",
];
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

function isTouchOnlyInputSurface(): boolean {
  if (window.__FREED_E2E_TOUCH_ONLY__) return true;
  if (typeof window.matchMedia !== "function") return false;

  const coarsePrimaryPointer = window.matchMedia("(pointer: coarse)").matches;
  const primaryPointerCannotHover = window.matchMedia("(hover: none)").matches;
  const hasFinePointer = window.matchMedia("(any-pointer: fine)").matches;
  const hasHoverInput = window.matchMedia("(any-hover: hover)").matches;
  const hasTouch = navigator.maxTouchPoints > 0;

  return hasTouch && coarsePrimaryPointer && primaryPointerCannotHover && !hasFinePointer && !hasHoverInput;
}

function App() {
  const initialize = useAppStore((state) => state.initialize);
  const isInitialized = useAppStore((state) => state.isInitialized);
  const error = useAppStore((state) => state.error);
  const desktopClientIds = useAppStore((state) => state.desktopClientIds);
  const desktopWarningSignatureValue = desktopClientWarningSignature(desktopClientIds);
  const lastDesktopWarningToast = useRef("");
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
  const [hasKeyboardShortcutSettingsSurface, setHasKeyboardShortcutSettingsSurface] = useState(
    () => !isTouchOnlyInputSurface(),
  );
  const fatalError = useFatalRuntimeError();

  useDesktopNavigationHistory(legalAccepted);

  useEffect(() => {
    if (!tauriRuntimeAvailable) return;
    // Give the nonblocking shell probe the legal and lock checks as headroom.
    // Document initialization closes the window and discards a late result.
    void captureShellMemoryBaseline();
  }, [tauriRuntimeAvailable]);

  useEffect(() => {
    if (
      !isInitialized ||
      desktopClientIds.length < 2 ||
      !desktopWarningSignatureValue ||
      lastDesktopWarningToast.current === desktopWarningSignatureValue ||
      isDesktopClientWarningAcknowledged(desktopWarningSignatureValue)
    ) {
      return;
    }
    lastDesktopWarningToast.current = desktopWarningSignatureValue;
    toast.info(
      "More than one Freed Desktop installation is registered. Each installation can contact your connected provider accounts, which can duplicate request traffic.",
      {
        actionLabel: "Review Sync",
        onAction: () => useSettingsStore.getState().openTo("sync"),
      },
    );
  }, [
    desktopClientIds.length,
    desktopWarningSignatureValue,
    isInitialized,
  ]);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;

    const queries = [
      window.matchMedia("(pointer: coarse)"),
      window.matchMedia("(hover: none)"),
      window.matchMedia("(any-pointer: fine)"),
      window.matchMedia("(any-hover: hover)"),
    ];
    const refresh = () => setHasKeyboardShortcutSettingsSurface(!isTouchOnlyInputSurface());

    for (const query of queries) {
      query.addEventListener?.("change", refresh);
      query.addListener?.(refresh);
    }

    return () => {
      for (const query of queries) {
        query.removeEventListener?.("change", refresh);
        query.removeListener?.(refresh);
      }
    };
  }, []);

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
    let cancelled = false;
    const resolveLegalAcceptance = async (): Promise<boolean> => {
      if (!IS_FEATURE_PREVIEW) {
        return hasAcceptedDesktopBundle();
      }

      await acceptDesktopBundle();
      await Promise.all(PREVIEW_PROVIDER_RISKS.map((provider) => acceptProviderRisk(provider)));
      return true;
    };

    void resolveLegalAcceptance()
      .then((accepted) => {
        if (cancelled) return;
        setLegalAccepted(accepted);
      })
      .catch((error) => {
        if (cancelled) return;
        log.error(
          `[legal] failed to resolve desktop bundle consent: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        setLegalAccepted(false);
      })
      .finally(() => {
        if (cancelled) return;
        setLegalResolved(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!legalAccepted || lockedStartupState !== "ready") return;
    initialize();
  }, [initialize, legalAccepted, lockedStartupState]);

  useEffect(() => {
    if (!legalAccepted || !isInitialized || !tauriRuntimeAvailable) return;
    void startAllCloudSyncs().catch((error) => {
      log.warn(
        `[cloud] Failed to resume configured sync: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
    return () => stopAllCloudSyncs();
  }, [isInitialized, legalAccepted, tauriRuntimeAvailable]);

  useEffect(() => {
    if (!legalAccepted || !isInitialized) return;
    startMemoryMonitor({
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
    startProviderSyncScheduler({
      existingInstall: wasDesktopClientRegistrationCreatedThisLaunch() !== true,
    });
    // Replacement sync follows the SQLite Desktop revamp. The legacy
    // Automerge relay and cloud loops stay off in this build.
    if (isTauri()) {
      void startSnapshotManager().catch((error) => {
        log.error(
          `[snapshots] failed to start SQLite snapshot manager: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
    }
    // Start background content fetcher, which processes the article HTML queue.
    void contentCache.pruneOversized();
    startContentFetcher({ startupDelayMs: 5 * 60_000, memoryGuard: true });
    startSemanticClassifier({
      isEnabled: () => {
        const prefs = useDesktopStore.getState().preferences.ai;
        return getDeviceAIPreferences().provider === "integrated" && prefs.extractTopics;
      },
      subscribeToPreferenceChanges: (callback) => {
        const unsubscribeStore = useDesktopStore.subscribe((state, previous) => {
          if (state.preferences.ai !== previous.preferences.ai) {
            callback();
          }
        });
        const unsubscribeDevice = subscribeDeviceAIPreferences(callback);
        return () => {
          unsubscribeStore();
          unsubscribeDevice();
        };
      },
    });
    return () => {
      stopRssPoller();
      stopProviderSyncScheduler();
      stopSync();
      stopAllCloudSyncs();
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
    if (!tauriRuntimeAvailable) return;

    const cleanups: Array<() => void> = [];

    listen("tauri://suspend", () => {
      log.info("[app] system suspend (sleep)");
    }).then((unlisten) => cleanups.push(unlisten));

    listen("tauri://resume", () => {
      log.info("[app] system resume (wake)");
      wakeProviderSyncScheduler();
    }).then((unlisten) => cleanups.push(unlisten));

    listen("provider-schedule-native-wake", () => {
      log.info("[provider-sync] native deadline wake");
      wakeProviderSyncSchedulerFromNative();
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

    return () => cleanups.forEach((fn, index) => safeUnlisten(fn, `app-lifecycle:${index.toLocaleString()}`));
  }, [legalAccepted, tauriRuntimeAvailable]);

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
        backgroundRuntime: getBackgroundRuntimeStatus(),
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

      const activityId = startBackgroundActivity({
        id: "job:update:desktop-check",
        kind: "job",
        jobKind: "update",
        label: "Update",
        source: "desktop-check",
        message: "Checking for Freed Desktop updates.",
      });
      if (showCheckingState) {
        setUpdateState({ phase: "checking" });
      }

      try {
        const availableUpdate = await checkDesktopUpdate(releaseChannel);
        if (availableUpdate) {
          setAvailableUpdate(availableUpdate);
          finishBackgroundActivity(activityId, "success", `Freed Desktop ${availableUpdate.update.version} is available.`);
          return {
            version: availableUpdate.update.version,
            channel: availableUpdate.channel,
          };
        }

        pendingUpdate.current = null;
        if (showCheckingState) {
          setUpdateState({ phase: "idle" });
        }
        finishBackgroundActivity(activityId, "success", "Freed Desktop is up to date.");
        return null;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        finishBackgroundActivity(activityId, "error", `Update check failed: ${message}`);
        throw error;
      }
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
    const activityId = startBackgroundActivity({
      id: "job:update:desktop-download",
      kind: "job",
      jobKind: "update",
      label: "Update",
      source: "desktop-download",
      message: "Downloading Freed Desktop update.",
      progress: 0,
    });
    setUpdateState({ phase: "downloading", percent: 0 });

    try {
      const version = await installPendingDesktopUpdate(pending, (progress) => {
        if (progress.phase === "downloading") {
          setUpdateState({
            phase: "downloading",
            percent: progress.percent,
          });
          updateBackgroundActivity(activityId, {
            message: "Downloading Freed Desktop update.",
            progress: progress.percent,
          });
          return;
        }

        setUpdateState({ phase: "ready" });
        updateBackgroundActivity(activityId, {
          message: "Freed Desktop update is ready.",
          progress: 100,
          log: true,
          level: "success",
        });
      });

      // Persist the installed version across the relaunch so we can greet the user.
      await persistDesktopInstalledReleaseChannel(pending.channel);
      setInstalledReleaseChannel(pending.channel);
      await persistDesktopReleaseChannel(releaseChannel);
      localStorage.setItem(JUST_UPDATED_KEY, version);
      finishBackgroundActivity(activityId, "success", `Freed Desktop ${version} installed. Restarting.`);
      await relaunch();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Update failed";
      setUpdateState({
        phase: "error",
        message,
      });
      finishBackgroundActivity(activityId, "error", `Update failed: ${message}`);
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

  const handleOpenClipboardSaveDialog = useCallback(
    (initialUrl?: string) => {
      window.dispatchEvent(
        new CustomEvent("freed:open-save-content-dialog", {
          detail: { initialUrl },
        }),
      );
    },
    [],
  );

  const {
    config: clipboardSaveShortcutConfig,
    status: clipboardSaveShortcutStatus,
    setConfig: setClipboardSaveShortcutConfig,
    resetConfig: resetClipboardSaveShortcutConfig,
  } = useClipboardSaveShortcut(handleOpenClipboardSaveDialog);

  const ShortcutsSettingsContent = useMemo(
    () =>
      function ShortcutsSettingsSlot() {
        return (
          <DesktopShortcutsSettingsSection
            config={clipboardSaveShortcutConfig}
            status={clipboardSaveShortcutStatus}
            setConfig={setClipboardSaveShortcutConfig}
            resetConfig={resetClipboardSaveShortcutConfig}
          />
        );
      },
    [
      clipboardSaveShortcutConfig,
      clipboardSaveShortcutStatus,
      resetClipboardSaveShortcutConfig,
      setClipboardSaveShortcutConfig,
    ],
  );

  const handleFactoryReset = useCallback(async (deleteFromCloud: boolean) => {
    await runFactoryResetWithRecovery({
      reset: async () => {
        beginFactoryResetBoundary();
        stopRssPoller();
        stopProviderSyncScheduler();
        stopSync();
        stopAllCloudSyncs();
        stopSnapshotManager();
        stopContentFetcher();
        stopSemanticClassifier();
        await runFactoryResetOperations({
          phaseTimeoutMs: 255_000,
          trackedWorkDrainTimeoutMs: 240_000,
          quiesceLocalWriters: [
            quiesceDesktopProviderAuthForFactoryReset,
            quiesceDesktopOAuthForFactoryReset,
            quiesceDesktopStoreForFactoryReset,
            stopRssPollerAndDrain,
            stopProviderSyncSchedulerAndDrain,
            stopAndDrainContentFetcher,
            stopAndDrainSemanticClassifier,
          ],
          clearDeviceStores: () => [
            clearDeviceDisplayPreferences(),
            clearDeviceAIPreferences(),
            clearDeviceGraphLayout(),
          ],
          clearLocalSettings: [
            resetFeedCardDensity,
            resetInterfaceZoom,
            resetThemePreference,
            clearStoredCookies,
            clearDesktopClientWarningAcknowledgement,
            clearProviderScheduleStateForFactoryReset,
            clearRssSyncScheduleForFactoryReset,
          ],
          clearLocalData: [
            clearSnapshots,
            clearClipboardSaveShortcutConfig,
            async () => {
              await invoke("clear_factory_reset_runtime_artifacts");
            },
          ],
          clearProviderDataAndConnections: async () => {
            stopAllCloudSyncs();
            await clearStoredCloudDataForFactoryReset(deleteFromCloud);
            const disconnectFailures: unknown[] = [];
            for (const disconnectProvider of [
              disconnectFbForFactoryReset,
              disconnectIgForFactoryReset,
              disconnectLiForFactoryReset,
              disconnectSubstackForFactoryReset,
              disconnectMediumForFactoryReset,
              disconnectYouTubeForFactoryReset,
            ]) {
              try {
                await disconnectProvider();
              } catch (error) {
                disconnectFailures.push(error);
              }
            }
            if (disconnectFailures.length > 0) throw disconnectFailures[0];
          },
          clearDocument: async () => {
            await clearLocalDoc();
          },
        });
        clearFactoryResetCloudCleanupBarrier();
      },
      reload: () => location.reload(),
      onFailure: (error) => {
        const cloudCleanupPaused = hasFactoryResetCloudCleanupBarrier();
        const recovery = getDesktopFactoryResetFailureRecovery(error, cloudCleanupPaused);
        toast.error(recovery.message);
      },
    });
  }, []);

  const retryCloudProvider = useCallback(async (provider: CloudProvider) => {
    await restartCloudSync(provider);
  }, []);

  const recordGoogleContactSyncError = useCallback((message: string) => {
    if (!tauriRuntimeAvailable || !isInitialized) return;
    void mutateNormalizedDeviceContacts({
      authStatus: "reconnect_required",
      errorCode: "auth",
      errorMessage: message,
      mutationKind: "device_contact_status_set_v1",
      schemaVersion: 1,
      syncStartedAt: null,
      syncStatus: "error",
      updatedAt: Date.now(),
    }).catch((error) => {
      log.warn(
        `[contacts] SQLite contact status update failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  }, [isInitialized, tauriRuntimeAvailable]);

  const recordGoogleContactsConnectError = useCallback((error: unknown) => {
    if (isOAuthCanceledError(error)) return;
    const message = error instanceof Error ? error.message : "Google Contacts connection failed.";
    recordGoogleContactSyncError(message);
    log.warn(`[contacts] Google reconnect failed: ${message}`);
  }, [recordGoogleContactSyncError]);

  const reconnectCloudProvider = useCallback(async (provider: CloudProvider) => {
    clearCloudProvider(provider);
    const lifecycle = captureCloudLifecycle(provider);
    try {
      const token = await initiateDesktopOAuth(provider);
      if (!lifecycle.isCurrent()) return;
      storeCloudToken(provider, token);
      await startCloudSync(provider, token.accessToken);
    } catch (error) {
      throw error;
    }
  }, []);

  const connectGoogleContacts = useCallback(async (options?: { signal?: AbortSignal }) => {
    const lifecycle = captureCloudLifecycle("gdrive");
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

    if (!lifecycle.isCurrent()) return;
    storeCloudToken("gdrive", token);
    try {
      await startCloudSync("gdrive", token.accessToken);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.warn(`[contacts] Google Drive sync failed after Contacts reconnect: ${message}`);
    }
  }, [recordGoogleContactsConnectError]);

  const fetchGoogleContactsForDesktop = useCallback((
    accessToken: string,
    syncToken?: string | null,
  ) => runFactoryResetSensitiveDesktopOperation(async (resetEpoch) => {
      log.info(`[contacts] Google sync requested mode=${syncToken ? "incremental" : "full"}`);
      try {
        assertFactoryResetEpoch(resetEpoch);
        const result = await fetchGoogleContactsViaTauri(accessToken, syncToken);
        assertFactoryResetEpoch(resetEpoch);
        log.info(
          `[contacts] Google sync fetched contacts=${result.contacts.length.toLocaleString()} deleted=${result.deleted.length.toLocaleString()} next_sync_token=${result.nextSyncToken ? "yes" : "no"}`,
        );
        return result;
      } catch (error) {
        assertFactoryResetEpoch(resetEpoch);
        const status = typeof error === "object" && error !== null && "status" in error
          ? (error as { status?: number }).status
          : undefined;
        if (status === 401) {
          let refreshedToken: string | null = null;
          try {
            assertFactoryResetEpoch(resetEpoch);
            refreshedToken = await forceRefreshCloudToken("gdrive");
            assertFactoryResetEpoch(resetEpoch);
          } catch (refreshError) {
            assertFactoryResetEpoch(resetEpoch);
            const message = refreshError instanceof Error
              ? refreshError.message
              : "Google token refresh failed.";
            recordGoogleContactSyncError(message);
            log.warn(`[contacts] Google token refresh failed during sync: ${message}`);
            throw refreshError;
          }
          if (refreshedToken && refreshedToken !== accessToken) {
            assertFactoryResetEpoch(resetEpoch);
            log.info("[contacts] Google sync retrying after token refresh");
            const result = await fetchGoogleContactsViaTauri(refreshedToken, syncToken);
            assertFactoryResetEpoch(resetEpoch);
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
    }), [recordGoogleContactSyncError]);

  // Fake-authenticate all social providers for local testing. Writes stub
  // credentials to localStorage (matching the real auth persistence format)
  // and updates Zustand state so the sidebar dots light up without a real login.
  const seedSocialConnections = useCallback(() => {
    const {
      setXAuth,
      setFbAuth,
      setIgAuth,
      setLiAuth,
      setSubstackAuth,
      setMediumAuth,
    } = useAppStore.getState();
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

    const substackState = { isAuthenticated: true, lastCheckedAt: now };
    storeSubstackAuthState(substackState);
    setSubstackAuth(substackState);

    const mediumState = { isAuthenticated: true, lastCheckedAt: now };
    storeMediumAuthState(mediumState);
    setMediumAuth(mediumState);
  }, []);

  // Local feature previews should open with a useful library. E2E tests keep
  // deterministic control unless the preview helper opts in explicitly.
  useEffect(() => {
    const shouldAutoSeedPreview =
      IS_FEATURE_PREVIEW || (import.meta.env.DEV && import.meta.env.VITE_TEST_TAURI !== "1");
    if (!isInitialized || !shouldAutoSeedPreview) return;

    const guardKey = "freed_dev_seeded";
    if (!IS_FEATURE_PREVIEW && sessionStorage.getItem(guardKey)) return;

    void (async () => {
      const state = useAppStore.getState();
      const facets = isSqliteLibraryActive()
        ? await readLibraryCoreFacetSummary()
        : null;
      const sampleSummary = summarizeSampleData(
        state,
        facets?.sampleItemCount,
      );
      if (sampleSummary.total > 0) return;

      await refreshSampleLibraryData({
        ...useAppStore.getState(),
        seedSocialConnections,
      });
      sessionStorage.setItem(guardKey, "1");
    })().catch((error) => {
      log.error(
        `[sample-data] failed to seed local preview data: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
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
      releaseMapRendererMemory:
        import.meta.env.VITE_TEST_TAURI === "1" || isTauri()
          ? () => invoke("release_main_renderer_memory")
          : undefined,
      SourceIndicator: XSourceIndicator,
      HeaderSyncIndicator: null,
      SettingsExtraSections: MobileSyncTab,
      ShortcutsSettingsContent:
        tauriRuntimeAvailable && hasKeyboardShortcutSettingsSurface
          ? ShortcutsSettingsContent
          : null,
      LegalSettingsContent: DesktopLegalSettingsSection,
      FeedEmptyState: FeedEmptyState,
      XSettingsContent: XSettingsSection,
      FacebookSettingsContent: FacebookSettingsSection,
      InstagramSettingsContent: InstagramSettingsSection,
      LinkedInSettingsContent: LinkedInSettingsSection,
      FeedsSettingsContent: DesktopFeedsSettingsSection,
      SubstackSettingsContent: SubstackSettingsSection,
      MediumSettingsContent: MediumSettingsSection,
      YouTubeSettingsContent: YouTubeSettingsSection,
      GoogleContactsSettingsContent: tauriRuntimeAvailable ? GoogleContactsSection : null,
      checkForUpdates: IS_LOCAL_PREVIEW ? undefined : checkForUpdates,
      changelogPreview: DESKTOP_CHANGELOG_PREVIEW,
      applyUpdate: IS_LOCAL_PREVIEW ? undefined : applyUpdate,
      releaseChannel: IS_LOCAL_PREVIEW || !releaseChannelResolved ? undefined : releaseChannel,
      installedReleaseChannel: IS_LOCAL_PREVIEW || !releaseChannelResolved ? undefined : installedReleaseChannel,
      setReleaseChannel: IS_LOCAL_PREVIEW || !releaseChannelResolved ? undefined : setReleaseChannel,
      factoryReset: handleFactoryReset,
      factoryResetRevokesMobilePairing: true,
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
        return saveUrlInDesktop(url, options);
      },
      importMarkdown: importMarkdownFiles,
      exportMarkdown: async () => {
        const items: Parameters<typeof exportLibrary>[0] = [];
        await scanLibraryCoreItemsForDesktop((page) => {
          items.push(...page);
          return "continue";
        });
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
            sourceId === "linkedin" ||
            sourceId === "substack" ||
            sourceId === "medium" ||
            sourceId === "youtube") &&
          health?.providers[sourceId]?.status === "paused";

        if (sourceId === "rss") {
          await refreshRssFeeds();
          return;
        }

        if (sourceId === "x" && state.xAuth.isAuthenticated && state.xAuth.cookies) {
          if (isPaused) {
            await clearProviderPause("x");
          }
          await runManualProviderSync("x", () => captureXTimeline(state.xAuth.cookies!, undefined, "manual"));
          return;
        }

        if (sourceId === "facebook" && state.fbAuth.isAuthenticated) {
          if (isPaused) {
            await clearProviderPause("facebook");
          }
          await runManualProviderSync("facebook", () => captureFbFeed("manual"));
          return;
        }

        if (sourceId === "instagram" && state.igAuth.isAuthenticated) {
          if (isPaused) {
            await clearProviderPause("instagram");
          }
          await runManualProviderSync("instagram", () => captureIgFeed("manual"));
          return;
        }

        if (sourceId === "linkedin" && state.liAuth.isAuthenticated) {
          if (isPaused) {
            await clearProviderPause("linkedin");
          }
          await runManualProviderSync("linkedin", () => captureLiFeed("manual"));
          return;
        }

        if (sourceId === "substack" && state.substackAuth.isAuthenticated) {
          if (isPaused) {
            await clearProviderPause("substack");
          }
          await runManualProviderSync("substack", () => captureSubstackFeed("manual"));
          return;
        }

        if (sourceId === "medium" && state.mediumAuth.isAuthenticated) {
          if (isPaused) {
            await clearProviderPause("medium");
          }
          await runManualProviderSync("medium", () => captureMediumFeed("manual"));
          return;
        }

        if (sourceId === "youtube" && state.ytAuth.isAuthenticated) {
          if (isPaused) {
            await clearProviderPause("youtube");
          }
          await runManualProviderSync("youtube", () => captureYouTube("manual"));
        }
      },
      getSourceStatus: (sourceId) => {
        const desktopState = useDesktopStore.getState();
        const health = useDebugStore.getState().health;
        return getDesktopSourceStatus(sourceId, desktopState, health);
      },
      // Local content cache (Tauri FS layer)
      getLocalContent: async (globalId) => {
        const cached = await contentCache.get(globalId);
        if (cached) return cached;
        const item = await readLibraryCoreItemDetail(globalId);
        const sqliteHtml = item?.preservedContent?.html;
        if (sqliteHtml) {
          await contentCache.set(globalId, sqliteHtml).catch(() => {});
          return sqliteHtml;
        }
        return null;
      },
      getLocalPreservedText: async (globalId) => {
        const item = await readLibraryCoreItemDetail(globalId);
        return item?.preservedContent?.text ?? null;
      },
      hydrateReaderItem: hydrateReaderItemForDesktop,
      pinReaderItem,
      youtube: {
        addToOfflinePlaylist: addYouTubeVideoToOfflinePlaylist,
      },
      // Encrypted API key store (type-widened: ApiKeyProvider -> string for PlatformConfig interface)
      secureStorage: secureStorage as {
        getApiKey: (provider: string) => Promise<string | null>;
        setApiKey: (provider: string, key: string) => Promise<void>;
        clearApiKey: (provider: string) => Promise<void>;
      },
      localAIModels,
      checkOllamaReachable,
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
      openBoundedFeedReader: tauriRuntimeAvailable
        ? openBoundedDesktopFeedReader
        : undefined,
      openBoundedFriendsFeedReader: tauriRuntimeAvailable
        ? openBoundedDesktopFriendsFeedReader
        : undefined,
      openBoundedSavedFeedReader: tauriRuntimeAvailable
        ? openBoundedDesktopSavedFeedReader
        : undefined,
      scanLibraryItems: tauriRuntimeAvailable
        ? scanLibraryCoreItemsForDesktop
        : undefined,
      searchLibraryItems:
        tauriRuntimeAvailable && isInitialized && isSqliteLibraryActive()
          ? searchLibraryCoreItemsForDesktop
          : undefined,
      executeLibraryScopeAction:
        tauriRuntimeAvailable && isInitialized && isSqliteLibraryActive()
          ? executeDesktopLibraryScopeAction
          : undefined,
      readFeedSignalCounts:
        tauriRuntimeAvailable && isInitialized && isSqliteLibraryActive()
          ? readDesktopFeedSignalCounts
          : undefined,
      readLibraryFacetSummary:
        tauriRuntimeAvailable && isInitialized
          ? readLibraryCoreFacetSummary
          : undefined,
      readLibraryItemDetail:
        tauriRuntimeAvailable && isInitialized
          ? readLibraryCoreItemDetail
          : undefined,
      readLibrarySavedAnalytics:
        tauriRuntimeAvailable && isInitialized
          ? readLibraryCoreSavedAnalytics
          : undefined,
      readLibraryFriendsGraph:
        tauriRuntimeAvailable && isInitialized
          ? readLibraryCoreFriendsGraph
          : undefined,
      readLibraryPersonDetail:
        tauriRuntimeAvailable && isInitialized
          ? readLibraryCorePersonDetail
          : undefined,
      readLibraryFriendDetail:
        tauriRuntimeAvailable && isInitialized
          ? readLibraryCoreFriendDetail
          : undefined,
      replaceLibraryFriend:
        tauriRuntimeAvailable && isInitialized
          ? replaceSqliteLibraryFriend
          : undefined,
      upsertLibraryPerson:
        tauriRuntimeAvailable && isInitialized
          ? upsertSqliteLibraryPerson
          : undefined,
      removeLibraryPerson:
        tauriRuntimeAvailable && isInitialized
          ? removeSqliteLibraryPerson
          : undefined,
      assignLibraryAccountToPerson:
        tauriRuntimeAvailable && isInitialized
          ? assignSqliteLibraryAccountToPerson
          : undefined,
      appendLibraryPersonReachOut:
        tauriRuntimeAvailable && isInitialized
          ? appendSqliteLibraryPersonReachOut
          : undefined,
      upsertLibraryAccount:
        tauriRuntimeAvailable && isInitialized
          ? upsertSqliteLibraryAccount
          : undefined,
      readLibraryAccountDetail:
        tauriRuntimeAvailable && isInitialized
          ? readLibraryCoreAccountDetail
          : undefined,
      queryLibraryCore:
        tauriRuntimeAvailable && isInitialized
          ? queryNormalizedLibrary
          : undefined,
      mutateDeviceContacts:
        tauriRuntimeAvailable && isInitialized
          ? mutateNormalizedDeviceContacts
          : undefined,
      queryDeviceContacts:
        tauriRuntimeAvailable && isInitialized
          ? queryNormalizedDeviceContacts
          : undefined,
      readLibraryPersonTimeline:
        tauriRuntimeAvailable && isInitialized
          ? readLibraryCorePersonTimeline
          : undefined,
      readLibraryFriendsLocationItem:
        tauriRuntimeAvailable && isInitialized
          ? readLibraryCoreFriendsLocationItem
          : undefined,
      readLibraryStoryWallCandidates:
        tauriRuntimeAvailable && isInitialized
          ? readLibraryCoreStoryWallCandidates
          : undefined,
      readLibraryMapCandidates:
        tauriRuntimeAvailable && isInitialized
          ? readLibraryCoreMapCandidates
          : undefined,
      pickContact: pickContactViaTauri,
      googleContacts: tauriRuntimeAvailable
        ? {
            getToken: async () => {
              try {
                return await runFactoryResetSensitiveDesktopOperation(async (resetEpoch) => {
                  const token = await getValidCloudToken("gdrive");
                  assertFactoryResetEpoch(resetEpoch);
                  return token;
                });
              } catch (error) {
                if (isOAuthCanceledError(error)) return null;
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
     [checkForUpdates, applyUpdate, connectGoogleContacts, fetchGoogleContactsForDesktop, handleFactoryReset, hasKeyboardShortcutSettingsSurface, installedReleaseChannel, isInitialized, reconnectCloudProvider, releaseChannel, releaseChannelResolved, retryCloudProvider, seedSocialConnections, setReleaseChannel, ShortcutsSettingsContent, tauriRuntimeAvailable, updateState],
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
    __FREED_E2E_TOUCH_ONLY__?: boolean;
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
