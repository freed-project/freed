import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  client: {
    listSubscriptions: vi.fn(),
    getChannelUploadPlaylists: vi.fn(),
    listRecentUploads: vi.fn(),
    findOrCreateOfflinePlaylist: vi.fn(),
    addVideoToPlaylist: vi.fn(),
    addVideoToOfflinePlaylist: vi.fn(),
  },
  reconcileSubscriptions: vi.fn(),
  addFeedItems: vi.fn(),
  getSavedYouTubeVideoUrls: vi.fn(),
  initiateOAuth: vi.fn(),
  playlistAccess: true,
  tokenPresent: true,
}));

vi.mock("@freed/capture-youtube", () => ({
  YouTubeApiError: class YouTubeApiError extends Error {
    status: number;
    reason?: string;
    constructor(status: number, payload: { error?: { message?: string; errors?: Array<{ reason?: string }> } }) {
      super(payload.error?.message ?? "YouTube request failed");
      this.status = status;
      this.reason = payload.error?.errors?.[0]?.reason;
    }
  },
  createYouTubeDataApiClient: () => mocks.client,
  subscriptionsToRssFeeds: (subscriptions: Array<{ channelId: string; title: string }>) =>
    subscriptions.map((subscription) => ({
      url: `https://www.youtube.com/feeds/videos.xml?channel_id=${subscription.channelId}`,
      title: subscription.title,
      enabled: true,
      trackUnread: false,
    })),
  uploadsToFeedItems: (uploads: Array<{ videoId: string }>) =>
    uploads.map((upload) => ({ globalId: `youtube:yt:video:${upload.videoId}` })),
}));

vi.mock("./automerge", () => ({
  docAddFeedItems: mocks.addFeedItems,
  docReconcileYouTubeSubscriptions: mocks.reconcileSubscriptions,
  getSavedYouTubeVideoUrls: mocks.getSavedYouTubeVideoUrls,
}));

vi.mock("./youtube-auth", () => ({
  fetchYouTubeWithAuth: vi.fn(),
  getStoredYouTubeToken: () => mocks.tokenPresent ? { accessToken: "token" } : null,
  getValidYouTubeAccessToken: async () => mocks.tokenPresent ? "token" : null,
  hasYouTubePlaylistAccess: () => mocks.playlistAccess,
  initiateYouTubeOAuth: mocks.initiateOAuth,
}));

import {
  addYouTubeVideoToOfflinePlaylist,
  getYouTubeIntegrationState,
  resetYouTubeIntegrationForNewGrant,
  syncSavedYouTubeVideos,
  syncYouTubeSubscriptions,
} from "./youtube-integration";
import { YouTubeApiError } from "@freed/capture-youtube";

