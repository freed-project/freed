import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { collectSavedYouTubeVideoUrls } from "@freed/shared";
import type { SyncProviderSectionProps } from "@freed/ui/context";
import { usePlatform } from "@freed/ui/context";
import { ProviderStatusIndicator } from "@freed/ui/components/ProviderStatusIndicator";
import { getProviderStatusLabel, getProviderStatusTone } from "@freed/ui/lib/provider-status";
import { useDebugStore } from "@freed/ui/lib/debug-store";
import { listen } from "@tauri-apps/api/event";
import { useProviderRiskGate } from "../hooks/useProviderRiskGate";
import { captureYouTube, type YouTubeSyncDiag } from "../lib/youtube-capture";
import {
  checkYouTubeAuth,
  disconnectYouTube,
  hideYouTubeLogin,
  showYouTubeLogin,
  storeYouTubeAuthState,
} from "../lib/youtube-auth";
import {
  getYouTubePlaylistState,
  clearYouTubePlaylistState,
  resetYouTubePlaylistProgress,
  subscribeYouTubePlaylistState,
  syncSavedYouTubeVideosToOfflinePlaylist,
  type YouTubePlaylistState,
} from "../lib/youtube-playlist";
import { useAppStore, withProviderSyncing } from "../lib/store";
import { ProviderSyncActionButton } from "./ProviderSyncActionButton";
import { SyncProviderSectionSurface } from "./SyncProviderSectionSurface";
import { ProviderHealthSectionSummary } from "./ProviderHealthSectionSummary";
import { clearProviderPause, resetProviderPauseState } from "../lib/provider-health";
import {
  isDesktopProviderAuthAllowed,
  registerDesktopProviderAuthQuiesceHandler,
} from "../lib/provider-auth-lifecycle";

