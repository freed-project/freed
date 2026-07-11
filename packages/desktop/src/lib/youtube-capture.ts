import type {
  YouTubeCapturedChannel,
  YouTubeCapturedVideo,
} from "@freed/capture-youtube/browser";
import {
  youtubeCapturedChannelsToAccounts,
  youtubeCapturedVideosToFeedItems,
} from "@freed/capture-youtube/browser";
import type { Account, FeedItem } from "@freed/shared";
import { addDebugEvent } from "@freed/ui/lib/debug-store";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { docReconcileYouTubeCapture } from "./automerge";
import { safeUnlisten } from "./safe-unlisten";
import { storeYouTubeAuthState } from "./youtube-auth";
import { clearYouTubePlaylistState } from "./youtube-playlist";
import { useAppStore } from "./store";
import { recordProviderHealthEvent } from "./provider-health";
import {
  recordRuntimeHealthEvent,
  recordScrapeOutcome,
  type SocialScrapeTrigger,
} from "./runtime-health-events";

const CAPTURE_TIMEOUT_MS = 120_000;
let captureOperationChain: Promise<void> = Promise.resolve();

function enqueueCaptureOperation<T>(operation: () => Promise<T>): Promise<T> {
  const next = captureOperationChain.then(operation, operation);
  captureOperationChain = next.then(() => undefined, () => undefined);
  return next;
}

interface YouTubeNativeChannel extends Partial<YouTubeCapturedChannel> {
  channelId: string;
  title?: string;
  channelUrl?: string;
  thumbnailUrl?: string;
}

interface YouTubeNativeVideo extends Partial<YouTubeCapturedVideo> {
  videoId: string;
  title: string;
  watchUrl?: string;
  channelUrl?: string;
  publishedText?: string;
  durationText?: string;
  isShort?: boolean;
  isLive?: boolean;
  isUpcoming?: boolean;
}

export interface YouTubeCaptureEventPayload {
  stage?: string;
  channels?: YouTubeNativeChannel[];
  videos?: YouTubeNativeVideo[];
  rosterComplete?: boolean;
  complete?: boolean;
  done?: boolean;
  extractedAt?: number;
  candidateCount?: number;
  unresolvedCount?: number;
  scrollPasses?: number;
  stopReason?: string;
  error?: string;
}

export interface YouTubeSyncDiag {
  channelsExtracted: number;
  videosExtracted: number;
  shortsSkipped: number;
  accountsNormalized: number;
  itemsNormalized: number;
  accountsAdded: number;
  itemsAdded: number;
  rosterComplete: boolean;
  unresolvedCount: number;
  scrollPasses: number;
  stopReason: string | null;
  errorStage: string | null;
  errorMessage: string | null;
}

export interface YouTubeSyncResult {
  accounts: Account[];
  items: FeedItem[];
  capturedAt: number;
  diag: YouTubeSyncDiag;
}

function emptyResult(capturedAt = Date.now()): YouTubeSyncResult {
  return {
    capturedAt,
    accounts: [],
    items: [],
    diag: {
      channelsExtracted: 0,
      videosExtracted: 0,
      shortsSkipped: 0,
      accountsNormalized: 0,
      itemsNormalized: 0,
      accountsAdded: 0,
      itemsAdded: 0,
      rosterComplete: false,
      unresolvedCount: 0,
      scrollPasses: 0,
      stopReason: null,
      errorStage: null,
      errorMessage: null,
    },
  };
}

function normalizeNativeChannels(
  channels: readonly YouTubeNativeChannel[],
): YouTubeCapturedChannel[] {
  return channels.map((channel) => ({
    channelId: channel.channelId,
    displayName: channel.displayName ?? channel.title ?? channel.handle ?? channel.channelId,
    ...(channel.handle ? { handle: channel.handle } : {}),
    ...(channel.description ? { description: channel.description } : {}),
    ...(channel.avatarUrl ?? channel.thumbnailUrl
      ? { avatarUrl: channel.avatarUrl ?? channel.thumbnailUrl }
      : {}),
    ...(channel.profileUrl ?? channel.channelUrl
      ? { profileUrl: channel.profileUrl ?? channel.channelUrl }
      : {}),
  }));
}

