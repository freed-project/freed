import type { FeedItem, RssFeed } from "@freed/shared";
import {
  YOUTUBE_CHANNEL_BASE_URL,
  YOUTUBE_CHANNEL_RSS_BASE_URL,
  YOUTUBE_WATCH_BASE_URL,
} from "./constants.js";
import type { YouTubeSubscription, YouTubeUpload } from "./types.js";

export function youtubeChannelRssUrl(channelId: string): string {
  const url = new URL(YOUTUBE_CHANNEL_RSS_BASE_URL);
  url.searchParams.set("channel_id", channelId);
  return url.toString();
}

export function youtubeChannelUrl(channelId: string): string {
  return `${YOUTUBE_CHANNEL_BASE_URL}/${encodeURIComponent(channelId)}`;
}

export function youtubeWatchUrl(videoId: string): string {
  const url = new URL(YOUTUBE_WATCH_BASE_URL);
  url.searchParams.set("v", videoId);
  return url.toString();
}

export function parseYouTubeDurationSeconds(
  duration: string
): number | undefined {
  const match = duration.match(
    /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/
  );
  if (!match) return undefined;
  const days = Number(match[1] ?? 0);
  const hours = Number(match[2] ?? 0);
  const minutes = Number(match[3] ?? 0);
  const seconds = Number(match[4] ?? 0);
  if (![days, hours, minutes, seconds].every(Number.isFinite)) return undefined;
  return Math.round(days * 86_400 + hours * 3_600 + minutes * 60 + seconds);
}

export function formatYouTubeDuration(
  durationSeconds: number,
  locale?: string
): string {
  const bounded = Math.max(0, Math.floor(durationSeconds));
  const hours = Math.floor(bounded / 3_600);
  const minutes = Math.floor((bounded % 3_600) / 60);
  const seconds = bounded % 60;
  const twoDigits = new Intl.NumberFormat(locale, {
    minimumIntegerDigits: 2,
    maximumFractionDigits: 0,
    useGrouping: false,
  });
  const hoursFormatter = new Intl.NumberFormat(locale, {
    maximumFractionDigits: 0,
    useGrouping: false,
  });
  if (hours > 0) {
    return `${hoursFormatter.format(hours)}:${twoDigits.format(minutes)}:${twoDigits.format(seconds)}`;
  }
  return `${hoursFormatter.format(minutes)}:${twoDigits.format(seconds)}`;
}

export function subscriptionToRssFeed(
  subscription: YouTubeSubscription
): RssFeed {
  const feedUrl = youtubeChannelRssUrl(subscription.channelId);
  return {
    url: feedUrl,
    title: subscription.title,
    siteUrl: youtubeChannelUrl(subscription.channelId),
    ...(subscription.thumbnailUrl
      ? { imageUrl: subscription.thumbnailUrl }
      : {}),
    enabled: true,
    trackUnread: false,
    folder: "YouTube",
    youtubeChannelId: subscription.channelId,
    youtubeSubscriptionId: subscription.subscriptionId,
  };
}

export function subscriptionsToRssFeeds(
  subscriptions: readonly YouTubeSubscription[]
): RssFeed[] {
  return subscriptions.map(subscriptionToRssFeed);
}

export interface UploadToFeedItemOptions {
  capturedAt?: number;
  locale?: string;
}

export function uploadToFeedItem(
  upload: YouTubeUpload,
  options: UploadToFeedItemOptions = {}
): FeedItem {
  const capturedAt = options.capturedAt ?? Date.now();
  const parsedPublishedAt = Date.parse(upload.publishedAt);
  const publishedAt = Number.isFinite(parsedPublishedAt)
    ? parsedPublishedAt
    : capturedAt;
  const watchUrl = youtubeWatchUrl(upload.videoId);
  const feedUrl = youtubeChannelRssUrl(upload.channelId);
  const durationLabel =
    upload.durationSeconds === undefined
      ? undefined
      : `Duration ${formatYouTubeDuration(upload.durationSeconds, options.locale)}`;

  return {
    // Match the Atom entry ID produced by the existing YouTube RSS path so
    // later RSS polls update the same item instead of splitting saved state.
    globalId: `youtube:yt:video:${upload.videoId}`,
    platform: "youtube",
    contentType: "video",
    capturedAt,
    publishedAt,
    author: {
      id: upload.channelId,
      handle: upload.channelId,
      displayName: upload.channelTitle,
    },
    content: {
      ...(upload.description ? { text: upload.description } : {}),
      mediaUrls: upload.thumbnailUrl ? [upload.thumbnailUrl] : [],
      mediaTypes: upload.thumbnailUrl ? ["image"] : [],
      linkPreview: {
        url: watchUrl,
        title: upload.title,
        ...(durationLabel ? { description: durationLabel } : {}),
      },
    },
    rssSource: {
      feedUrl,
      feedTitle: upload.channelTitle,
      siteUrl: youtubeChannelUrl(upload.channelId),
    },
    sourceUrl: watchUrl,
    userState: {
      hidden: false,
      saved: false,
      archived: false,
      tags: [],
    },
    topics: [],
  };
}

export function uploadsToFeedItems(
  uploads: readonly YouTubeUpload[],
  options: UploadToFeedItemOptions = {}
): FeedItem[] {
  return uploads.map((upload) => uploadToFeedItem(upload, options));
}
