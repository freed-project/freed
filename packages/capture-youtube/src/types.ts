/** One followed channel extracted from the user's authenticated YouTube website session. */
export interface YouTubeCapturedChannel {
  channelId: string;
  displayName: string;
  handle?: string;
  description?: string;
  avatarUrl?: string;
  profileUrl?: string;
}

/** One video extracted from the user's normal YouTube website experience. */
export interface YouTubeCapturedVideo {
  videoId: string;
  channelId: string;
  channelTitle: string;
  channelHandle?: string;
  channelAvatarUrl?: string;
  title: string;
  description?: string;
  publishedAt?: number | string;
  thumbnailUrl?: string;
  sourceUrl?: string;
}
