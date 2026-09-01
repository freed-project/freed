import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import {
  getWebsiteHostForChannel,
  SAMPLE_SHOWCASE_FEED_COUNT,
  SAMPLE_SHOWCASE_FRIEND_COUNT,
  SAMPLE_SHOWCASE_ITEM_COUNT,
  SAMPLE_SHOWCASE_SOCIAL_IDENTITY_COUNT,
  type ReleaseChannel,
} from "@freed/shared";
import { AppShell } from "@freed/ui/components/layout";
import { BugReportBoundary } from "@freed/ui/components/BugReportBoundary";
import { FeedView } from "@freed/ui/components/feed";
import { FatalErrorScreen } from "@freed/ui/components/FatalErrorScreen";
import { LocalPreviewBadge } from "@freed/ui/components/LocalPreviewBadge";
import { ToastContainer, toast } from "@freed/ui/components/Toast";
import { LegalGate } from "@freed/ui/components/legal/LegalGate";
import { OAuthCallback } from "./components/OAuthCallback";
import { DemoWelcomeBanner } from "./components/DemoWelcomeBanner";
import {
  PlatformProvider,
  type AvailableUpdateInfo,
  type PlatformConfig,
} from "@freed/ui/context";
import { quiescePwaStartupMigrations, useAppStore } from "./lib/store";
import {
  onStatusChange,
  startCloudSync,
  stopCloudSync,
  getCloudProvider,
  getCloudToken,
  clearStoredCloudDataForFactoryReset,
} from "./lib/sync";
import {
  applyPwaUpdate,
  checkForPwaUpdate,
  initPwaUpdater,
  onUpdateAvailable,
} from "./lib/pwa-updater";
import {
  isContactPickerAvailable,
  pickContactViaWebApi,
} from "./lib/contacts";
import { PwaFeedEmptyState } from "./components/PwaFeedEmptyState";
import { PwaSyncSettings } from "./components/PwaSyncSettings";
import {
  PwaFacebookSettings,
  PwaFeedsSettings,
  PwaGoogleContactsSettings,
  PwaInstagramSettings,
  PwaLinkedInSettings,
  PwaYouTubeSettings,
  PwaXSettings,
} from "./components/PwaSocialProviderSettings";
import { PwaLegalSettingsSection } from "./components/PwaLegalSettingsSection";
import { acceptPwaBundle, hasAcceptedPwaBundle } from "./lib/legal-consent";
import { useBrowserNavigationHistory } from "./lib/navigation-history";
import { pwaBugReporting } from "./lib/bug-report";
import {
  clearFatalRuntimeError,
  useFatalRuntimeError,
} from "@freed/ui/lib/bug-report";
import {
  bootstrapReleaseChannel,
  buildPwaReleaseChannelUrl,
  persistReleaseChannel,
} from "@freed/ui/lib/release-channel";
import { saveUrlInPwa } from "./lib/save-url";
import { getCachedArticleHtml } from "@freed/ui/lib/article-cache";
import { clearDeviceAIPreferences } from "@freed/ui/lib/device-ai-preferences";
import { clearDeviceDisplayPreferences } from "@freed/ui/lib/device-display-preferences";
import { clearLegacyDeviceGraphLayoutImport } from "@freed/ui/lib/device-graph-layout";
import { resetFeedCardDensity } from "@freed/ui/lib/feed-card-density";
import { resetInterfaceZoom } from "@freed/ui/lib/interface-zoom";
import {
  beginFactoryResetBoundary,
  clearFactoryResetCloudCleanupBarrier,
  FactoryResetPhaseError,
  hasFactoryResetCloudCleanupBarrier,
  runFactoryResetOperations,
  runFactoryResetWithRecovery,
} from "@freed/ui/lib/factory-reset";
import { resetThemePreference } from "@freed/ui/lib/theme";
import { hydrateReaderItemInPwa, pinReaderItemInPwa } from "./lib/reader-cache";
import {
  appendPwaLibraryCorePersonReachOut,
  assignPwaLibraryCoreAccountToPerson,
  ensurePwaLibraryCoreLocalSampleState,
  executePwaLibraryCoreScopeAction,
  openPwaLibraryCoreFeedReader,
  openPwaLibraryCoreFriendsFeedReader,
  openPwaLibraryCoreSavedFeedReader,
  readPwaLibraryCoreFacetSummary,
  readPwaLibraryCoreAccountDetail,
  readPwaLibraryCoreFeedSignalCounts,
  readPwaLibraryCoreFriendsGraph,
  readPwaLibraryCoreFriendDetail,
  readPwaLibraryCoreFriendsLocationItem,
  readPwaLibraryCoreItemDetail,
  readPwaLibraryCoreMapCandidates,
  readPwaLibraryCorePersonTimeline,
  readPwaLibraryCorePersonDetail,
  readPwaLibraryCoreSavedAnalytics,
  readPwaLibraryCoreStoryWallCandidates,
  removePwaLibraryCorePerson,
  replacePwaLibraryCoreFriend,
  scanPwaLibraryCoreItems,
  searchPwaLibraryCoreItems,
  settlePwaLibraryCoreLocalSampleState,
  upsertPwaLibraryCorePerson,
  upsertPwaLibraryCoreAccount,
} from "./lib/library-core-runtime";
import {
  mutatePwaDeviceGraphLayout,
  mutatePwaDeviceContactSync,
  queryPwaDeviceContacts,
  queryPwaNormalizedLibrary,
} from "./lib/library-core-sqlite-runtime";
import {
  clearSampleLibraryDataWithProgressToast,
  populateSampleLibraryDataWithProgressToast,
} from "@freed/ui/lib/sample-library-seed";
import {
  clearInstallNoticeDismissal,
  dismissInstallNotice,
  getInitialInstallNotice,
  watchInstallPrompt,
  type InstallNotice,
} from "./lib/pwa-install";
import { openPwaUrl } from "./lib/youtube-handoff";
import {
  preparePwaFactoryResetReload,
  runCoordinatedPwaFactoryReset,
} from "./lib/factory-reset-coordinator";
import { installFreedDemoCheckpoint } from "./lib/demo-checkpoint";
import { isFreedDemoMode } from "./lib/demo-mode";

