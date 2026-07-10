import { describe, expect, it } from "vitest";
import {
  FREED_OFFLINE_PLAYLIST_TITLE,
  YouTubeApiError,
  YouTubeDataApiClient,
} from "../src/index.js";
import type { YouTubeFetch } from "../src/index.js";

interface FetchCall {
  url: URL;
  init?: RequestInit;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function createMockFetch(
  handler: (call: FetchCall, index: number) => Response | Promise<Response>
): { fetch: YouTubeFetch; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const fetch: YouTubeFetch = async (input, init) => {
    const call = { url: new URL(input.toString()), init };
    calls.push(call);
    return handler(call, calls.length - 1);
  };
  return { fetch, calls };
}

function client(fetch: YouTubeFetch): YouTubeDataApiClient {
  return new YouTubeDataApiClient({
    accessToken: "test-access-token",
    fetch,
  });
}

describe("YouTubeDataApiClient", () => {
  it("paginates subscriptions and sends the bearer token", async () => {
    const mock = createMockFetch(({ url }) => {
      if (url.searchParams.get("pageToken") === "next") {
        return jsonResponse({
          items: [
            {
              id: "subscription-2",
              snippet: {
                title: "Second Channel",
                resourceId: { channelId: "channel-2" },
              },
            },
          ],
        });
      }
      return jsonResponse({
        nextPageToken: "next",
        items: [
          {
            id: "subscription-1",
            snippet: {
              title: "First Channel",
              description: "Lessons",
              thumbnails: { high: { url: "https://img.example/first.jpg" } },
              resourceId: { channelId: "channel-1" },
            },
          },
        ],
      });
    });

    await expect(client(mock.fetch).listSubscriptions()).resolves.toEqual([
      {
        subscriptionId: "subscription-1",
        channelId: "channel-1",
        title: "First Channel",
        description: "Lessons",
        thumbnailUrl: "https://img.example/first.jpg",
      },
      {
        subscriptionId: "subscription-2",
        channelId: "channel-2",
        title: "Second Channel",
      },
    ]);
    expect(mock.calls).toHaveLength(2);
    expect(mock.calls[0]?.url.pathname).toBe("/youtube/v3/subscriptions");
    expect(new Headers(mock.calls[0]?.init?.headers).get("Authorization")).toBe(
      "Bearer test-access-token"
    );
  });

  it("looks up channel upload playlists in batches of 50", async () => {
    const channelIds = Array.from(
      { length: 51 },
      (_, index) => `channel-${index + 1}`
    );
    const mock = createMockFetch(({ url }) => {
      const ids = url.searchParams.get("id")?.split(",") ?? [];
      return jsonResponse({
        items: ids.map((id) => ({
          id,
          snippet: { title: `Title ${id}` },
          contentDetails: {
            relatedPlaylists: { uploads: `uploads-${id}` },
          },
        })),
      });
    });

    const result = await client(mock.fetch).getChannelUploadPlaylists(channelIds);

    expect(mock.calls).toHaveLength(2);
    expect(mock.calls[0]?.url.searchParams.get("id")?.split(",")).toHaveLength(50);
    expect(mock.calls[1]?.url.searchParams.get("id")).toBe("channel-51");
    expect(result).toHaveLength(51);
    expect(result[50]).toEqual({
      channelId: "channel-51",
      uploadsPlaylistId: "uploads-channel-51",
      title: "Title channel-51",
    });
  });

  it("bounds recent uploads and enriches them with video duration", async () => {
    const mock = createMockFetch(({ url }) => {
      if (url.pathname.endsWith("/playlistItems")) {
        return jsonResponse({
          items: [
            {
              id: "playlist-item-1",
              snippet: {
                playlistId: "uploads-1",
                title: "A focused lesson",
                description: "The useful part.",
                thumbnails: {
                  maxres: { url: "https://img.example/video.jpg" },
                },
                videoOwnerChannelId: "channel-1",
                videoOwnerChannelTitle: "Thoughtful Channel",
                resourceId: { videoId: "video-1" },
              },
              contentDetails: {
                videoId: "video-1",
                videoPublishedAt: "2026-07-01T12:00:00Z",
              },
            },
          ],
        });
      }
      if (url.pathname.endsWith("/videos")) {
        return jsonResponse({
          items: [
            { id: "video-1", contentDetails: { duration: "PT1H2M3S" } },
          ],
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    const result = await client(mock.fetch).listRecentUploads(["uploads-1"], {
      maxPerPlaylist: 500,
    });

    expect(mock.calls[0]?.url.searchParams.get("maxResults")).toBe("50");
    expect(result).toEqual([
      {
        playlistItemId: "playlist-item-1",
        playlistId: "uploads-1",
        videoId: "video-1",
        channelId: "channel-1",
        channelTitle: "Thoughtful Channel",
        title: "A focused lesson",
        description: "The useful part.",
        publishedAt: "2026-07-01T12:00:00Z",
        thumbnailUrl: "https://img.example/video.jpg",
        duration: "PT1H2M3S",
        durationSeconds: 3_723,
      },
    ]);
  });

  it("finds only an exact private Freed Offline playlist", async () => {
    const mock = createMockFetch(({ url }) => {
      if (url.searchParams.get("pageToken") === "next") {
        return jsonResponse({
          items: [
            {
              id: "private-match",
              snippet: { title: FREED_OFFLINE_PLAYLIST_TITLE },
              status: { privacyStatus: "private" },
            },
          ],
        });
      }
      return jsonResponse({
        nextPageToken: "next",
        items: [
          {
            id: "public-match",
            snippet: { title: FREED_OFFLINE_PLAYLIST_TITLE },
            status: { privacyStatus: "public" },
          },
          {
            id: "near-match",
            snippet: { title: "Freed Offline Copy" },
            status: { privacyStatus: "private" },
          },
        ],
      });
    });

    await expect(client(mock.fetch).findOfflinePlaylist()).resolves.toEqual({
      id: "private-match",
      title: FREED_OFFLINE_PLAYLIST_TITLE,
      privacyStatus: "private",
      created: false,
    });
  });

  it("prefers a recorded private playlist ID even if the user renamed it", async () => {
    const mock = createMockFetch(({ url }) => {
      expect(url.searchParams.get("id")).toBe("recorded-playlist");
      expect(url.searchParams.has("mine")).toBe(false);
      return jsonResponse({
        items: [{
          id: "recorded-playlist",
          snippet: { title: "My Study Queue" },
          status: { privacyStatus: "private" },
        }],
      });
    });

    await expect(client(mock.fetch).findOfflinePlaylist("recorded-playlist"))
      .resolves.toEqual({
        id: "recorded-playlist",
        title: "My Study Queue",
        privacyStatus: "private",
        created: false,
      });
    expect(mock.calls).toHaveLength(1);
  });

  it("does not insert a video already present in the playlist", async () => {
    const mock = createMockFetch(({ url }) => {
      expect(url.searchParams.get("videoId")).toBe("video-1");
      return jsonResponse({ items: [{ id: "existing-playlist-item" }] });
    });

    await expect(
      client(mock.fetch).addVideoToPlaylist("playlist-1", "video-1")
    ).resolves.toEqual({
      playlistId: "playlist-1",
      videoId: "video-1",
      playlistItemId: "existing-playlist-item",
      added: false,
    });
    expect(mock.calls).toHaveLength(1);
    expect(mock.calls[0]?.init?.method).toBe("GET");
  });

  it("creates the private offline playlist and inserts the video", async () => {
    const mock = createMockFetch(({ url, init }, index) => {
      if (index === 0) return jsonResponse({ items: [] });
      if (index === 1) {
        expect(url.pathname).toMatch(/\/playlists$/);
        expect(init?.method).toBe("POST");
        expect(JSON.parse(String(init?.body))).toMatchObject({
          snippet: { title: FREED_OFFLINE_PLAYLIST_TITLE },
          status: { privacyStatus: "private" },
        });
        return jsonResponse({ id: "freed-offline-playlist" });
      }
      if (index === 2) return jsonResponse({ items: [] });
      expect(url.pathname).toMatch(/\/playlistItems$/);
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({
        snippet: {
          playlistId: "freed-offline-playlist",
          resourceId: { kind: "youtube#video", videoId: "video-1" },
        },
      });
      return jsonResponse({ id: "new-playlist-item" });
    });

    await expect(
      client(mock.fetch).addVideoToOfflinePlaylist("video-1")
    ).resolves.toEqual({
      playlistId: "freed-offline-playlist",
      videoId: "video-1",
      playlistItemId: "new-playlist-item",
      added: true,
      playlistCreated: true,
    });
    expect(mock.calls).toHaveLength(4);
  });

  it("throws a typed API error with the provider reason", async () => {
    const mock = createMockFetch(() =>
      jsonResponse(
        {
          error: {
            message: "Quota exceeded",
            errors: [{ reason: "quotaExceeded" }],
          },
        },
        403
      )
    );

    const error = await client(mock.fetch).listSubscriptions().catch((value) => value);
    expect(error).toBeInstanceOf(YouTubeApiError);
    expect(error).toMatchObject({
      status: 403,
      reason: "quotaExceeded",
      message: "Quota exceeded",
    });
  });

  it("keeps the HTTP status when an upstream error body is not JSON", async () => {
    const mock = createMockFetch(() => new Response("Service unavailable", { status: 503 }));

    const error = await client(mock.fetch).listSubscriptions().catch((value) => value);
    expect(error).toBeInstanceOf(YouTubeApiError);
    expect(error).toMatchObject({
      status: 503,
      message: "YouTube API returned an unreadable response (503)",
    });
  });
});
