import {
  FREED_OFFLINE_PLAYLIST_TITLE,
  YOUTUBE_DEFAULT_RECENT_UPLOADS_PER_CHANNEL,
  YOUTUBE_MAX_RECENT_UPLOADS_PER_CHANNEL,
} from "./constants.js";
import { parseYouTubeDurationSeconds } from "./normalize.js";
import type {
  ListRecentUploadsOptions,
  ListSubscriptionsOptions,
  YouTubeApiErrorPayload,
  YouTubeChannelUploads,
  YouTubeDataApiClientOptions,
  YouTubeOfflinePlaylist,
  YouTubeOfflinePlaylistAddResult,
  YouTubePlaylistAddResult,
  YouTubeSubscription,
  YouTubeThumbnails,
  YouTubeUpload,
} from "./types.js";

const DEFAULT_API_BASE_URL = "https://www.googleapis.com/youtube/v3";
const API_MAX_PAGE_SIZE = 50;

interface Page<T> {
  items?: T[];
  nextPageToken?: string;
}

interface SubscriptionResource {
  id: string;
  snippet?: {
    title?: string;
    description?: string;
    thumbnails?: YouTubeThumbnails;
    resourceId?: {
      channelId?: string;
    };
  };
}

interface ChannelResource {
  id: string;
  snippet?: {
    title?: string;
    customUrl?: string;
    thumbnails?: YouTubeThumbnails;
  };
  contentDetails?: {
    relatedPlaylists?: {
      uploads?: string;
    };
  };
}

interface PlaylistItemResource {
  id: string;
  snippet?: {
    playlistId?: string;
    channelId?: string;
    channelTitle?: string;
    title?: string;
    description?: string;
    publishedAt?: string;
    thumbnails?: YouTubeThumbnails;
    videoOwnerChannelId?: string;
    videoOwnerChannelTitle?: string;
    resourceId?: {
      videoId?: string;
    };
  };
  contentDetails?: {
    videoId?: string;
    videoPublishedAt?: string;
  };
}

interface VideoResource {
  id: string;
  contentDetails?: {
    duration?: string;
  };
}

interface PlaylistResource {
  id: string;
  snippet?: {
    title?: string;
  };
  status?: {
    privacyStatus?: string;
  };
}

function preferredThumbnail(thumbnails?: YouTubeThumbnails): string | undefined {
  return (
    thumbnails?.maxres?.url ??
    thumbnails?.standard?.url ??
    thumbnails?.high?.url ??
    thumbnails?.medium?.url ??
    thumbnails?.default?.url
  );
}

function uniqueNonEmpty(values: readonly string[]): string[] {
  const unique = new Set<string>();
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed) unique.add(trimmed);
  }
  return [...unique];
}

function chunks<T>(values: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  maximum: number
): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value)) {
    throw new TypeError("YouTube API limits must be finite numbers");
  }
  return Math.min(maximum, Math.max(0, Math.floor(value)));
}

function requiredId(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new TypeError(`${label} is required`);
  return trimmed;
}

export class YouTubeApiError extends Error {
  readonly status: number;
  readonly reason?: string;
  readonly payload: YouTubeApiErrorPayload;

  constructor(status: number, payload: YouTubeApiErrorPayload) {
    const reason = payload.error?.errors?.[0]?.reason;
    const message = payload.error?.message ?? `YouTube API request failed (${status})`;
    super(message);
    this.name = "YouTubeApiError";
    this.status = status;
    this.reason = reason;
    this.payload = payload;
  }
}

export class YouTubeDataApiClient {
  private readonly accessToken: string;
  private readonly fetchImpl: YouTubeDataApiClientOptions["fetch"];
  private readonly apiBaseUrl: string;

  constructor(options: YouTubeDataApiClientOptions) {
    this.accessToken = requiredId(options.accessToken, "YouTube access token");
    this.fetchImpl = options.fetch;
    this.apiBaseUrl = (options.apiBaseUrl ?? DEFAULT_API_BASE_URL).replace(
      /\/$/,
      ""
    );
  }

  async listSubscriptions(
    options: ListSubscriptionsOptions = {}
  ): Promise<YouTubeSubscription[]> {
    const maximum = options.maxSubscriptions;
    if (maximum !== undefined && (!Number.isFinite(maximum) || maximum < 0)) {
      throw new TypeError("maxSubscriptions must be a non-negative finite number");
    }

    const targetCount = maximum === undefined ? Number.POSITIVE_INFINITY : Math.floor(maximum);
    if (targetCount === 0) return [];

    const subscriptions: YouTubeSubscription[] = [];
    let pageToken: string | undefined;

    do {
      const remaining = targetCount - subscriptions.length;
      const page = await this.get<Page<SubscriptionResource>>("subscriptions", {
        part: "snippet",
        mine: "true",
        maxResults: Math.min(API_MAX_PAGE_SIZE, remaining),
        ...(pageToken ? { pageToken } : {}),
      });

      for (const resource of page.items ?? []) {
        const channelId = resource.snippet?.resourceId?.channelId;
        const title = resource.snippet?.title;
        if (!channelId || !title) continue;
        subscriptions.push({
          subscriptionId: resource.id,
          channelId,
          title,
          ...(resource.snippet?.description
            ? { description: resource.snippet.description }
            : {}),
          ...(preferredThumbnail(resource.snippet?.thumbnails)
            ? { thumbnailUrl: preferredThumbnail(resource.snippet?.thumbnails) }
            : {}),
        });
        if (subscriptions.length >= targetCount) break;
      }

      pageToken = page.nextPageToken;
    } while (pageToken && subscriptions.length < targetCount);

    return subscriptions;
  }

