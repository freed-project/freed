import {
  createYouTubeDataApiClient,
  subscriptionsToRssFeeds,
  uploadsToFeedItems,
  YouTubeApiError,
} from "@freed/capture-youtube";
import type { YouTubeDataApiClient, YouTubeUpload } from "@freed/capture-youtube";
import { parseYouTubeVideoUrl } from "@freed/shared";

import {
  docAddFeedItems,
  docReconcileYouTubeSubscriptions,
  getSavedYouTubeVideoUrls,
} from "./automerge";
import {
  fetchYouTubeWithAuth,
  getStoredYouTubeToken,
  getValidYouTubeAccessToken,
  hasYouTubePlaylistAccess,
  initiateYouTubeOAuth,
} from "./youtube-auth";

const YOUTUBE_INTEGRATION_STORAGE_KEY = "freed_youtube_integration_v1";
const YOUTUBE_INTEGRATION_EVENT = "freed:youtube-integration";
const INITIAL_UPLOADS_PER_CHANNEL = 5;
const CHANNEL_LOOKUP_BATCH_SIZE = 50;
const OFFLINE_PLAYLIST_LOCK_NAME = "freed-youtube-offline-playlist";
let localOfflinePlaylistQueue: Promise<void> = Promise.resolve();

export interface YouTubeIntegrationState {
  subscriptionCount: number;
  videoCount: number;
  lastSubscriptionSyncAt?: number;
  offlinePlaylistId?: string;
  offlinePlaylistUrl?: string;
  lastOfflineSyncAt?: number;
  offlinePlaylistItemCount: number;
}

export interface YouTubeSubscriptionSyncResult {
  subscriptionCount: number;
  videoCount: number;
  hydratedChannelCount: number;
  skippedChannelCount: number;
  recentVideosComplete: boolean;
}

export interface YouTubeSavedVideoSyncResult {
  playlistId: string;
  playlistUrl: string;
  addedCount: number;
  existingCount: number;
}

const EMPTY_STATE: YouTubeIntegrationState = {
  subscriptionCount: 0,
  videoCount: 0,
  offlinePlaylistItemCount: 0,
};

/** Read non-secret, device-local YouTube integration metadata. */
export function getYouTubeIntegrationState(): YouTubeIntegrationState {
  const raw = localStorage.getItem(YOUTUBE_INTEGRATION_STORAGE_KEY);
  if (!raw) return { ...EMPTY_STATE };

  try {
    const parsed = JSON.parse(raw) as Partial<YouTubeIntegrationState>;
    return {
      subscriptionCount: finiteNonNegative(parsed.subscriptionCount),
      videoCount: finiteNonNegative(parsed.videoCount),
      offlinePlaylistItemCount: finiteNonNegative(parsed.offlinePlaylistItemCount),
      ...(finiteTimestamp(parsed.lastSubscriptionSyncAt) !== undefined
        ? { lastSubscriptionSyncAt: finiteTimestamp(parsed.lastSubscriptionSyncAt) }
        : {}),
      ...(typeof parsed.offlinePlaylistId === "string" && parsed.offlinePlaylistId
        ? { offlinePlaylistId: parsed.offlinePlaylistId }
        : {}),
      ...(typeof parsed.offlinePlaylistUrl === "string" && parsed.offlinePlaylistUrl
        ? { offlinePlaylistUrl: parsed.offlinePlaylistUrl }
        : {}),
      ...(finiteTimestamp(parsed.lastOfflineSyncAt) !== undefined
        ? { lastOfflineSyncAt: finiteTimestamp(parsed.lastOfflineSyncAt) }
        : {}),
    };
  } catch {
    localStorage.removeItem(YOUTUBE_INTEGRATION_STORAGE_KEY);
    return { ...EMPTY_STATE };
  }
}

export function subscribeYouTubeIntegrationState(
  listener: (state: YouTubeIntegrationState) => void,
): () => void {
  const handleStateChange = () => listener(getYouTubeIntegrationState());
  window.addEventListener(YOUTUBE_INTEGRATION_EVENT, handleStateChange);
  return () => window.removeEventListener(YOUTUBE_INTEGRATION_EVENT, handleStateChange);
}

/** Clear account-specific playlist and sync metadata before storing a new grant. */
export function resetYouTubeIntegrationForNewGrant(): void {
  localStorage.removeItem(YOUTUBE_INTEGRATION_STORAGE_KEY);
  window.dispatchEvent(new Event(YOUTUBE_INTEGRATION_EVENT));
}

/** Import the complete followed-channel roster and a bounded recent window per channel. */
export async function syncYouTubeSubscriptions(): Promise<YouTubeSubscriptionSyncResult> {
  try {
    return await syncYouTubeSubscriptionsInternal();
  } catch (error) {
    throw friendlyYouTubeError(error);
  }
}

