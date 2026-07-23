import { describe, expect, it } from "vitest";
import {
  youtubeCapturedChannelsToAccounts,
  youtubeCapturedVideosToFeedItems,
} from "../src/browser.js";

describe("YouTube normalization", () => {
  const channelId = "UC1111111111111111111111";

  it("normalizes followed channels to active roster accounts", () => {
    expect(youtubeCapturedChannelsToAccounts([
      {
        channelId,
        displayName: "Learning Channel",
        handle: "@learning",
        avatarUrl: "https://img.example/channel.jpg",
      },
    ], 123)).toEqual([{
      id: `social:youtube:${channelId}`,
      kind: "social",
      provider: "youtube",
      externalId: channelId,
      handle: "@learning",
      displayName: "Learning Channel",
      avatarUrl: "https://img.example/channel.jpg",
      profileUrl: `https://www.youtube.com/channel/${channelId}`,
      firstSeenAt: 123,
      lastSeenAt: 123,
      discoveredFrom: "follow_roster",
      followRosterActive: true,
      followRosterSyncedAt: 123,
      createdAt: 123,
      updatedAt: 123,
    }]);
  });

  it("normalizes videos to the stable YouTube feed identity", () => {
    expect(youtubeCapturedVideosToFeedItems([{
      videoId: "dQw4w9WgXcQ",
      channelId,
      channelTitle: "Learning Channel",
      channelHandle: "@learning",
      title: "Focused Study",
      description: "A useful lesson.",
      publishedAt: "2026-07-01T12:00:00Z",
      thumbnailUrl: "https://img.example/video.jpg",
    }], 123)).toEqual([{
      globalId: "youtube:yt:video:dQw4w9WgXcQ",
      platform: "youtube",
      contentType: "video",
      capturedAt: 123,
      publishedAt: Date.parse("2026-07-01T12:00:00Z"),
      author: {
        id: channelId,
        handle: "@learning",
        displayName: "Learning Channel",
      },
      content: {
        text: "A useful lesson.",
        mediaUrls: ["https://img.example/video.jpg"],
        mediaTypes: ["image"],
        linkPreview: {
          url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
          title: "Focused Study",
        },
      },
      sourceUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      userState: {
        hidden: false,
        saved: false,
        archived: false,
        tags: [],
      },
      topics: [],
    }]);
  });

  it("rejects handles and malformed identifiers as stable identities", () => {
    expect(youtubeCapturedChannelsToAccounts([
      { channelId: "@learning", displayName: "Learning Channel" },
    ], 123)).toEqual([]);

    expect(youtubeCapturedVideosToFeedItems([{
      videoId: "not!video",
      channelId,
      channelTitle: "Learning Channel",
      title: "Focused Study",
    }], 123)).toEqual([]);
  });
});