const IS_FEATURE_PREVIEW = import.meta.env.VITE_FREED_FEATURE_PREVIEW === "1";
const IS_DEMO = isFreedDemoMode(window.location.hostname);
const LOCAL_PREVIEW_LABEL =
  import.meta.env.VITE_FREED_PREVIEW_LABEL?.trim() || null;

function OAuthRouter() {
  if (!IS_DEMO && window.location.pathname === "/oauth-callback") {
    return <OAuthCallback />;
  }

  return <App />;
}

function FloatingNotice({
  title,
  body,
  actionLabel,
  onAction,
  onDismiss,
  testId,
}: {
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
  onDismiss: () => void;
  testId?: string;
}) {
  return (
    <div
      className="theme-panel flex items-start gap-3 rounded-xl p-4 shadow-[0_24px_60px_rgb(0_0_0/0.28)]"
      data-testid={testId}
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-[var(--theme-text-primary)]">
          {title}
        </p>
        <p className="mt-0.5 text-xs leading-relaxed text-[var(--theme-text-muted)]">
          {body}
        </p>
      </div>
      {actionLabel && onAction && (
        <button
          onClick={onAction}
          className="btn-primary shrink-0 px-3 py-1.5 text-xs font-semibold"
          data-testid={testId ? `${testId}-action` : undefined}
        >
          {actionLabel}
        </button>
      )}
      <button
        onClick={onDismiss}
        className="shrink-0 text-[var(--theme-text-muted)] transition-colors hover:text-[var(--theme-text-primary)]"
        aria-label="Dismiss"
        data-testid={testId ? `${testId}-dismiss` : undefined}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path
            d="M1 1l12 12M13 1L1 13"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  );
}