  async getChannelUploadPlaylists(
    channelIds: readonly string[]
  ): Promise<YouTubeChannelUploads[]> {
    const ids = uniqueNonEmpty(channelIds);
    if (ids.length === 0) return [];

    const byChannelId = new Map<string, YouTubeChannelUploads>();
    for (const batch of chunks(ids, API_MAX_PAGE_SIZE)) {
      const page = await this.get<Page<ChannelResource>>("channels", {
        part: "contentDetails,snippet",
        id: batch.join(","),
        maxResults: API_MAX_PAGE_SIZE,
      });

      for (const channel of page.items ?? []) {
        const uploadsPlaylistId = channel.contentDetails?.relatedPlaylists?.uploads;
        if (!uploadsPlaylistId) continue;
        const thumbnailUrl = preferredThumbnail(channel.snippet?.thumbnails);
        byChannelId.set(channel.id, {
          channelId: channel.id,
          uploadsPlaylistId,
          ...(channel.snippet?.title ? { title: channel.snippet.title } : {}),
          ...(channel.snippet?.customUrl
            ? { customUrl: channel.snippet.customUrl }
            : {}),
          ...(thumbnailUrl ? { thumbnailUrl } : {}),
        });
      }
    }

    return ids.flatMap((channelId) => {
      const channel = byChannelId.get(channelId);
      return channel ? [channel] : [];
    });
  }

  async listRecentUploads(
    uploadPlaylistIds: readonly string[],
    options: ListRecentUploadsOptions = {}
  ): Promise<YouTubeUpload[]> {
    const playlistIds = uniqueNonEmpty(uploadPlaylistIds);
    const maxPerPlaylist = boundedInteger(
      options.maxPerPlaylist,
      YOUTUBE_DEFAULT_RECENT_UPLOADS_PER_CHANNEL,
      YOUTUBE_MAX_RECENT_UPLOADS_PER_CHANNEL
    );
    if (playlistIds.length === 0 || maxPerPlaylist === 0) return [];

    const resources: Array<{
      playlistId: string;
      resource: PlaylistItemResource;
    }> = [];

    for (const playlistId of playlistIds) {
      const page = await this.get<Page<PlaylistItemResource>>("playlistItems", {
        part: "snippet,contentDetails",
        playlistId,
        maxResults: maxPerPlaylist,
      });
      for (const resource of page.items ?? []) {
        resources.push({ playlistId, resource });
      }
    }

    const durationByVideoId =
      options.includeDurations === false
        ? new Map<string, string>()
        : await this.getVideoDurations(
            uniqueNonEmpty(
              resources.flatMap(({ resource }) => {
                const videoId =
                  resource.contentDetails?.videoId ??
                  resource.snippet?.resourceId?.videoId;
                return videoId ? [videoId] : [];
              })
            )
          );

    return resources.flatMap(({ playlistId, resource }) => {
      const snippet = resource.snippet;
      const videoId =
        resource.contentDetails?.videoId ?? snippet?.resourceId?.videoId;
      const channelId = snippet?.videoOwnerChannelId ?? snippet?.channelId;
      const channelTitle =
        snippet?.videoOwnerChannelTitle ?? snippet?.channelTitle;
      const publishedAt =
        resource.contentDetails?.videoPublishedAt ?? snippet?.publishedAt;
      if (!videoId || !channelId || !channelTitle || !publishedAt) return [];

      const duration = durationByVideoId.get(videoId);
      const durationSeconds = duration
        ? parseYouTubeDurationSeconds(duration)
        : undefined;
      const thumbnailUrl = preferredThumbnail(snippet?.thumbnails);
      return [
        {
          playlistItemId: resource.id,
          playlistId,
          videoId,
          channelId,
          channelTitle,
          title: snippet?.title ?? "YouTube video",
          ...(snippet?.description ? { description: snippet.description } : {}),
          publishedAt,
          ...(thumbnailUrl ? { thumbnailUrl } : {}),
          ...(duration ? { duration } : {}),
          ...(durationSeconds !== undefined ? { durationSeconds } : {}),
        },
      ];
    });
  }

