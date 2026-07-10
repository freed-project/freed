import { describe, expect, it } from "vitest";
import {
  formatYouTubeDuration,
  parseYouTubeDurationSeconds,
  subscriptionToRssFeed,
  uploadToFeedItem,
  youtubeChannelRssUrl,
  youtubeWatchUrl,
} from "../src/index.js";
import type { YouTubeUpload } from "../src/index.js";

describe("YouTube normalization", () => {
  it("uses the canonical channel RSS URL and YouTube folder", () => {
    expect(
      subscriptionToRssFeed({
        subscriptionId: "subscription-1",
        channelId: "channel-1",
        title: "Learning Channel",
        thumbnailUrl: "https://img.example/channel.jpg",
      })
    ).toEqual({
      url: "https://www.youtube.com/feeds/videos.xml?channel_id=channel-1",
      title: "Learning Channel",
      siteUrl: "https://www.youtube.com/channel/channel-1",
      imageUrl: "https://img.example/channel.jpg",
      enabled: true,
      trackUnread: false,
      folder: "YouTube",
      youtubeChannelId: "channel-1",
      youtubeSubscriptionId: "subscription-1",
    });
    expect(youtubeChannelRssUrl("channel / id")).toBe(
      "https://www.youtube.com/feeds/videos.xml?channel_id=channel+%2F+id"
    );
  });

  it("normalizes an upload to a video FeedItem", () => {
    const upload: YouTubeUpload = {
      playlistItemId: "playlist-item-1",
      playlistId: "uploads-1",
      videoId: "video-1",
      channelId: "channel-1",
      channelTitle: "Learning Channel",
      title: "Focused Study",
      description: "A useful lesson.",
      publishedAt: "2026-07-01T12:00:00Z",
      thumbnailUrl: "https://img.example/video.jpg",
      duration: "PT12M34S",
      durationSeconds: 754,
    };

    expect(uploadToFeedItem(upload, { capturedAt: 123, locale: "en-US" })).toEqual({
      globalId: "youtube:yt:video:video-1",
      platform: "youtube",
      contentType: "video",
      capturedAt: 123,
      publishedAt: Date.parse("2026-07-01T12:00:00Z"),
      author: {
        id: "channel-1",
        handle: "channel-1",
        displayName: "Learning Channel",
      },
      content: {
        text: "A useful lesson.",
        mediaUrls: ["https://img.example/video.jpg"],
        mediaTypes: ["image"],
        linkPreview: {
          url: "https://www.youtube.com/watch?v=video-1",
          title: "Focused Study",
          description: "Duration 12:34",
        },
      },
      rssSource: {
        feedUrl: "https://www.youtube.com/feeds/videos.xml?channel_id=channel-1",
        feedTitle: "Learning Channel",
        siteUrl: "https://www.youtube.com/channel/channel-1",
      },
      sourceUrl: "https://www.youtube.com/watch?v=video-1",
      userState: {
        hidden: false,
        saved: false,
        archived: false,
        tags: [],
      },
      topics: [],
    });
    expect(youtubeWatchUrl("video / id")).toBe(
      "https://www.youtube.com/watch?v=video+%2F+id"
    );
  });

  it("parses and formats YouTube ISO durations", () => {
    expect(parseYouTubeDurationSeconds("PT1H2M3S")).toBe(3_723);
    expect(parseYouTubeDurationSeconds("P1DT2M")).toBe(86_520);
    expect(parseYouTubeDurationSeconds("not-a-duration")).toBeUndefined();
    expect(formatYouTubeDuration(3_723, "en-US")).toBe("1:02:03");
    expect(formatYouTubeDuration(754, "en-US")).toBe("12:34");
  });
});