function App() {
  const initialize = useAppStore((state) => state.initialize);
  const isInitialized = useAppStore((state) => state.isInitialized);
  const error = useAppStore((state) => state.error);
  const setError = useAppStore((state) => state.setError);
  const setSyncConnected = useAppStore((state) => state.setSyncConnected);
  const [showUpdateBanner, setShowUpdateBanner] = useState(false);
  const [installNotice, setInstallNotice] = useState<InstallNotice | null>(
    null,
  );

  const [legalResolved, setLegalResolved] = useState(false);
  const [legalAccepted, setLegalAccepted] = useState(false);
  const [releaseChannel, setReleaseChannelState] = useState<ReleaseChannel>(
    () => bootstrapReleaseChannel(),
  );
  const fatalError = useFatalRuntimeError();
  const legalAcceptedRef = useRef(legalAccepted);

  useBrowserNavigationHistory(legalAccepted);

  useEffect(() => {
    legalAcceptedRef.current = legalAccepted;
  }, [legalAccepted]);

  // Reads a synchronous localStorage flag once on mount, so the extra render
  // pass react-hooks/set-state-in-effect warns about is real but bounded: it
  // costs one paint of the blank shell below before the gate resolves.
  //
  // Lazy useState initialisers would remove it, but this decides whether the
  // legal gate is shown, and the acceptPwaBundle() write has to stay in an
  // effect regardless. Not worth reshaping a consent gate at the same time as a
  // lint upgrade, so this is suppressed deliberately rather than papered over.
  // Tracked for a proper pass.
  /* eslint-disable react-hooks/set-state-in-effect -- bounded gate bootstrap described above */
  useEffect(() => {
    if (IS_DEMO || IS_FEATURE_PREVIEW) {
      if (!IS_DEMO) acceptPwaBundle();
      setLegalAccepted(true);
      setLegalResolved(true);
      return;
    }

    setLegalAccepted(hasAcceptedPwaBundle());
    setLegalResolved(true);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!legalAccepted) return;
    if (IS_DEMO) {
      performance.mark("freed-demo-checkpoint:start");
      void installFreedDemoCheckpoint()
        .then(() => {
          performance.mark("freed-demo-checkpoint:end");
          performance.measure(
            "freed-demo-checkpoint",
            "freed-demo-checkpoint:start",
            "freed-demo-checkpoint:end",
          );
          return initialize();
        })
        .catch((error) => {
          console.error(
            "[demo] failed to activate showcase checkpoint:",
            error,
          );
          setError(
            error instanceof Error
              ? error.message
              : "Freed could not prepare the showcase Library",
          );
        });
      return;
    }
    if (!IS_FEATURE_PREVIEW) {
      initialize();
      return;
    }
    void ensurePwaLibraryCoreLocalSampleState()
      .then(() => initialize())
      .catch((error) => {
        console.error(
          "[sample-data] failed to initialize local preview data:",
          error,
        );
        setError(
          error instanceof Error
            ? error.message
            : "Freed could not prepare the local preview Library",
        );
      });
  }, [initialize, legalAccepted, setError]);

  useEffect(() => {
    if (!isInitialized || !IS_FEATURE_PREVIEW || IS_DEMO) return;
    void (async () => {
      await ensurePwaLibraryCoreLocalSampleState();
      await settlePwaLibraryCoreLocalSampleState();
      const facets = await readPwaLibraryCoreFacetSummary();
      const sampleIsComplete =
        facets.sampleAccountCount >=
          SAMPLE_SHOWCASE_SOCIAL_IDENTITY_COUNT &&
        facets.sampleFeedCount >= SAMPLE_SHOWCASE_FEED_COUNT &&
        facets.sampleItemCount >= SAMPLE_SHOWCASE_ITEM_COUNT &&
        facets.samplePersonCount >= SAMPLE_SHOWCASE_FRIEND_COUNT;
      if (sampleIsComplete) return;
      const sampleTotal =
        facets.sampleAccountCount +
        facets.sampleFeedCount +
        facets.sampleItemCount +
        facets.samplePersonCount;
      const actions = useAppStore.getState();
      if (sampleTotal > 0) {
        await clearSampleLibraryDataWithProgressToast(actions);
      }
      await populateSampleLibraryDataWithProgressToast(actions);
    })().catch((error) => {
      console.error(
        "[sample-data] failed to seed local preview data:",
        error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      );
    });
  }, [isInitialized]);

  useEffect(() => {
    if (!legalAccepted || !isInitialized || IS_DEMO) return;
    const unsubscribe = onStatusChange((connected) => {
      setSyncConnected(connected);
    });

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
      stopCloudSync();
    };
  }, [isInitialized, legalAccepted, setSyncConnected]);

  useEffect(() => {
    if (!legalAccepted || IS_DEMO) return;
    const stopPolling = initPwaUpdater();
    const unsubscribe = onUpdateAvailable(() => setShowUpdateBanner(true));
    return () => {
      unsubscribe();
      stopPolling();
    };
  }, [legalAccepted]);

  // Same shape as the gate above: seed the notice from its current external
  // value, then subscribe. It cannot become a lazy initialiser as it stands,
  // because it must not run until the gate resolves. Suppressed with the rest
  // and tracked together.
  /* eslint-disable react-hooks/set-state-in-effect -- deferred external-state bootstrap described above */
  useEffect(() => {
    if (!legalResolved || IS_DEMO) return;

    setInstallNotice(getInitialInstallNotice());

    return watchInstallPrompt({
      onInstallPrompt: (notice) => setInstallNotice(notice),
      onInstalled: () => {
        clearInstallNoticeDismissal();
        setInstallNotice(null);
        if (legalAcceptedRef.current) {
          toast.success("Freed is installed");
        }
      },
    });
  }, [legalResolved]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const checkForUpdates =
    useCallback(async (): Promise<AvailableUpdateInfo | null> => {
      const version = await checkForPwaUpdate();
      return version ? { version, channel: releaseChannel } : null;
    }, [releaseChannel]);
  const setReleaseChannel = useCallback(
    (channel: ReleaseChannel) => {
      if (channel === releaseChannel) {
        return;
      }

      persistReleaseChannel(channel);
      setReleaseChannelState(channel);

      const nextUrl = buildPwaReleaseChannelUrl(window.location.href, channel);
      if (nextUrl !== window.location.href) {
        window.location.assign(nextUrl);
      }
    },
    [releaseChannel],
  );

  const handleFactoryReset = useCallback(async (deleteFromCloud: boolean) => {
    await runFactoryResetWithRecovery({
      reset: async () => {
        beginFactoryResetBoundary();
        await runCoordinatedPwaFactoryReset(async () => {
          stopCloudSync();
          await runFactoryResetOperations({
            quiesceLocalWriters: [quiescePwaStartupMigrations],
            clearDeviceStores: () => [
              clearDeviceDisplayPreferences(),
              clearDeviceAIPreferences(),
              clearLegacyDeviceGraphLayoutImport(),
            ],
            clearLocalSettings: [
              resetFeedCardDensity,
              resetInterfaceZoom,
              resetThemePreference,
            ],
            clearLocalData: [],
            clearProviderDataAndConnections: async () => {
              stopCloudSync();
              await clearStoredCloudDataForFactoryReset(deleteFromCloud);
            },
            clearLibrary: async () => {},
          });
          clearFactoryResetCloudCleanupBarrier();
        });
      },
      reload: () => {
        preparePwaFactoryResetReload();
        location.reload();
      },
      onFailure: (error) => {
        const providerCleanupFailed =
          error instanceof FactoryResetPhaseError &&
          error.phase === "clear provider data and connections";
        const cloudCleanupPaused = hasFactoryResetCloudCleanupBarrier();
        toast.error(
          providerCleanupFailed
            ? "Factory reset stopped because account cleanup did not finish. Freed will reload with cloud sync paused so you can retry safely."
            : cloudCleanupPaused
              ? "Factory reset stopped before cleanup finished. Freed will reload with cloud sync paused so you can retry safely."
              : "Factory reset stopped because Freed could not finish local cleanup. Reloading Freed so you can retry safely.",
        );
      },
    });
  }, []);
  const handleLocalLibraryRecovery = useCallback(async () => {
    await runFactoryResetWithRecovery({
      reset: async () => {
        beginFactoryResetBoundary();
        stopCloudSync();
        await runCoordinatedPwaFactoryReset(async () => {});
      },
      reload: () => {
        preparePwaFactoryResetReload();
        location.reload();
      },
      onFailure: () => {
        toast.error(
          "Freed could not replace this device's local Library. Reloading so you can retry safely.",
        );
      },
    });
  }, []);
  const handleDismissInstallNotice = useCallback(() => {
    dismissInstallNotice();
    setInstallNotice(null);
  }, []);
  const handleInstallAction = useCallback(async () => {
    if (!installNotice || installNotice.kind !== "browser") {
      return;
    }

    try {
      await installNotice.promptEvent.prompt();
      const choice = await installNotice.promptEvent.userChoice;
      if (choice.outcome !== "accepted") {
        dismissInstallNotice();
      }
      setInstallNotice(null);
    } catch {
      dismissInstallNotice();
      setInstallNotice(null);
    }
  }, [installNotice]);

  const platform: PlatformConfig = useMemo(
    () => ({
      store: useAppStore,
      interactionMode: IS_DEMO ? "read-only" : "full",
      geographicMapMode: IS_DEMO ? "local-showcase" : "online",
      feedMediaPreviews: "inline",
      SourceIndicator: null,
      HeaderSyncIndicator: null,
      FeedsSettingsContent: IS_DEMO ? null : PwaFeedsSettings,
      SettingsExtraSections: IS_DEMO ? null : PwaSyncSettings,
      LegalSettingsContent: IS_DEMO ? null : PwaLegalSettingsSection,
      FeedEmptyState: PwaFeedEmptyState,
      XSettingsContent: IS_DEMO ? null : PwaXSettings,
      FacebookSettingsContent: IS_DEMO ? null : PwaFacebookSettings,
      InstagramSettingsContent: IS_DEMO ? null : PwaInstagramSettings,
      LinkedInSettingsContent: IS_DEMO ? null : PwaLinkedInSettings,
      SubstackSettingsContent: null,
      MediumSettingsContent: null,
      YouTubeSettingsContent: IS_DEMO ? null : PwaYouTubeSettings,
      GoogleContactsSettingsContent: IS_DEMO ? null : PwaGoogleContactsSettings,
      checkForUpdates: IS_DEMO ? undefined : checkForUpdates,
      applyUpdate: IS_DEMO ? undefined : applyPwaUpdate,
      releaseChannel,
      setReleaseChannel: IS_DEMO ? undefined : setReleaseChannel,
      factoryReset: IS_DEMO ? undefined : handleFactoryReset,
      activeCloudProviderLabel: () =>
        getCloudProvider() === "gdrive" ? "Google Drive" : null,
      // PWA save URL: fetches and caches article content when possible, then
      // falls back to a desktop-healed stub for sites that refuse extraction.
      saveUrl: IS_DEMO
        ? undefined
        : async (url, options) => saveUrlInPwa(url, options),
      // PWA local content: check the Workbox Cache API
      getLocalContent: async (globalId: string) => {
        try {
          const cached = await getCachedArticleHtml(globalId);
          if (cached) return cached;
          return null;
        } catch {
          return null;
        }
      },
      hydrateReaderItem: IS_DEMO ? undefined : hydrateReaderItemInPwa,
      pinReaderItem: IS_DEMO ? undefined : pinReaderItemInPwa,
      // FriendEditor falls back to manual entry when the Contact Picker API is
      // unavailable, while a real picker cancellation remains a cancellation.
      pickContact:
        !IS_DEMO && isContactPickerAvailable()
          ? pickContactViaWebApi
          : undefined,
      openUrl: IS_DEMO
        ? async () => toast.info("External links are disabled in this read only demo")
        : openPwaUrl,
      openBoundedFeedReader: openPwaLibraryCoreFeedReader,
      openBoundedFriendsFeedReader: openPwaLibraryCoreFriendsFeedReader,
      openBoundedSavedFeedReader: openPwaLibraryCoreSavedFeedReader,
      scanLibraryItems: scanPwaLibraryCoreItems,
      searchLibraryItems: searchPwaLibraryCoreItems,
      executeLibraryScopeAction: IS_DEMO ? undefined : executePwaLibraryCoreScopeAction,
      readFeedSignalCounts: readPwaLibraryCoreFeedSignalCounts,
      readLibraryFacetSummary: readPwaLibraryCoreFacetSummary,
      readLibrarySavedAnalytics: readPwaLibraryCoreSavedAnalytics,
      readLibraryFriendsGraph: readPwaLibraryCoreFriendsGraph,
      readLibraryPersonDetail: readPwaLibraryCorePersonDetail,
      readLibraryFriendDetail: readPwaLibraryCoreFriendDetail,
      replaceLibraryFriend: IS_DEMO ? undefined : replacePwaLibraryCoreFriend,
      upsertLibraryPerson: IS_DEMO ? undefined : upsertPwaLibraryCorePerson,
      removeLibraryPerson: IS_DEMO ? undefined : removePwaLibraryCorePerson,
      assignLibraryAccountToPerson: IS_DEMO ? undefined : assignPwaLibraryCoreAccountToPerson,
      appendLibraryPersonReachOut: IS_DEMO ? undefined : appendPwaLibraryCorePersonReachOut,
      upsertLibraryAccount: IS_DEMO ? undefined : upsertPwaLibraryCoreAccount,
      readLibraryAccountDetail: readPwaLibraryCoreAccountDetail,
      queryLibraryCore: queryPwaNormalizedLibrary,
      mutateDeviceGraphLayout: IS_DEMO ? undefined : mutatePwaDeviceGraphLayout,
      mutateDeviceContacts: IS_DEMO ? undefined : mutatePwaDeviceContactSync,
      queryDeviceContacts: queryPwaDeviceContacts,
      readLibraryPersonTimeline: readPwaLibraryCorePersonTimeline,
      readLibraryFriendsLocationItem: readPwaLibraryCoreFriendsLocationItem,
      readLibraryStoryWallCandidates: readPwaLibraryCoreStoryWallCandidates,
      readLibraryMapCandidates: readPwaLibraryCoreMapCandidates,
      readLibraryItemDetail: readPwaLibraryCoreItemDetail,
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

  if (IS_DEMO && !isInitialized && !error) {
    return (
      <div className="app-theme-shell flex h-screen items-center justify-center">
        <p className="text-sm font-medium text-[var(--theme-text-muted)]">
          Preparing the Freed showcase...
        </p>
      </div>
    );
  }

  if (error && !isInitialized) {
    return (
      <PlatformProvider value={platform}>
        <FatalErrorScreen
          error={{ message: error }}
          productName="Freed"
          onRetry={() => window.location.reload()}
          onSecondaryAction={handleLocalLibraryRecovery}
          secondaryActionLabel="Replace local Library"
          secondaryActionConfirmation={{
            title: "Replace this device's local Library?",
            body: "This removes queued edits and offline content stored only on this device. It does not delete Google Drive data or another device's Library. Freed will reload and restore from Google Drive when available.",
            confirmLabel: "Replace local Library",
          }}
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
        {IS_DEMO && (
          <DemoWelcomeBanner
            downloadUrl={`https://${getWebsiteHostForChannel(releaseChannel)}/get`}
          />
        )}
        <AppShell>
          <FeedView />
        </AppShell>
        <ToastContainer />
        {(installNotice || showUpdateBanner) && (
          <div className="fixed bottom-20 left-4 right-4 z-[120] flex flex-col gap-3 sm:bottom-4 sm:left-auto sm:w-[min(24rem,calc(100vw-2rem))]">
            {installNotice && (
              <FloatingNotice
                title="Install Freed"
                body={
                  installNotice.kind === "browser"
                    ? "Add Freed to your home screen for faster launch and offline reading."
                    : "Add Freed to your home screen for faster launch and offline reading. In Safari, open Share, then tap Add to Home Screen."
                }
                actionLabel={
                  installNotice.kind === "browser" ? "Install" : undefined
                }
                onAction={
                  installNotice.kind === "browser"
                    ? () => {
                        void handleInstallAction();
                      }
                    : undefined
                }
                onDismiss={handleDismissInstallNotice}
                testId="pwa-install-notice"
              />
            )}
            {showUpdateBanner && (
              <FloatingNotice
                title="New version available"
                body="Reload to apply the update."
                actionLabel="Reload"
                onAction={applyPwaUpdate}
                onDismiss={() => setShowUpdateBanner(false)}
                testId="pwa-update-notice"
              />
            )}
          </div>
        )}
      </BugReportBoundary>
    </PlatformProvider>
  );
}

export default OAuthRouter;
