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

const CAPTURE_TIMEOUT_MS = 275_000;
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
  captureId?: string;
  stage?: string;
  channels?: YouTubeNativeChannel[];
  videos?: YouTubeNativeVideo[];
  rosterComplete?: boolean;
  complete?: boolean;
  done?: boolean;
  extractedAt?: number;
  candidateCount?: number;
  channelTotal?: number;
  videoTotal?: number;
  unresolvedCount?: number;
  scrollPasses?: number;
  stopReason?: string;
  pageEvidence?: boolean;
  explicitEmpty?: boolean;
  unsupportedCandidateCount?: number;
  pendingContinuation?: boolean;
  workBudgetExceeded?: boolean;
  deadlineExceeded?: boolean;
  error?: string;
}

interface YouTubeCaptureCommandResult {
  stages?: YouTubeCaptureEventPayload[];
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

function classifyYouTubeCaptureErrorStage(message: string, fallback: string): string {
  return /not signed in|session (?:is )?(?:expired|invalid)/i.test(message)
    ? "auth"
    : fallback;
}

interface YouTubeCaptureProgress {
  receivedAt: number;
  stage: string | null;
  channelCount: number;
  videoCount: number;
  candidateCount: number;
  unresolvedCount: number;
  scrollPasses: number;
}

interface YouTubeStageTerminal {
  authoritative: boolean;
  succeeded: boolean;
  stopReason: string | null;
  progress: YouTubeCaptureProgress;
}

function mergeDefined<T extends object>(current: T | undefined, incoming: T): T {
  if (!current) return incoming;
  return Object.fromEntries(
    Object.entries({ ...current, ...incoming }).filter(([, value]) => value !== undefined),
  ) as T;
}

function progressDiagnostic(progress: YouTubeCaptureProgress | null): string {
  if (!progress) return "No matching progress event was received.";
  const ageMs = Math.max(0, Date.now() - progress.receivedAt);
  return [
    `Last progress stage=${progress.stage ?? "unknown"}`,
    `channels=${progress.channelCount.toLocaleString()}`,
    `videos=${progress.videoCount.toLocaleString()}`,
    `candidates=${progress.candidateCount.toLocaleString()}`,
    `unresolved=${progress.unresolvedCount.toLocaleString()}`,
    `scrollPasses=${progress.scrollPasses.toLocaleString()}`,
    `ageMs=${ageMs.toLocaleString()}.`,
  ].join(" ");
}

function appendProgressDiagnostic(
  message: string,
  progress: YouTubeCaptureProgress | null,
): string {
  if (message.includes("Last progress stage=")
    || message.includes("No matching progress event was received.")) {
    return message;
  }
  return `${message} ${progressDiagnostic(progress)}`;
}

async function cancelYouTubeCapture(captureId: string): Promise<void> {
  try {
    await invoke("yt_hide_login", { captureId });
  } catch (error) {
    addDebugEvent(
      "error",
      `[YouTube] emergency capture cleanup failed: ${errorMessage(error)}`,
    );
  }
}

async function fetchYouTubeCaptureOnce(
  includeRoster: boolean = true,
): Promise<YouTubeSyncResult> {
  const result = emptyResult();
  const captureId = globalThis.crypto.randomUUID();
  const nativeChannelsById = new Map<string, YouTubeNativeChannel>();
  const nativeVideosById = new Map<string, YouTubeNativeVideo>();
  const stageTerminals = new Map<string, YouTubeStageTerminal>();
  const latestProgressByStage = new Map<string, YouTubeCaptureProgress>();
  const requiredFinalStages = includeRoster
    ? ["channels", "subscriptions"]
    : ["subscriptions"];
  let receivedMatchingData = false;
  let latestProgress: YouTubeCaptureProgress | null = null;
  let needsEmergencyCancellation = false;
  let unlisten: UnlistenFn | null = null;
  let timeout: number | null = null;

  const applyCapturePayload = (
    payload: YouTubeCaptureEventPayload,
    authoritative: boolean,
  ): void => {
    if (payload.captureId !== captureId) return;
    receivedMatchingData = true;
    if (payload.error) {
      result.diag.errorStage = classifyYouTubeCaptureErrorStage(
        payload.error,
        payload.stage ?? "extract",
      );
      result.diag.errorMessage = payload.error;
      return;
    }
    for (const channel of payload.channels ?? []) {
      if (!channel.channelId) continue;
      nativeChannelsById.set(
        channel.channelId,
        mergeDefined(nativeChannelsById.get(channel.channelId), channel),
      );
    }
    for (const video of payload.videos ?? []) {
      if (!video.videoId) continue;
      nativeVideosById.set(
        video.videoId,
        mergeDefined(nativeVideosById.get(video.videoId), video),
      );
    }
    result.diag.scrollPasses = Math.max(
      result.diag.scrollPasses,
      payload.scrollPasses ?? 0,
    );
    if (payload.stopReason) result.diag.stopReason = payload.stopReason;
    if (Number.isFinite(payload.extractedAt)) {
      result.capturedAt = Math.max(result.capturedAt, payload.extractedAt ?? result.capturedAt);
    }
    latestProgress = {
      receivedAt: Date.now(),
      stage: payload.stage ?? latestProgress?.stage ?? null,
      channelCount: nativeChannelsById.size,
      videoCount: nativeVideosById.size,
      candidateCount: payload.candidateCount ?? latestProgress?.candidateCount ?? 0,
      unresolvedCount: payload.unresolvedCount ?? latestProgress?.unresolvedCount ?? 0,
      scrollPasses: payload.scrollPasses ?? latestProgress?.scrollPasses ?? 0,
    };
    if (payload.stage) latestProgressByStage.set(payload.stage, latestProgress);
    if (payload.done === true && payload.stage) {
      const existing = stageTerminals.get(payload.stage);
      if (!existing?.authoritative || authoritative) {
        const receiptChannelIds = new Set(
          (payload.channels ?? []).map((channel) => channel.channelId).filter(Boolean),
        );
        const receiptVideoIds = new Set(
          (payload.videos ?? []).map((video) => video.videoId).filter(Boolean),
        );
        const recordTotalsMatch = !authoritative || (
          payload.channelTotal === (payload.channels?.length ?? 0)
          && payload.videoTotal === (payload.videos?.length ?? 0)
          && receiptChannelIds.size === (payload.channels?.length ?? 0)
          && receiptVideoIds.size === (payload.videos?.length ?? 0)
        );
        const primaryRecordCount = payload.stage === "channels"
          ? payload.channels?.length ?? 0
          : payload.videos?.length ?? 0;
        const evidenceComplete = payload.stopReason === "end-stable"
          && payload.unresolvedCount === 0
          && payload.pageEvidence === true
          && (primaryRecordCount > 0 || payload.explicitEmpty === true)
          && payload.unsupportedCandidateCount === 0
          && payload.pendingContinuation === false
          && payload.workBudgetExceeded === false
          && payload.deadlineExceeded === false;
        const succeeded = authoritative
          && recordTotalsMatch
          && evidenceComplete
          && (payload.stage === "channels"
            ? payload.rosterComplete === true
            : payload.stage === "subscriptions" && payload.complete === true);
        stageTerminals.set(payload.stage, {
          authoritative,
          succeeded,
          stopReason: payload.stopReason ?? null,
          progress: latestProgress,
        });
        if (authoritative && payload.stage === "channels") {
          result.diag.rosterComplete = succeeded;
        }
      }
    }
    addDebugEvent(
      "change",
      `[YouTube] extraction pass channels=${(payload.channels?.length ?? 0).toLocaleString()} videos=${(payload.videos?.length ?? 0).toLocaleString()} candidates=${(payload.candidateCount ?? 0).toLocaleString()}${payload.done ? " final" : ""}`,
    );
  };

  try {
    unlisten = await listen<YouTubeCaptureEventPayload>("yt-capture-data", (event) => {
      applyCapturePayload(event.payload, false);
    });

    const commandResult = await Promise.race([
      invoke<YouTubeCaptureCommandResult>("yt_capture", { includeRoster, captureId }),
      new Promise<never>((_resolve, reject) => {
        timeout = window.setTimeout(
          () => reject(new Error(`YouTube capture timed out. ${progressDiagnostic(latestProgress)}`)),
          CAPTURE_TIMEOUT_MS,
        );
      }),
    ]);
    for (const payload of commandResult?.stages ?? []) {
      applyCapturePayload(payload, true);
    }
    if (!result.diag.errorStage) {
      if (!receivedMatchingData) {
        result.diag.errorStage = "extract";
        result.diag.errorMessage = "YouTube returned no capture data.";
      } else {
        const missingFinalStages = requiredFinalStages.filter(
          (stage) => stageTerminals.get(stage)?.authoritative !== true,
        );
        if (missingFinalStages.length > 0) {
          result.diag.errorStage = "extract";
          result.diag.errorMessage = `YouTube capture ended without final markers for ${missingFinalStages.join(", ")}. ${progressDiagnostic(latestProgress)}`;
        } else {
          const incompleteStages = requiredFinalStages.filter(
            (stage) => stageTerminals.get(stage)?.succeeded !== true,
          );
          if (incompleteStages.length > 0) {
            const terminalDetails = incompleteStages.map((stage) => {
              const terminal = stageTerminals.get(stage);
              return `${stage} stopReason=${terminal?.stopReason ?? "unknown"}`;
            }).join(", ");
            const terminalProgress = stageTerminals.get(incompleteStages.at(-1) ?? "")?.progress
              ?? latestProgress;
            result.diag.errorStage = "extract";
            result.diag.errorMessage = `YouTube capture ended incomplete for ${terminalDetails}. ${progressDiagnostic(terminalProgress)}`;
          }
        }
      }
    }
    needsEmergencyCancellation = result.diag.errorStage !== null;
  } catch (error) {
    const message = result.diag.errorMessage ?? errorMessage(error);
    result.diag.errorStage = result.diag.errorStage
      ?? classifyYouTubeCaptureErrorStage(message, "invoke");
    result.diag.errorMessage = appendProgressDiagnostic(
      message,
      latestProgress,
    );
    needsEmergencyCancellation = true;
  } finally {
    if (timeout !== null) window.clearTimeout(timeout);
    safeUnlisten(unlisten, "yt-capture-data");
    if (needsEmergencyCancellation) await cancelYouTubeCapture(captureId);
  }

  const rosterProgress = latestProgressByStage.get("channels");
  const subscriptionsProgress = latestProgressByStage.get("subscriptions");
  result.diag.unresolvedCount = includeRoster
    ? rosterProgress?.unresolvedCount ?? 0
    : subscriptionsProgress?.unresolvedCount ?? 0;

  const nativeChannels = Array.from(nativeChannelsById.values());
  const nativeVideos = Array.from(nativeVideosById.values());
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
