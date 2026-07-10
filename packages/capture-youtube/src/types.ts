export type YouTubeFetch = (
  input: string | URL,
  init?: RequestInit
) => Promise<Response>;

export interface YouTubeThumbnail {
  url: string;
  width?: number;
  height?: number;
}

export interface YouTubeThumbnails {
  default?: YouTubeThumbnail;
  medium?: YouTubeThumbnail;
  high?: YouTubeThumbnail;
  standard?: YouTubeThumbnail;
  maxres?: YouTubeThumbnail;
}

export interface YouTubeSubscription {
  subscriptionId: string;
  channelId: string;
  title: string;
  description?: string;
  thumbnailUrl?: string;
}

export interface YouTubeChannelUploads {
  channelId: string;
  uploadsPlaylistId: string;
  title?: string;
  customUrl?: string;
  thumbnailUrl?: string;
}

export interface YouTubeUpload {
  playlistItemId: string;
  playlistId: string;
  videoId: string;
  channelId: string;
  channelTitle: string;
  title: string;
  description?: string;
  publishedAt: string;
  thumbnailUrl?: string;
  duration?: string;
  durationSeconds?: number;
}

export interface YouTubeOfflinePlaylist {
  id: string;
  title: string;
  privacyStatus: "private";
  created: boolean;
}

export interface YouTubePlaylistAddResult {
  playlistId: string;
  videoId: string;
  playlistItemId: string;
  added: boolean;
}

export interface YouTubeOfflinePlaylistAddResult
  extends YouTubePlaylistAddResult {
  playlistCreated: boolean;
}

export interface ListSubscriptionsOptions {
  maxSubscriptions?: number;
}

export interface ListRecentUploadsOptions {
  maxPerPlaylist?: number;
  includeDurations?: boolean;
}

export interface YouTubeDataApiClientOptions {
  accessToken: string;
  fetch: YouTubeFetch;
  apiBaseUrl?: string;
}

export interface YouTubeApiErrorPayload {
  error?: {
    code?: number;
    message?: string;
    errors?: Array<{
      reason?: string;
      message?: string;
    }>;
  };
}
