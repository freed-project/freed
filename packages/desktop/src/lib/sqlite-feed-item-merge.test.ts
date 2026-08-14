import { describe, expect, it } from "vitest";
import type { FeedItem } from "@freed/shared";
import { mergeSqliteFeedItem } from "./sqlite-feed-item-merge";

function item(overrides: Partial<FeedItem> = {}): FeedItem {
  return {
    globalId: "rss:item-1",
    platform: "rss",
    contentType: "post",
    publishedAt: 200,
    capturedAt: 200,
    author: { id: "author", displayName: "Author", handle: "author" },
    content: { text: "original", mediaUrls: [], mediaTypes: [] },
    topics: [],
    userState: {
      hidden: false,
      saved: false,
      archived: false,
      liked: false,
      tags: [],
    },
    ...overrides,
  };
}

describe("SQLite repeated-capture merge", () => {
  it("preserves local state while accepting richer provider content", () => {
    const current = item({
      content: { text: "short", mediaUrls: [], mediaTypes: [] },
      userState: {
        hidden: false,
        saved: true,
        savedAt: 100,
        archived: false,
        liked: true,
        likedAt: 300,
        likedSyncedAt: -1,
        tags: ["mine"],
      },
    });
    const incoming = item({
      capturedAt: 400,
      content: {
        text: "a much richer provider capture",
        mediaUrls: ["https://example.com/image.jpg"],
        mediaTypes: ["image"],
      },
      userState: {
        hidden: false,
        saved: false,
        archived: false,
        liked: true,
        likedAt: 200,
        likedSyncedAt: 500,
        tags: ["provider"],
      },
    });

    const merged = mergeSqliteFeedItem(current, incoming);
    expect(merged.content.text).toBe("a much richer provider capture");
    expect(merged.userState.saved).toBe(true);
    expect(merged.userState.savedAt).toBe(100);
    expect(merged.userState.likedAt).toBe(300);
    expect(merged.userState.likedSyncedAt).toBe(-1);
    expect(merged.userState.tags).toEqual(["mine", "provider"]);
  });
});