export function YouTubeSettingsSection({
  surface = "settings",
}: SyncProviderSectionProps) {
  const { openUrl } = usePlatform();
  const auth = useAppStore((state) => state.ytAuth);
  const setAuth = useAppStore((state) => state.setYtAuth);
  const syncing = useAppStore((state) => (state.providerSyncCounts.youtube ?? 0) > 0);
  const healthSnapshot = useDebugStore((state) => state.health?.providers.youtube ?? null);
  const items = useAppStore((state) => state.items);
  const savedVideoUrls = useMemo(() => collectSavedYouTubeVideoUrls(items), [items]);
  const savedCount = savedVideoUrls.length;
  const { confirm, dialog } = useProviderRiskGate("youtube");
  const [checking, setChecking] = useState(false);
  const [playlistSyncing, setPlaylistSyncing] = useState(false);
  const [playlist, setPlaylist] = useState<YouTubePlaylistState>(getYouTubePlaylistState);
  const [lastDiag, setLastDiag] = useState<YouTubeSyncDiag | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const loginPendingRef = useRef(false);
  const playlistAbortRef = useRef<AbortController | null>(null);

  const applyAuthResult = useCallback((loggedIn: boolean) => {
    if (!isDesktopProviderAuthAllowed()) return;
    const current = useAppStore.getState().ytAuth;
    const next = {
      ...current,
      isAuthenticated: loggedIn,
      lastCheckedAt: Date.now(),
      lastCaptureError: loggedIn ? undefined : current.lastCaptureError,
    };
    setAuth(next);
    storeYouTubeAuthState(next);
    if (!loggedIn) clearYouTubePlaylistState();
  }, [setAuth]);

  const runSync = useCallback(async (trigger: "manual" | "post_login" = "manual") => {
    setActionError(null);
    setLastDiag(null);
    if (healthSnapshot?.status === "paused") await clearProviderPause("youtube");
    const result = await withProviderSyncing("youtube", () => captureYouTube(trigger));
    if (!isDesktopProviderAuthAllowed()) return result;
    setLastDiag(result.diag);
    if (result.diag.errorStage) {
      throw new Error(result.diag.errorMessage ?? "YouTube sync failed.");
    }
    return result;
  }, [healthSnapshot?.status]);

  useEffect(() => subscribeYouTubePlaylistState(setPlaylist), []);
  useEffect(
    () => registerDesktopProviderAuthQuiesceHandler(() => {
      loginPendingRef.current = false;
      playlistAbortRef.current?.abort();
      playlistAbortRef.current = null;
    }),
    [],
  );

  useEffect(() => {
    const authUnlisten = listen<{ loggedIn: boolean }>("yt-auth-result", (event) => {
      if (!isDesktopProviderAuthAllowed()) return;
      const loggedIn = event.payload.loggedIn;
      applyAuthResult(loggedIn);
      if (!loggedIn || !loginPendingRef.current) return;

      loginPendingRef.current = false;
      setMessage("Connected. Syncing your subscriptions in the background.");
      void hideYouTubeLogin()
        .catch(() => {})
        .then(() => runSync("post_login"))
        .then(() => {
          if (!isDesktopProviderAuthAllowed()) return;
          setMessage("Connected. Subscription sync finished.");
        })
        .catch((error) => {
          if (!isDesktopProviderAuthAllowed()) return;
          setMessage(null);
          setActionError(error instanceof Error ? error.message : String(error));
        });
    });
    const closeUnlisten = listen<{ closed: boolean }>("yt-login-window-closed", (event) => {
      if (!isDesktopProviderAuthAllowed()) return;
      if (!event.payload.closed) return;
      const wasPending = loginPendingRef.current;
      loginPendingRef.current = false;
      if (wasPending) setMessage(null);
    });

    return () => {
      void authUnlisten.then((fn) => fn());
      void closeUnlisten.then((fn) => fn());
    };
  }, [applyAuthResult, runSync]);

  const handleLogin = useCallback(async () => {
    await confirm(async () => {
      if (!isDesktopProviderAuthAllowed()) return;
      setActionError(null);
      setMessage(null);
      loginPendingRef.current = true;
      clearYouTubePlaylistState();
      try {
        await showYouTubeLogin();
      } catch (error) {
        if (!isDesktopProviderAuthAllowed()) return;
        loginPendingRef.current = false;
        setActionError(error instanceof Error ? error.message : "Could not open YouTube.");
      }
    });
  }, [confirm]);

  const handleCheck = useCallback(async () => {
    await confirm(async () => {
      if (!isDesktopProviderAuthAllowed()) return;
      setChecking(true);
      setActionError(null);
      try {
        const loggedIn = await checkYouTubeAuth();
        if (!isDesktopProviderAuthAllowed()) return;
        applyAuthResult(loggedIn);
        if (!loggedIn) setActionError("YouTube did not find a signed-in website session.");
      } finally {
        if (isDesktopProviderAuthAllowed()) setChecking(false);
      }
    });
  }, [applyAuthResult, confirm]);

  const handleDisconnect = useCallback(async () => {
    await disconnectYouTube().catch(() => {});
    clearYouTubePlaylistState();
    await resetProviderPauseState("youtube");
    loginPendingRef.current = false;
    setAuth({ isAuthenticated: false });
    setLastDiag(null);
    setMessage(null);
    setActionError(null);
  }, [setAuth]);

  const handlePlaylistSync = useCallback(async () => {
    await confirm(async () => {
      if (!isDesktopProviderAuthAllowed()) return;
      setPlaylistSyncing(true);
      setActionError(null);
      const controller = new AbortController();
      playlistAbortRef.current = controller;
      try {
        const result = await syncSavedYouTubeVideosToOfflinePlaylist(
          savedVideoUrls,
          controller.signal,
        );
        const progress = `${result.addedCount.toLocaleString()} added, ${result.existingCount.toLocaleString()} already confirmed.`;
        setMessage(result.remainingCount > 0
          ? `${progress} ${result.remainingCount.toLocaleString()} remain for the next batch.`
          : `${progress} Freed Offline is up to date.`);
      } catch (error) {
        setActionError(error instanceof Error ? error.message : "YouTube playlist sync failed.");
      } finally {
        playlistAbortRef.current = null;
        setPlaylistSyncing(false);
      }
    });
  }, [confirm, savedVideoUrls]);

  const authError = auth.lastCaptureError ?? actionError;
  const statusTone = getProviderStatusTone({
    isConnected: auth.isAuthenticated,
    authError,
    snapshot: healthSnapshot,
  });
  const statusLabel = getProviderStatusLabel({
    isConnected: auth.isAuthenticated,
    authError,
    snapshot: healthSnapshot,
  });

  return (
    <>
      <SyncProviderSectionSurface surface={surface} title="YouTube">
        <div className="space-y-4">
          <div className="flex items-center gap-3 rounded-xl bg-white/5 px-3 py-2.5">
            <ProviderStatusIndicator
              tone={statusTone}
              syncing={syncing}
              label={statusLabel}
              testId="provider-status-youtube"
            />
            <span className="text-sm text-[#a1a1aa]">{statusLabel}</span>
          </div>

          <p className="text-sm leading-relaxed text-[#71717a]">
            Freed reads your subscriptions and followed channels through your signed-in YouTube
            website session. Sync never opens Home or Shorts.
          </p>

          {auth.isAuthenticated ? (
            <div className="space-y-3">
              <div className="flex gap-2">
                <ProviderSyncActionButton
                  busy={syncing}
                  disabled={syncing || playlistSyncing}
                  onClick={() => {
                    void confirm(async () => {
                      try {
                        await runSync();
                      } catch (error) {
                        setActionError(error instanceof Error ? error.message : String(error));
                      }
                    });
                  }}
                  testId="provider-sync-action-youtube"
                >
                  Sync Now
                </ProviderSyncActionButton>
                <button
                  type="button"
                  onClick={handleDisconnect}
                  className="rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-400 transition-colors hover:bg-red-500/20"
                >
                  Disconnect
                </button>
              </div>

              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                <p className="text-sm text-[#a1a1aa]">Freed Offline</p>
                <p className="mt-1 text-xs leading-relaxed text-[#52525b]">
                  {savedCount.toLocaleString()} saved YouTube video{savedCount === 1 ? "" : "s"}.
                  Sync uses YouTube's normal Save controls. Premium manages downloads on each device.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <ProviderSyncActionButton
                    busy={playlistSyncing}
                    busyLabel="Saving"
                    disabled={syncing || playlistSyncing || savedCount === 0}
                    onClick={() => { void handlePlaylistSync(); }}
                    testId="youtube-sync-saved-playlist"
                  >
                    Sync Saved Videos
                  </ProviderSyncActionButton>
                  {playlistSyncing ? (
                    <button
                      type="button"
                      onClick={() => playlistAbortRef.current?.abort()}
                      className="rounded-xl bg-white/5 px-3 py-2 text-sm text-[#a1a1aa] transition-colors hover:bg-white/10"
                    >
                      Stop After Current Video
                    </button>
                  ) : null}
                  {playlist.playlistUrl ? (
                    <>
                      <button
                        type="button"
                        onClick={() => openUrl?.(playlist.playlistUrl!)}
                        className="rounded-xl bg-white/5 px-3 py-2 text-sm text-[#a1a1aa] transition-colors hover:bg-white/10"
                      >
                        Open Playlist
                      </button>
                      {(playlist.syncedVideoIds?.length ?? 0) > 0 ? (
                        <button
                          type="button"
                          onClick={() => {
                            resetYouTubePlaylistProgress();
                            setMessage("The next sync will recheck every saved YouTube video.");
                          }}
                          className="rounded-xl bg-white/5 px-3 py-2 text-sm text-[#a1a1aa] transition-colors hover:bg-white/10"
                        >
                          Recheck All
                        </button>
                      ) : null}
                    </>
                  ) : null}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              <ProviderSyncActionButton
                busy={false}
                onClick={() => { void handleLogin(); }}
                testId="provider-connect-youtube"
              >
                {auth.lastCaptureError ? "Reconnect YouTube" : "Log in with YouTube"}
              </ProviderSyncActionButton>
              <button
                type="button"
                onClick={() => { void handleCheck(); }}
                disabled={checking}
                className="rounded-xl bg-white/5 px-4 py-2 text-sm text-[#71717a] transition-colors hover:bg-white/10 disabled:opacity-50"
              >
                {checking ? "Checking..." : "Check Connection"}
              </button>
            </div>
          )}

          {message ? <p className="text-xs leading-relaxed text-[#a1a1aa]">{message}</p> : null}
          {authError ? <p className="text-xs leading-relaxed text-red-400">{authError}</p> : null}
          {lastDiag && !lastDiag.errorStage ? (
            <p className="text-xs leading-relaxed text-[#52525b]">
              Found {lastDiag.channelsExtracted.toLocaleString()} followed channel
              {lastDiag.channelsExtracted === 1 ? "" : "s"} and {lastDiag.videosExtracted.toLocaleString()} video
              {lastDiag.videosExtracted === 1 ? "" : "s"}.
            </p>
          ) : null}
          {auth.isAuthenticated ? (
            <ProviderHealthSectionSummary provider="youtube" showMessages />
          ) : null}
        </div>
      </SyncProviderSectionSurface>
      {dialog}
    </>
  );
}
