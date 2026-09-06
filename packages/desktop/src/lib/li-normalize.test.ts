import { describe, expect, it } from "vitest";
import { liPostToFeedItem, type RawLiPost } from "@freed/capture-linkedin/browser";
import { sanitizeFeedItemCaptureWrite } from "@freed/shared";
import { FEED_ITEM_CAPTURE_UPSERT_PAYLOAD_SCHEMA } from "@freed/shared/library-core";

describe("LinkedIn capture media pairing", () => {
  it.each([
    { mediaUrls: [], expectedTypes: [] },
    { mediaUrls: ["https://cdn.example/poster.jpg", "https://cdn.example/poster.jpg"], expectedTypes: ["video", "image"] },
  ])("admits a video marker only alongside an existing URL: $mediaUrls", ({ mediaUrls, expectedTypes }) => {
    const post: RawLiPost = {
      urn: "urn:li:activity:123", url: "https://www.linkedin.com/feed/update/urn:li:activity:123/",
      authorName: "Ada Example", authorHeadline: null,
      authorProfileUrl: "https://www.linkedin.com/in/ada-example/", authorAvatarUrl: null,
      text: "A video post", timestampIso: "2026-09-01T00:00:00.000Z", timestampRelative: null,
      mediaUrls, hasVideo: true, articleUrl: "https://example.com/article", articleTitle: "Article",
      reactionCount: 1, commentCount: null, repostCount: null, hashtags: [],
      isRepost: false, repostedFrom: null, postType: "post",
    };
    const item = liPostToFeedItem(post);
    expect(item).not.toBeNull();
    expect(item!.content.mediaUrls).toEqual(mediaUrls);
    expect(item!.content.mediaTypes).toEqual(expectedTypes);
    expect(item!.content.linkPreview).toEqual({ url: post.articleUrl, title: post.articleTitle });
    expect(FEED_ITEM_CAPTURE_UPSERT_PAYLOAD_SCHEMA.validate({
      item: sanitizeFeedItemCaptureWrite(item!),
    })).toMatchObject({ ok: true });
  });
});