describe("PWA YouTube integration", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    mocks.playlistAccess = true;
    mocks.tokenPresent = true;
    mocks.client.listSubscriptions.mockResolvedValue([
      { subscriptionId: "sub-1", channelId: "channel-1", title: "Course Channel" },
    ]);
    mocks.client.getChannelUploadPlaylists.mockResolvedValue([
      { channelId: "channel-1", uploadsPlaylistId: "uploads-1" },
    ]);
    mocks.client.listRecentUploads.mockResolvedValue([{ videoId: "dQw4w9WgXcQ" }]);
    mocks.client.findOrCreateOfflinePlaylist.mockResolvedValue({
      id: "playlist-1",
      title: "Freed Offline",
      privacyStatus: "private",
      created: true,
    });
    mocks.client.addVideoToPlaylist.mockResolvedValue({
      playlistId: "playlist-1",
      videoId: "dQw4w9WgXcQ",
      playlistItemId: "item-1",
      added: true,
    });
    mocks.client.addVideoToOfflinePlaylist.mockResolvedValue({
      playlistId: "playlist-1",
      videoId: "dQw4w9WgXcQ",
      playlistItemId: "item-1",
      added: true,
      playlistCreated: true,
    });
    mocks.getSavedYouTubeVideoUrls.mockResolvedValue([
      "https://youtu.be/dQw4w9WgXcQ",
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ&utm_source=test",
      "https://example.com/not-youtube",
    ]);
  });

  it("persists the full roster before importing a bounded recent window", async () => {
    await expect(syncYouTubeSubscriptions()).resolves.toEqual({
      subscriptionCount: 1,
      videoCount: 1,
      hydratedChannelCount: 1,
      skippedChannelCount: 0,
      recentVideosComplete: true,
    });

    expect(mocks.client.listSubscriptions).toHaveBeenCalledWith();
    expect(mocks.reconcileSubscriptions).toHaveBeenCalledWith(
      [expect.objectContaining({ title: "Course Channel" })],
      [],
    );
    expect(mocks.reconcileSubscriptions.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.client.getChannelUploadPlaylists.mock.invocationCallOrder[0],
    );
    expect(mocks.client.listRecentUploads).toHaveBeenCalledWith(["uploads-1"], {
      maxPerPlaylist: 5,
      includeDurations: false,
    });
    expect(mocks.addFeedItems).toHaveBeenCalledWith(
      [{ globalId: "youtube:yt:video:dQw4w9WgXcQ" }],
    );
    expect(getYouTubeIntegrationState()).toMatchObject({
      subscriptionCount: 1,
      videoCount: 1,
    });
  });

  it("keeps the roster when upload playlist discovery fails", async () => {
    mocks.client.getChannelUploadPlaylists.mockRejectedValueOnce(
      new Error("temporary channel lookup failure"),
    );

    await expect(syncYouTubeSubscriptions()).resolves.toEqual({
      subscriptionCount: 1,
      videoCount: 0,
      hydratedChannelCount: 0,
      skippedChannelCount: 1,
      recentVideosComplete: false,
    });

    expect(mocks.reconcileSubscriptions).toHaveBeenCalledWith(
      [expect.objectContaining({ title: "Course Channel" })],
      [],
    );
    expect(mocks.addFeedItems).not.toHaveBeenCalled();
    expect(getYouTubeIntegrationState()).toMatchObject({
      subscriptionCount: 1,
      videoCount: 0,
    });
  });

  it("imports recent videos without a separate duration lookup", async () => {
    mocks.client.listRecentUploads.mockResolvedValueOnce([{ videoId: "dQw4w9WgXcQ" }]);

    await expect(syncYouTubeSubscriptions()).resolves.toMatchObject({
      videoCount: 1,
      hydratedChannelCount: 1,
      skippedChannelCount: 0,
      recentVideosComplete: true,
    });

    expect(mocks.client.listRecentUploads).toHaveBeenCalledOnce();
    expect(mocks.client.listRecentUploads).toHaveBeenCalledWith(["uploads-1"], {
      maxPerPlaylist: 5,
      includeDurations: false,
    });
    expect(mocks.addFeedItems).toHaveBeenCalledWith([
      { globalId: "youtube:yt:video:dQw4w9WgXcQ" },
    ]);
  });

  it("preserves successful videos and reports skipped channels when quota stops enrichment", async () => {
    mocks.client.listSubscriptions.mockResolvedValueOnce([
      { subscriptionId: "sub-1", channelId: "channel-1", title: "Course Channel" },
      { subscriptionId: "sub-2", channelId: "channel-2", title: "Second Channel" },
    ]);
    mocks.client.getChannelUploadPlaylists.mockResolvedValueOnce([
      { channelId: "channel-1", uploadsPlaylistId: "uploads-1" },
      { channelId: "channel-2", uploadsPlaylistId: "uploads-2" },
    ]);
    mocks.client.listRecentUploads
      .mockResolvedValueOnce([{ videoId: "abcdeFGHI12" }])
      .mockRejectedValueOnce(new YouTubeApiError(403, {
        error: {
          message: "Quota exceeded",
          errors: [{ reason: "quotaExceeded" }],
        },
      }));

    await expect(syncYouTubeSubscriptions()).resolves.toEqual({
      subscriptionCount: 2,
      videoCount: 1,
      hydratedChannelCount: 1,
      skippedChannelCount: 1,
      recentVideosComplete: false,
    });

    expect(mocks.reconcileSubscriptions).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ title: "Course Channel" }),
        expect.objectContaining({ title: "Second Channel" }),
      ]),
      [],
    );
    expect(mocks.addFeedItems).toHaveBeenCalledWith([
      { globalId: "youtube:yt:video:abcdeFGHI12" },
    ]);
  });

  it("adds one deliberate video and reports a playlist URL without claiming a download", async () => {
    await expect(
      addYouTubeVideoToOfflinePlaylist("https://youtube.com/shorts/dQw4w9WgXcQ"),
    ).resolves.toEqual({
      playlistId: "playlist-1",
      playlistUrl: "https://www.youtube.com/playlist?list=playlist-1",
      added: true,
    });
    expect(mocks.client.addVideoToOfflinePlaylist).toHaveBeenCalledWith(
      "dQw4w9WgXcQ",
      undefined,
    );
    expect(getYouTubeIntegrationState()).toMatchObject({
      offlinePlaylistId: "playlist-1",
      offlinePlaylistItemCount: 1,
    });
  });

  it("serializes same-origin playlist writes", async () => {
    let resolveFirst!: (value: {
      playlistId: string;
      videoId: string;
      playlistItemId: string;
      added: boolean;
      playlistCreated: boolean;
    }) => void;
    mocks.client.addVideoToOfflinePlaylist
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveFirst = resolve;
      }))
      .mockResolvedValueOnce({
        playlistId: "playlist-1",
        videoId: "dQw4w9WgXcQ",
        playlistItemId: "item-1",
        added: false,
        playlistCreated: false,
      });

    const first = addYouTubeVideoToOfflinePlaylist("https://youtu.be/dQw4w9WgXcQ");
    await vi.waitFor(() => expect(mocks.client.addVideoToOfflinePlaylist).toHaveBeenCalledOnce());
    const second = addYouTubeVideoToOfflinePlaylist("https://youtu.be/dQw4w9WgXcQ");
    await Promise.resolve();
    expect(mocks.client.addVideoToOfflinePlaylist).toHaveBeenCalledOnce();

    resolveFirst({
      playlistId: "playlist-1",
      videoId: "dQw4w9WgXcQ",
      playlistItemId: "item-1",
      added: true,
      playlistCreated: true,
    });
    await expect(first).resolves.toMatchObject({ added: true });
    await expect(second).resolves.toMatchObject({ added: false });
    expect(mocks.client.addVideoToOfflinePlaylist).toHaveBeenCalledTimes(2);
  });

  it("clears account-specific metadata before a new grant is stored", async () => {
    await addYouTubeVideoToOfflinePlaylist("https://youtu.be/dQw4w9WgXcQ");
    expect(getYouTubeIntegrationState().offlinePlaylistId).toBe("playlist-1");

    resetYouTubeIntegrationForNewGrant();

    expect(getYouTubeIntegrationState()).toEqual({
      subscriptionCount: 0,
      videoCount: 0,
      offlinePlaylistItemCount: 0,
    });
  });

  it("deduplicates saved URLs before membership-checked playlist insertion", async () => {
    await expect(syncSavedYouTubeVideos()).resolves.toMatchObject({
      playlistId: "playlist-1",
      addedCount: 1,
      existingCount: 0,
    });

    expect(mocks.client.findOrCreateOfflinePlaylist).toHaveBeenCalledWith(undefined);
    expect(mocks.getSavedYouTubeVideoUrls).toHaveBeenCalledOnce();
    expect(mocks.client.addVideoToPlaylist).toHaveBeenCalledTimes(1);
    expect(mocks.client.addVideoToPlaylist).toHaveBeenCalledWith(
      "playlist-1",
      "dQw4w9WgXcQ",
    );
  });

  it("starts incremental playlist authorization when the write grant is absent", async () => {
    mocks.playlistAccess = false;

    await expect(
      addYouTubeVideoToOfflinePlaylist("https://youtu.be/dQw4w9WgXcQ"),
    ).rejects.toThrow("Finish the YouTube playlist authorization");
    expect(mocks.initiateOAuth).toHaveBeenCalledWith("playlist");
    expect(mocks.client.addVideoToOfflinePlaylist).not.toHaveBeenCalled();
  });

  it("keeps quota exhaustion distinct from an offline download result", async () => {
    mocks.client.addVideoToOfflinePlaylist.mockRejectedValueOnce(
      new YouTubeApiError(403, {
        error: {
          message: "Quota exceeded",
          errors: [{ reason: "quotaExceeded" }],
        },
      }),
    );

    await expect(
      addYouTubeVideoToOfflinePlaylist("https://youtu.be/dQw4w9WgXcQ"),
    ).rejects.toThrow("YouTube API quota is exhausted");
    expect(getYouTubeIntegrationState().offlinePlaylistItemCount).toBe(0);
  });

  it("distinguishes playlist capacity from a permission failure", async () => {
    mocks.client.addVideoToOfflinePlaylist.mockRejectedValueOnce(
      new YouTubeApiError(403, {
        error: {
          message: "Playlist is full",
          errors: [{ reason: "playlistContainsMaximumNumberOfVideos" }],
        },
      }),
    );

    await expect(
      addYouTubeVideoToOfflinePlaylist("https://youtu.be/dQw4w9WgXcQ"),
    ).rejects.toThrow("playlist video limit");
  });
});