async function syncYouTubeSubscriptionsInternal(): Promise<YouTubeSubscriptionSyncResult> {
  const client = await createAuthenticatedClient();
  const subscriptions = await client.listSubscriptions();
  const rosterSyncedAt = Date.now();
  const feeds = subscriptionsToRssFeeds(subscriptions).map((feed) => ({
    ...feed,
    youtubeRosterSyncedAt: rosterSyncedAt,
  }));

  // The authenticated roster is the durable result. Recent videos are
  // optional enrichment and must never prevent this change from landing.
  await docReconcileYouTubeSubscriptions(feeds, []);
  writeIntegrationState({
    ...getYouTubeIntegrationState(),
    subscriptionCount: subscriptions.length,
    videoCount: 0,
    lastSubscriptionSyncAt: rosterSyncedAt,
  });

  const uploads: YouTubeUpload[] = [];
  let hydratedChannelCount = 0;
  let stopHydration = false;

  for (const subscriptionBatch of chunks(subscriptions, CHANNEL_LOOKUP_BATCH_SIZE)) {
    let uploadPlaylists;
    try {
      uploadPlaylists = await client.getChannelUploadPlaylists(
        subscriptionBatch.map((subscription) => subscription.channelId),
      );
    } catch (error) {
      if (shouldStopVideoHydration(error)) stopHydration = true;
      if (stopHydration) break;
      continue;
    }

    const playlistByChannelId = new Map(
      uploadPlaylists.map((channel) => [channel.channelId, channel.uploadsPlaylistId]),
    );
    for (const subscription of subscriptionBatch) {
      const playlistId = playlistByChannelId.get(subscription.channelId);
      if (!playlistId) continue;

      const result = await hydrateRecentUploads(client, playlistId);
      if (result.uploads) {
        uploads.push(...result.uploads);
        hydratedChannelCount += 1;
        continue;
      }
      if (shouldStopVideoHydration(result.error)) {
        stopHydration = true;
        break;
      }
    }
    if (stopHydration) break;
  }

  const items = uploadsToFeedItems(uploads);
  if (items.length > 0) await docAddFeedItems(items);

  const result = {
    subscriptionCount: subscriptions.length,
    videoCount: items.length,
    hydratedChannelCount,
    skippedChannelCount: subscriptions.length - hydratedChannelCount,
    recentVideosComplete: hydratedChannelCount === subscriptions.length,
  };
  writeIntegrationState({
    ...getYouTubeIntegrationState(),
    ...result,
    lastSubscriptionSyncAt: rosterSyncedAt,
  });
  return result;
}

async function hydrateRecentUploads(
  client: YouTubeDataApiClient,
  playlistId: string,
): Promise<{ uploads: YouTubeUpload[]; error?: never } | { uploads?: never; error: unknown }> {
  try {
    return {
      uploads: await client.listRecentUploads([playlistId], {
        maxPerPlaylist: INITIAL_UPLOADS_PER_CHANNEL,
        includeDurations: false,
      }),
    };
  } catch (error) {
    return { error };
  }
}

function shouldStopVideoHydration(error: unknown): boolean {
  if (!(error instanceof YouTubeApiError)) return false;
  return (
    error.status === 401 ||
    error.status === 429 ||
    error.reason === "quotaExceeded" ||
    error.reason === "dailyLimitExceeded" ||
    error.reason === "rateLimitExceeded" ||
    error.reason === "userRateLimitExceeded"
  );
}

