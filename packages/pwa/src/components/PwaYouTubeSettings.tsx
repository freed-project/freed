import { useEffect, useState } from "react";

import { YoutubeIcon } from "@freed/ui/components/icons";
import { usePlatform, type SyncProviderSectionProps } from "@freed/ui/context";

import {
  clearYouTubeAuth,
  getStoredYouTubeToken,
  hasYouTubePlaylistAccess,
  initiateYouTubeOAuth,
  needsYouTubeReconnect,
} from "../lib/youtube-auth";
import {
  getYouTubeIntegrationState,
  subscribeYouTubeIntegrationState,
  syncSavedYouTubeVideos,
  syncYouTubeSubscriptions,
  type YouTubeIntegrationState,
} from "../lib/youtube-integration";
import { getSavedYouTubeVideoUrls } from "../lib/automerge";

type Operation =
  | { status: "idle" }
  | { status: "working"; message: string }
  | { status: "success"; message: string }
  | { status: "error"; message: string };

function formatTimestamp(timestamp?: number): string {
  if (!timestamp) return "Not yet";
  return new Date(timestamp).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-muted)] px-3 py-3">
      <p className="text-[11px] uppercase tracking-wide text-[var(--theme-text-soft)]">{label}</p>
      <p className="mt-1 text-sm font-semibold text-[var(--theme-text-primary)]">{value}</p>
    </div>
  );
}

