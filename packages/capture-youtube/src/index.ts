export {
  FREED_OFFLINE_PLAYLIST_TITLE,
  YOUTUBE_CHANNEL_BASE_URL,
  YOUTUBE_CHANNEL_RSS_BASE_URL,
  YOUTUBE_DEFAULT_RECENT_UPLOADS_PER_CHANNEL,
  YOUTUBE_MAX_RECENT_UPLOADS_PER_CHANNEL,
  YOUTUBE_OFFLINE_PLAYLIST_SCOPES,
  YOUTUBE_PLAYLIST_WRITE_SCOPE,
  YOUTUBE_READONLY_SCOPE,
  YOUTUBE_READ_SCOPES,
  YOUTUBE_WATCH_BASE_URL,
} from "./constants.js";

export {
  createYouTubeDataApiClient,
  YouTubeApiError,
  YouTubeDataApiClient,
} from "./client.js";

export {
  formatYouTubeDuration,
  parseYouTubeDurationSeconds,
  subscriptionToRssFeed,
  subscriptionsToRssFeeds,
  uploadToFeedItem,
  uploadsToFeedItems,
  youtubeChannelRssUrl,
  youtubeChannelUrl,
  youtubeWatchUrl,
} from "./normalize.js";

export type { UploadToFeedItemOptions } from "./normalize.js";
export type {
  ListRecentUploadsOptions,
  ListSubscriptionsOptions,
  YouTubeApiErrorPayload,
  YouTubeChannelUploads,
  YouTubeDataApiClientOptions,
  YouTubeFetch,
  YouTubeOfflinePlaylist,
  YouTubeOfflinePlaylistAddResult,
  YouTubePlaylistAddResult,
  YouTubeSubscription,
  YouTubeThumbnail,
  YouTubeThumbnails,
  YouTubeUpload,
} from "./types.js";