  async findOfflinePlaylist(
    preferredPlaylistId?: string
  ): Promise<YouTubeOfflinePlaylist | null> {
    const preferredId = preferredPlaylistId?.trim();
    if (preferredId) {
      const preferred = await this.get<Page<PlaylistResource>>("playlists", {
        part: "snippet,status",
        id: preferredId,
        maxResults: 1,
      });
      const match = preferred.items?.find(
        (playlist) => playlist.id === preferredId && playlist.status?.privacyStatus === "private"
      );
      if (match) {
        return {
          id: match.id,
          title: match.snippet?.title ?? FREED_OFFLINE_PLAYLIST_TITLE,
          privacyStatus: "private",
          created: false,
        };
      }
    }

    let pageToken: string | undefined;
    do {
      const page = await this.get<Page<PlaylistResource>>("playlists", {
        part: "snippet,status",
        mine: "true",
        maxResults: API_MAX_PAGE_SIZE,
        ...(pageToken ? { pageToken } : {}),
      });

      const existing = (page.items ?? []).find(
        (playlist) =>
          playlist.snippet?.title === FREED_OFFLINE_PLAYLIST_TITLE &&
          playlist.status?.privacyStatus === "private"
      );
      if (existing) {
        return {
          id: existing.id,
          title: FREED_OFFLINE_PLAYLIST_TITLE,
          privacyStatus: "private",
          created: false,
        };
      }
      pageToken = page.nextPageToken;
    } while (pageToken);

    return null;
  }

  async findOrCreateOfflinePlaylist(
    preferredPlaylistId?: string
  ): Promise<YouTubeOfflinePlaylist> {
    const existing = await this.findOfflinePlaylist(preferredPlaylistId);
    if (existing) return existing;

    const created = await this.post<PlaylistResource>(
      "playlists",
      { part: "snippet,status" },
      {
        snippet: {
          title: FREED_OFFLINE_PLAYLIST_TITLE,
          description:
            "Videos saved in Freed for focused viewing and YouTube Premium downloads.",
        },
        status: {
          privacyStatus: "private",
        },
      }
    );

    return {
      id: requiredId(created.id, "Created YouTube playlist ID"),
      title: FREED_OFFLINE_PLAYLIST_TITLE,
      privacyStatus: "private",
      created: true,
    };
  }

  async addVideoToPlaylist(
    playlistIdInput: string,
    videoIdInput: string
  ): Promise<YouTubePlaylistAddResult> {
    const playlistId = requiredId(playlistIdInput, "YouTube playlist ID");
    const videoId = requiredId(videoIdInput, "YouTube video ID");
    const existing = await this.get<Page<PlaylistItemResource>>("playlistItems", {
      part: "id,contentDetails",
      playlistId,
      videoId,
      maxResults: 1,
    });
    const existingItem = existing.items?.[0];
    if (existingItem) {
      return {
        playlistId,
        videoId,
        playlistItemId: existingItem.id,
        added: false,
      };
    }

    const inserted = await this.post<PlaylistItemResource>(
      "playlistItems",
      { part: "snippet" },
      {
        snippet: {
          playlistId,
          resourceId: {
            kind: "youtube#video",
            videoId,
          },
        },
      }
    );

    return {
      playlistId,
      videoId,
      playlistItemId: requiredId(inserted.id, "Created YouTube playlist item ID"),
      added: true,
    };
  }

  async addVideoToOfflinePlaylist(
    videoId: string,
    preferredPlaylistId?: string
  ): Promise<YouTubeOfflinePlaylistAddResult> {
    const playlist = await this.findOrCreateOfflinePlaylist(preferredPlaylistId);
    const result = await this.addVideoToPlaylist(playlist.id, videoId);
    return {
      ...result,
      playlistCreated: playlist.created,
    };
  }

  private async getVideoDurations(
    videoIds: readonly string[]
  ): Promise<Map<string, string>> {
    const durations = new Map<string, string>();
    for (const batch of chunks(videoIds, API_MAX_PAGE_SIZE)) {
      const page = await this.get<Page<VideoResource>>("videos", {
        part: "contentDetails",
        id: batch.join(","),
        maxResults: API_MAX_PAGE_SIZE,
      });
      for (const video of page.items ?? []) {
        const duration = video.contentDetails?.duration;
        if (duration) durations.set(video.id, duration);
      }
    }
    return durations;
  }

  private get<T>(
    path: string,
    query: Record<string, string | number>
  ): Promise<T> {
    return this.request<T>(path, query, { method: "GET" });
  }

  private post<T>(
    path: string,
    query: Record<string, string | number>,
    body: unknown
  ): Promise<T> {
    return this.request<T>(path, query, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  private async request<T>(
    path: string,
    query: Record<string, string | number>,
    init: RequestInit
  ): Promise<T> {
    const url = new URL(`${this.apiBaseUrl}/${path}`);
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, String(value));
    }

    const response = await this.fetchImpl(url, {
      ...init,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${this.accessToken}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
      },
    });
    const text = await response.text();
    let payload: unknown = {};
    if (text) {
      try {
        payload = JSON.parse(text) as unknown;
      } catch {
        payload = {
          error: {
            code: response.status,
            message: `YouTube API returned an unreadable response (${response.status})`,
          },
        } satisfies YouTubeApiErrorPayload;
      }
    }
    if (!response.ok) {
      throw new YouTubeApiError(response.status, payload as YouTubeApiErrorPayload);
    }
    return payload as T;
  }
}

export function createYouTubeDataApiClient(
  options: YouTubeDataApiClientOptions
): YouTubeDataApiClient {
  return new YouTubeDataApiClient(options);
}