export function PwaYouTubeSettings({ surface = "settings" }: SyncProviderSectionProps) {
  const { openUrl } = usePlatform();
  const [integration, setIntegration] = useState<YouTubeIntegrationState>(
    getYouTubeIntegrationState,
  );
  const [operation, setOperation] = useState<Operation>({ status: "idle" });
  const [savedVideoUrls, setSavedVideoUrls] = useState<string[]>([]);
  const token = getStoredYouTubeToken();
  const reconnectRequired = needsYouTubeReconnect(token);
  const connected = token !== null && !reconnectRequired;
  const hadPlaylistAccess = hasYouTubePlaylistAccess(token);
  const playlistAccess = connected && hadPlaylistAccess;

  useEffect(() => subscribeYouTubeIntegrationState(setIntegration), []);
  useEffect(() => {
    let active = true;
    void getSavedYouTubeVideoUrls()
      .then((urls) => {
        if (active) setSavedVideoUrls(urls);
      })
      .catch(() => {
        if (active) setSavedVideoUrls([]);
      });
    return () => {
      active = false;
    };
  }, []);

  const connect = async () => {
    setOperation({ status: "working", message: "Opening Google authorization" });
    try {
      await initiateYouTubeOAuth("readonly");
    } catch (error) {
      setOperation({
        status: "error",
        message: error instanceof Error ? error.message : "Could not start YouTube connection.",
      });
    }
  };

  const reconnect = async () => {
    setOperation({ status: "working", message: "Opening Google authorization" });
    try {
      await initiateYouTubeOAuth(hadPlaylistAccess ? "playlist" : "readonly");
    } catch (error) {
      setOperation({
        status: "error",
        message: error instanceof Error ? error.message : "Could not reconnect YouTube.",
      });
    }
  };

  const syncSubscriptions = async () => {
    setOperation({ status: "working", message: "Importing followed channels and recent videos" });
    try {
      const result = await syncYouTubeSubscriptions();
      const rosterSummary = `Imported ${result.subscriptionCount.toLocaleString()} followed channel${result.subscriptionCount === 1 ? "" : "s"} and ${result.videoCount.toLocaleString()} recent video${result.videoCount === 1 ? "" : "s"}.`;
      const partialSummary = result.recentVideosComplete
        ? ""
        : ` Recent video checks completed for ${result.hydratedChannelCount.toLocaleString()} channel${result.hydratedChannelCount === 1 ? "" : "s"}; ${result.skippedChannelCount.toLocaleString()} could not be checked.`;
      setOperation({
        status: "success",
        message: `${rosterSummary}${partialSummary}`,
      });
    } catch (error) {
      setOperation({
        status: "error",
        message: error instanceof Error ? error.message : "Could not sync YouTube subscriptions.",
      });
    }
  };

  const enableOfflinePlaylist = async () => {
    setOperation({ status: "working", message: "Opening playlist authorization" });
    try {
      await initiateYouTubeOAuth("playlist");
    } catch (error) {
      setOperation({
        status: "error",
        message: error instanceof Error ? error.message : "Could not request playlist access.",
      });
    }
  };

  const syncSavedVideos = async () => {
    setOperation({ status: "working", message: "Syncing saved videos to Freed Offline" });
    try {
      const result = await syncSavedYouTubeVideos();
      setOperation({
        status: "success",
        message: `${result.addedCount.toLocaleString()} added, ${result.existingCount.toLocaleString()} already present. YouTube Premium manages the device download.`,
      });
    } catch (error) {
      setOperation({
        status: "error",
        message: error instanceof Error ? error.message : "Could not sync saved videos.",
      });
    }
  };

  const disconnect = () => {
    clearYouTubeAuth();
    setOperation({
      status: "success",
      message: "YouTube credentials were removed from this device. Freed Offline was left private in your YouTube account.",
    });
    setIntegration(getYouTubeIntegrationState());
  };

  return (
    <div
      className="space-y-5 py-2"
      data-testid="pwa-source-status-youtube"
      data-surface={surface}
    >
      <div className="flex items-start gap-3">
        <div className="text-red-500">
          <YoutubeIcon className="h-10 w-10" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-[var(--theme-text-primary)]">YouTube</p>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
              connected
                ? "theme-status-pill-success"
                : reconnectRequired
                  ? "theme-status-pill-warning"
                : "border border-[var(--theme-border-subtle)] text-[var(--theme-text-muted)]"
            }`}>
              {connected ? "Connected" : reconnectRequired ? "Reconnect needed" : "Not connected"}
            </span>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-[var(--theme-text-muted)]">
            Import the channels you follow without importing YouTube Home, Shorts, or recommendations.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <StatCard label="Followed channels" value={integration.subscriptionCount.toLocaleString()} />
        <StatCard label="Recent videos" value={integration.videoCount.toLocaleString()} />
        <StatCard label="Subscription sync" value={formatTimestamp(integration.lastSubscriptionSyncAt)} />
        <StatCard label="Saved YouTube videos" value={savedVideoUrls.length.toLocaleString()} />
      </div>

      {!token ? (
        <button
          type="button"
          onClick={() => void connect()}
          className="btn-primary rounded-lg px-4 py-2.5 text-sm font-semibold"
        >
          Connect YouTube
        </button>
      ) : reconnectRequired ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void reconnect()}
            disabled={operation.status === "working"}
            className="btn-primary rounded-lg px-4 py-2.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
          >
            Reconnect YouTube
          </button>
          <button
            type="button"
            onClick={disconnect}
            disabled={operation.status === "working"}
            className="btn-secondary rounded-lg px-4 py-2.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
          >
            Disconnect on this device
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void syncSubscriptions()}
            disabled={operation.status === "working"}
            className="btn-primary rounded-lg px-4 py-2.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
          >
            Sync followed videos
          </button>
          <button
            type="button"
            onClick={disconnect}
            disabled={operation.status === "working"}
            className="btn-secondary rounded-lg px-4 py-2.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
          >
            Disconnect on this device
          </button>
        </div>
      )}

      <section className="rounded-xl border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-muted)] p-4">
        <h3 className="text-sm font-semibold text-[var(--theme-text-primary)]">Freed Offline</h3>
        <p className="mt-1 text-xs leading-5 text-[var(--theme-text-muted)]">
          Freed creates one private playlist for saved videos. You can download the full playlist in YouTube with Premium. Freed never claims a video is downloaded because YouTube owns that device state.
        </p>
        <p className="mt-2 text-xs leading-5 text-[var(--theme-text-soft)]">
          Use the same Google account in the YouTube app that you connected here. Freed cannot switch the account selected inside YouTube.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {!playlistAccess ? (
            <button
              type="button"
              onClick={() => void enableOfflinePlaylist()}
              disabled={!connected || operation.status === "working"}
              className="btn-secondary rounded-lg px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
            >
              Enable Freed Offline
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void syncSavedVideos()}
              disabled={savedVideoUrls.length === 0 || operation.status === "working"}
              className="btn-secondary rounded-lg px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
            >
              Sync {savedVideoUrls.length.toLocaleString()} saved video{savedVideoUrls.length === 1 ? "" : "s"}
            </button>
          )}
          {integration.offlinePlaylistUrl && (
            <button
              type="button"
              onClick={() => openUrl?.(integration.offlinePlaylistUrl!)}
              className="btn-secondary rounded-lg px-3 py-2 text-sm font-semibold"
            >
              Open Freed Offline in YouTube
            </button>
          )}
        </div>
        {integration.lastOfflineSyncAt && (
          <p className="mt-3 text-xs text-[var(--theme-text-muted)]">
            Playlist synced {formatTimestamp(integration.lastOfflineSyncAt)}
          </p>
        )}
        <p className="mt-3 text-xs leading-5 text-[var(--theme-text-soft)]">
          Each new playlist write uses {(50).toLocaleString()} YouTube API quota units, plus {(1).toLocaleString()} for the membership check. Freed stops cleanly if Google exhausts the shared quota.
        </p>
      </section>

      {operation.status !== "idle" && (
        <p
          role={operation.status === "error" ? "alert" : "status"}
          className={operation.status === "error"
            ? "theme-feedback-text-danger text-sm"
            : "text-sm text-[var(--theme-text-secondary)]"}
        >
          {operation.message}
        </p>
      )}
    </div>
  );
}
