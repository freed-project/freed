/** Read-only access for subscriptions, channels, uploads, and playlists. */
export const YOUTUBE_READONLY_SCOPE =
  "https://www.googleapis.com/auth/youtube.readonly" as const;

/**
 * Required for creating the private Freed Offline playlist and adding videos.
 * This scope also permits broader YouTube account changes, so callers should
 * request it only when the user enables the offline playlist feature.
 */
export const YOUTUBE_PLAYLIST_WRITE_SCOPE =
  "https://www.googleapis.com/auth/youtube.force-ssl" as const;

export const YOUTUBE_READ_SCOPES = [YOUTUBE_READONLY_SCOPE] as const;
export const YOUTUBE_OFFLINE_PLAYLIST_SCOPES = [
  YOUTUBE_READONLY_SCOPE,
  YOUTUBE_PLAYLIST_WRITE_SCOPE,
] as const;

export const YOUTUBE_CHANNEL_RSS_BASE_URL =
  "https://www.youtube.com/feeds/videos.xml" as const;
export const YOUTUBE_WATCH_BASE_URL =
  "https://www.youtube.com/watch" as const;
export const YOUTUBE_CHANNEL_BASE_URL =
  "https://www.youtube.com/channel" as const;

export const FREED_OFFLINE_PLAYLIST_TITLE = "Freed Offline" as const;
export const YOUTUBE_DEFAULT_RECENT_UPLOADS_PER_CHANNEL = 10;
export const YOUTUBE_MAX_RECENT_UPLOADS_PER_CHANNEL = 50;