function chunks<T>(values: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

/** Add one explicit video selection to the private Freed Offline playlist. */
export async function addYouTubeVideoToOfflinePlaylist(videoUrl: string): Promise<{
  playlistId: string;
  playlistUrl: string;
  added: boolean;
}> {
  try {
    return await addYouTubeVideoToOfflinePlaylistInternal(videoUrl);
  } catch (error) {
    throw friendlyYouTubeError(error);
  }
}

async function addYouTubeVideoToOfflinePlaylistInternal(videoUrl: string): Promise<{
  playlistId: string;
  playlistUrl: string;
  added: boolean;
}> {
  await ensurePlaylistAuthorization();
  const reference = parseYouTubeVideoUrl(videoUrl);
  if (!reference) throw new Error("This is not a supported YouTube video URL.");

  return withOfflinePlaylistLock(async () => {
    const client = await createAuthenticatedClient();
    const previous = getYouTubeIntegrationState();
    const result = await client.addVideoToOfflinePlaylist(
      reference.videoId,
      previous.offlinePlaylistId,
    );
    const playlistUrl = buildYouTubePlaylistUrl(result.playlistId);
    writeIntegrationState({
      ...previous,
      offlinePlaylistId: result.playlistId,
      offlinePlaylistUrl: playlistUrl,
      lastOfflineSyncAt: Date.now(),
      offlinePlaylistItemCount:
        previous.offlinePlaylistItemCount + (result.added ? 1 : 0),
    });
    return { playlistId: result.playlistId, playlistUrl, added: result.added };
  });
}

/** Reconcile every locally saved YouTube video into the private playlist. */
export async function syncSavedYouTubeVideos(
  videoUrls?: readonly string[],
): Promise<YouTubeSavedVideoSyncResult> {
  try {
    return await syncSavedYouTubeVideosInternal(
      videoUrls ?? await getSavedYouTubeVideoUrls(),
    );
  } catch (error) {
    throw friendlyYouTubeError(error);
  }
}

async function syncSavedYouTubeVideosInternal(
  videoUrls: readonly string[],
): Promise<YouTubeSavedVideoSyncResult> {
  await ensurePlaylistAuthorization();
  const videoIds = Array.from(new Set(
    videoUrls
      .map((url) => parseYouTubeVideoUrl(url)?.videoId)
      .filter((videoId): videoId is string => typeof videoId === "string"),
  ));
  if (videoIds.length === 0) {
    throw new Error("Save a YouTube video in Freed before syncing this playlist.");
  }

  return withOfflinePlaylistLock(async () => {
    const client = await createAuthenticatedClient();
    const previous = getYouTubeIntegrationState();
    const playlist = await client.findOrCreateOfflinePlaylist(previous.offlinePlaylistId);
    const playlistUrl = buildYouTubePlaylistUrl(playlist.id);
    writeIntegrationState({
      ...previous,
      offlinePlaylistId: playlist.id,
      offlinePlaylistUrl: playlistUrl,
    });

    let addedCount = 0;
    let existingCount = 0;
    for (const videoId of videoIds) {
      const result = await client.addVideoToPlaylist(playlist.id, videoId);
      if (result.added) addedCount += 1;
      else existingCount += 1;
    }

    writeIntegrationState({
      ...getYouTubeIntegrationState(),
      offlinePlaylistId: playlist.id,
      offlinePlaylistUrl: playlistUrl,
      lastOfflineSyncAt: Date.now(),
      offlinePlaylistItemCount: videoIds.length,
    });

    return {
      playlistId: playlist.id,
      playlistUrl,
      addedCount,
      existingCount,
    };
  });
}

async function withOfflinePlaylistLock<T>(operation: () => Promise<T>): Promise<T> {
  const lockManager = typeof navigator === "undefined"
    ? undefined
    : (navigator as Navigator & {
        locks?: { request: <Value>(name: string, callback: () => Promise<Value>) => Promise<Value> };
      }).locks;
  if (lockManager) {
    return lockManager.request(OFFLINE_PLAYLIST_LOCK_NAME, operation);
  }

  const run = localOfflinePlaylistQueue.then(operation, operation);
  localOfflinePlaylistQueue = run.then(() => undefined, () => undefined);
  return run;
}

function writeIntegrationState(state: YouTubeIntegrationState): void {
  localStorage.setItem(YOUTUBE_INTEGRATION_STORAGE_KEY, JSON.stringify(state));
  window.dispatchEvent(new Event(YOUTUBE_INTEGRATION_EVENT));
}

async function createAuthenticatedClient() {
  const accessToken = await getValidYouTubeAccessToken();
  if (!accessToken) {
    throw new Error("Connect YouTube on this device first.");
  }
  return createYouTubeDataApiClient({
    accessToken,
    fetch: fetchYouTubeWithAuth,
  });
}

async function ensurePlaylistAuthorization(): Promise<void> {
  const token = getStoredYouTubeToken();
  if (token && hasYouTubePlaylistAccess(token)) return;

  await initiateYouTubeOAuth("playlist");
  throw new Error("Finish the YouTube playlist authorization, then try again.");
}

function buildYouTubePlaylistUrl(playlistId: string): string {
  const url = new URL("https://www.youtube.com/playlist");
  url.searchParams.set("list", playlistId);
  return url.toString();
}

function finiteNonNegative(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function finiteTimestamp(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function friendlyYouTubeError(error: unknown): Error {
  if (!(error instanceof YouTubeApiError)) {
    return error instanceof Error ? error : new Error("YouTube could not complete this request.");
  }
  if (error.reason === "quotaExceeded" || error.reason === "dailyLimitExceeded") {
    return new Error("YouTube API quota is exhausted for now. Freed kept local saves and any subscription roster already stored. Try the explicit sync again later.");
  }
  if (error.reason === "playlistContainsMaximumNumberOfVideos") {
    return new Error("Freed Offline has reached YouTube's playlist video limit. Remove videos from that playlist in YouTube, then try the sync again.");
  }
  if (error.status === 401) {
    return new Error("YouTube authorization expired. Reconnect YouTube in Settings and try again.");
  }
  if (
    error.reason === "insufficientPermissions" ||
    error.reason === "forbidden" ||
    error.status === 403
  ) {
    return new Error("YouTube did not grant the access needed for this action. Reconnect YouTube and approve the requested access.");
  }
  if (error.status === 404) {
    return new Error("YouTube could not find this video or playlist. It may be private, removed, or unavailable in your region.");
  }
  return new Error(error.message || "YouTube could not complete this request.");
}
