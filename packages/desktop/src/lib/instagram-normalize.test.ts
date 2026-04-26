import { describe, expect, it } from "vitest";
import { igPostToFeedItem } from "@freed/capture-instagram/browser";

describe("igPostToFeedItem", () => {
  it("preserves story location metadata and marks it as a sticker", () => {
    const item = igPostToFeedItem({
      shortcode: "story_123",
      url: "https://www.instagram.com/stories/ada/123/",
      authorHandle: "ada",
      authorDisplayName: "Ada",
      authorAvatarUrl: null,
      authorProfileUrl: "https://www.instagram.com/ada/",
      caption: null,
      timestampIso: "2026-04-16T22:00:00.000Z",
      mediaUrls: ["https://cdn.example/story.jpg"],
      isVideo: false,
      isCarousel: false,
      likeCount: null,
      commentCount: null,
      hashtags: [],
      location: "Locations",
      locationUrl: "https://www.instagram.com/explore/locations/123456789/big-bear-california/",
      postType: "story",
    });

    expect(item?.location).toEqual({
      name: "Locations",
      url: "https://www.instagram.com/explore/locations/123456789/big-bear-california/",
      source: "sticker",
    });
  });

  it("keeps standard Instagram posts as geo tags", () => {
    const item = igPostToFeedItem({
      shortcode: "abc123",
      url: "https://www.instagram.com/p/abc123/",
      authorHandle: "ada",
      authorDisplayName: "Ada",
      authorAvatarUrl: null,
      authorProfileUrl: "https://www.instagram.com/ada/",
      caption: "Hello from Paris",
      timestampIso: "2026-04-16T22:00:00.000Z",
      mediaUrls: ["https://cdn.example/post.jpg"],
      isVideo: false,
      isCarousel: false,
      likeCount: 10,
      commentCount: 1,
      hashtags: ["paris"],
      location: "Paris, France",
      locationUrl: "https://www.instagram.com/explore/locations/6889842/paris-france/",
      postType: "photo",
    });

    expect(item?.location).toEqual({
      name: "Paris, France",
      url: "https://www.instagram.com/explore/locations/6889842/paris-france/",
      source: "geo_tag",
    });
  });

  it("uses extractor media types when they are provided", () => {
    const item = igPostToFeedItem({
      shortcode: "story_video",
      url: "https://www.instagram.com/stories/ada/story_video/",
      authorHandle: "ada",
      authorDisplayName: "Ada",
      authorAvatarUrl: null,
      authorProfileUrl: "https://www.instagram.com/ada/",
      caption: null,
      timestampIso: "2026-04-16T22:00:00.000Z",
      mediaUrls: [
        "https://cdn.example/story-video.mp4",
        "https://cdn.example/story-poster.jpg",
      ],
      mediaTypes: ["video", "image"],
      isVideo: true,
      isCarousel: false,
      likeCount: null,
      commentCount: null,
      hashtags: [],
      location: null,
      locationUrl: null,
      postType: "story",
    });

    expect(item?.content.mediaTypes).toEqual(["video", "image"]);
  });
});
