import type { Account, FeedItem } from "@freed/shared";
import {
  YOUTUBE_CHANNEL_BASE_URL,
  YOUTUBE_WATCH_BASE_URL,
} from "./constants.js";
import type { YouTubeCapturedChannel, YouTubeCapturedVideo } from "./types.js";

const YOUTUBE_CHANNEL_ID_PATTERN = /^UC[A-Za-z0-9_-]{22}$/;
const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function youtubeChannelUrl(channelId: string): string {
  return `${YOUTUBE_CHANNEL_BASE_URL}/${encodeURIComponent(channelId)}`;
}

function youtubeWatchUrl(videoId: string): string {
  const url = new URL(YOUTUBE_WATCH_BASE_URL);
  url.searchParams.set("v", videoId);
  return url.toString();
}

function publishedAt(value: number | string | undefined, capturedAt: number): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return capturedAt;
}

/** Convert an authenticated website roster into orphan social accounts. */
export function youtubeCapturedChannelsToAccounts(
  channels: readonly YouTubeCapturedChannel[],
  capturedAt: number,
): Account[] {
  const accounts = new Map<string, Account>();
  for (const channel of channels) {
    const channelId = nonEmpty(channel.channelId);
    const displayName = nonEmpty(channel.displayName);
    if (
      !channelId ||
      !YOUTUBE_CHANNEL_ID_PATTERN.test(channelId) ||
      !displayName ||
      accounts.has(channelId)
    ) continue;

    accounts.set(channelId, {
      id: `social:youtube:${channelId}`,
      kind: "social",
      provider: "youtube",
      externalId: channelId,
      ...(nonEmpty(channel.handle) ? { handle: nonEmpty(channel.handle) } : {}),
      displayName,
      ...(nonEmpty(channel.avatarUrl) ? { avatarUrl: nonEmpty(channel.avatarUrl) } : {}),
      profileUrl: nonEmpty(channel.profileUrl) ?? youtubeChannelUrl(channelId),
      firstSeenAt: capturedAt,
      lastSeenAt: capturedAt,
      discoveredFrom: "follow_roster",
      followRosterActive: true,
      followRosterSyncedAt: capturedAt,
      createdAt: capturedAt,
      updatedAt: capturedAt,
    });
  }
  return Array.from(accounts.values());
}

/** Convert captured website videos into stable Freed feed items. */
export function youtubeCapturedVideosToFeedItems(
  videos: readonly YouTubeCapturedVideo[],
  capturedAt: number,
): FeedItem[] {
  const items = new Map<string, FeedItem>();
  for (const video of videos) {
    const videoId = nonEmpty(video.videoId);
    const channelId = nonEmpty(video.channelId);
    const channelTitle = nonEmpty(video.channelTitle);
    const title = nonEmpty(video.title);
    if (
      !videoId ||
      !YOUTUBE_VIDEO_ID_PATTERN.test(videoId) ||
      !channelId ||
      !YOUTUBE_CHANNEL_ID_PATTERN.test(channelId) ||
      !channelTitle ||
      !title ||
      items.has(videoId)
    ) continue;

    const watchUrl = youtubeWatchUrl(videoId);
    const thumbnailUrl = nonEmpty(video.thumbnailUrl);
    const description = nonEmpty(video.description);
    items.set(videoId, {
      globalId: `youtube:yt:video:${videoId}`,
      platform: "youtube",
      contentType: "video",
      capturedAt,
      publishedAt: publishedAt(video.publishedAt, capturedAt),
      author: {
        id: channelId,
        handle: nonEmpty(video.channelHandle) ?? channelId,
        displayName: channelTitle,
        ...(nonEmpty(video.channelAvatarUrl)
          ? { avatarUrl: nonEmpty(video.channelAvatarUrl) }
          : {}),
      },
      content: {
        ...(description ? { text: description } : {}),
        mediaUrls: thumbnailUrl ? [thumbnailUrl] : [],
        mediaTypes: thumbnailUrl ? ["image"] : [],
        linkPreview: {
          url: watchUrl,
          title,
        },
      },
      sourceUrl: watchUrl,
      userState: {
        hidden: false,
        saved: false,
        archived: false,
        tags: [],
      },
      topics: [],
    });
  }
  return Array.from(items.values());
}