function normalizeNativeVideos(
  videos: readonly YouTubeNativeVideo[],
  channels: readonly YouTubeCapturedChannel[],
  capturedAt: number,
): YouTubeCapturedVideo[] {
  const channelByUrl = new Map(
    channels.flatMap((channel) =>
      channel.profileUrl ? [[channel.profileUrl, channel] as const] : [],
    ),
  );
  const channelByTitle = new Map(channels.map((channel) => [channel.displayName, channel]));

  return videos.flatMap((video, index) => {
    const channel =
      (video.channelUrl ? channelByUrl.get(video.channelUrl) : undefined) ??
      (video.channelTitle ? channelByTitle.get(video.channelTitle) : undefined);
    const channelId = video.channelId ?? channel?.channelId;
    const channelTitle = video.channelTitle ?? channel?.displayName;
    if (!channelId || !channelTitle) return [];
    return [{
      videoId: video.videoId,
      channelId,
      channelTitle,
      ...(video.channelHandle ?? channel?.handle
        ? { channelHandle: video.channelHandle ?? channel?.handle }
        : {}),
      ...(video.channelAvatarUrl ?? channel?.avatarUrl
        ? { channelAvatarUrl: video.channelAvatarUrl ?? channel?.avatarUrl }
        : {}),
      title: video.title,
      ...(video.description ? { description: video.description } : {}),
      publishedAt: video.publishedAt ?? Math.max(1, capturedAt - index),
      ...(video.thumbnailUrl ? { thumbnailUrl: video.thumbnailUrl } : {}),
      ...(video.sourceUrl ?? video.watchUrl
        ? { sourceUrl: video.sourceUrl ?? video.watchUrl }
        : {}),
    }];
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function fetchYouTubeCaptureOnce(
  includeRoster: boolean = true,
): Promise<YouTubeSyncResult> {
  const result = emptyResult();
  const nativeChannels: YouTubeNativeChannel[] = [];
  const nativeVideos: YouTubeNativeVideo[] = [];
  let receivedEvent = false;
  let unlisten: UnlistenFn | null = null;
  let timeout: number | null = null;

  try {
    unlisten = await listen<YouTubeCaptureEventPayload>("yt-capture-data", (event) => {
      receivedEvent = true;
      const payload = event.payload;
      if (payload.error) {
        result.diag.errorStage = /not signed in|session (?:is )?(?:expired|invalid)/i.test(payload.error)
          ? "auth"
          : payload.stage ?? "extract";
        result.diag.errorMessage = payload.error;
        return;
      }
      nativeChannels.push(...(payload.channels ?? []));
      nativeVideos.push(...(payload.videos ?? []));
      result.diag.rosterComplete ||=
        payload.rosterComplete === true ||
        (payload.rosterComplete === undefined && payload.complete === true);
      result.diag.unresolvedCount = Math.max(
        result.diag.unresolvedCount,
        payload.unresolvedCount ?? 0,
      );
      result.diag.scrollPasses = Math.max(
        result.diag.scrollPasses,
        payload.scrollPasses ?? 0,
      );
      if (payload.stopReason) result.diag.stopReason = payload.stopReason;
      if (Number.isFinite(payload.extractedAt)) {
        result.capturedAt = Math.max(result.capturedAt, payload.extractedAt ?? result.capturedAt);
      }
      addDebugEvent(
        "change",
        `[YouTube] extraction pass channels=${(payload.channels?.length ?? 0).toLocaleString()} videos=${(payload.videos?.length ?? 0).toLocaleString()} candidates=${(payload.candidateCount ?? 0).toLocaleString()}${payload.done ? " final" : ""}`,
      );
    });

    await Promise.race([
      invoke("yt_capture", { includeRoster }),
      new Promise<never>((_resolve, reject) => {
        timeout = window.setTimeout(
          () => reject(new Error("YouTube capture timed out.")),
          CAPTURE_TIMEOUT_MS,
        );
      }),
    ]);
    await new Promise<void>((resolve) => window.setTimeout(resolve, 250));
  } catch (error) {
    result.diag.errorStage = result.diag.errorStage ?? "invoke";
    result.diag.errorMessage = result.diag.errorMessage ?? errorMessage(error);
  } finally {
    if (timeout !== null) window.clearTimeout(timeout);
    safeUnlisten(unlisten, "yt-capture-data");
  }

  if (!receivedEvent && !result.diag.errorStage) {
    result.diag.errorStage = "extract";
    result.diag.errorMessage = "YouTube returned no capture data.";
  }

  const channels = normalizeNativeChannels(nativeChannels);
  const eligibleVideos = nativeVideos.filter((video) => video.isShort !== true);
  const videos = normalizeNativeVideos(eligibleVideos, channels, result.capturedAt);
  result.diag.channelsExtracted = nativeChannels.length;
  result.diag.videosExtracted = eligibleVideos.length;
  result.diag.shortsSkipped = nativeVideos.length - eligibleVideos.length;
  result.accounts = youtubeCapturedChannelsToAccounts(channels, result.capturedAt);
  result.items = youtubeCapturedVideosToFeedItems(videos, result.capturedAt);
  result.diag.accountsNormalized = result.accounts.length;
  result.diag.itemsNormalized = result.items.length;
  return result;
}

/** Read one serialized authenticated YouTube capture from the native WebView. */
export function fetchYouTubeCapture(
  includeRoster: boolean = true,
): Promise<YouTubeSyncResult> {
  return enqueueCaptureOperation(() => fetchYouTubeCaptureOnce(includeRoster));
}

/** Persist one authenticated YouTube roster and subscriptions-page refresh. */
export async function captureYouTube(
  trigger: SocialScrapeTrigger = "manual",
): Promise<YouTubeSyncResult> {
  const startedAt = Date.now();
  const store = useAppStore.getState();
  const result = await fetchYouTubeCapture(trigger !== "scheduled");

  if (result.diag.errorStage) {
    const authLost = result.diag.errorStage === "auth";
    const auth = {
      ...useAppStore.getState().ytAuth,
      ...(authLost ? { isAuthenticated: false, lastCheckedAt: Date.now() } : {}),
      lastCaptureError: result.diag.errorMessage ?? result.diag.errorStage,
    };
    store.setYtAuth(auth);
    storeYouTubeAuthState(auth);
    if (authLost) clearYouTubePlaylistState();
    addDebugEvent("error", `[YouTube] ${auth.lastCaptureError}`);
    const finishedAt = Date.now();
    await recordProviderHealthEvent({
      provider: "youtube",
      outcome: "error",
      stage: result.diag.errorStage,
      reason: result.diag.errorMessage ?? undefined,
      startedAt,
      finishedAt,
      itemsSeen: result.diag.videosExtracted,
      itemsAdded: 0,
    });
    recordScrapeOutcome({
      provider: "youtube",
      trigger,
      itemsExtracted: result.diag.videosExtracted,
      itemsPersisted: 0,
      stage: result.diag.errorStage,
      durationMs: finishedAt - startedAt,
    });
    recordRuntimeHealthEvent({
      event: "youtube_roster_outcome",
      trigger,
      result: "error",
      resolvedCount: result.diag.accountsNormalized,
      unresolvedCount: result.diag.unresolvedCount,
      complete: result.diag.rosterComplete,
      scrollPasses: result.diag.scrollPasses,
      stage: result.diag.errorStage,
      durationMs: finishedAt - startedAt,
    });
    return result;
  }

  const before = useAppStore.getState();
  const existingAccountIds = new Set(Object.keys(before.accounts));
  const existingItemIds = new Set(before.items.map((item) => item.globalId));
  result.diag.accountsAdded = result.accounts.filter(
    (account) => !existingAccountIds.has(account.id),
  ).length;
  result.diag.itemsAdded = result.items.filter(
    (item) => !existingItemIds.has(item.globalId),
  ).length;

  await docReconcileYouTubeCapture(result.accounts, result.items, {
    rosterComplete: result.diag.rosterComplete,
    capturedAt: result.capturedAt,
  });

  const auth = {
    ...useAppStore.getState().ytAuth,
    isAuthenticated: true,
    lastCheckedAt: Date.now(),
    lastCapturedAt: Date.now(),
    lastCaptureError: undefined,
  };
  store.setYtAuth(auth);
  storeYouTubeAuthState(auth);
  addDebugEvent(
    "change",
    `[YouTube] synced channels=${result.diag.channelsExtracted.toLocaleString()} videos=${result.diag.videosExtracted.toLocaleString()} added=${result.diag.itemsAdded.toLocaleString()}`,
  );
  const finishedAt = Date.now();
  const outcome = result.diag.videosExtracted > 0 || result.diag.channelsExtracted > 0
    ? "success"
    : "empty";
  await recordProviderHealthEvent({
    provider: "youtube",
    outcome,
    stage: outcome === "empty" ? "empty" : "extract",
    reason: result.diag.stopReason ?? undefined,
    startedAt,
    finishedAt,
    itemsSeen: result.diag.videosExtracted,
    itemsAdded: result.diag.itemsAdded,
  });
  recordScrapeOutcome({
    provider: "youtube",
    trigger,
    itemsExtracted: result.diag.videosExtracted,
    itemsPersisted: result.items.length,
    stage: outcome,
    durationMs: finishedAt - startedAt,
  });
  recordRuntimeHealthEvent({
    event: "youtube_roster_outcome",
    trigger,
    result: outcome,
    resolvedCount: result.diag.accountsNormalized,
    unresolvedCount: result.diag.unresolvedCount,
    complete: result.diag.rosterComplete,
    scrollPasses: result.diag.scrollPasses,
    stage: result.diag.stopReason ?? "complete",
    durationMs: finishedAt - startedAt,
  });
  return result;
}
