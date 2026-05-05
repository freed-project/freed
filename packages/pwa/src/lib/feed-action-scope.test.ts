import { describe, expect, it } from "vitest";
import type { FeedItem } from "@freed/shared";
import { getFeedActionScope, getFeedArchiveCounts } from "../../../ui/src/lib/feed-action-scope";

function makeItem(globalId: string, userState: Partial<FeedItem["userState"]> = {}): FeedItem {
  return {
    globalId,
    platform: "rss",
    sourceUrl: `https://example.com/${globalId}`,
    author: {
      id: "source",
      displayName: "Source",
      handle: "source",
    },
    content: {
      text: globalId,
      mediaUrls: [],
      mediaTypes: [],
    },
    userState: {
      hidden: false,
      saved: false,
      archived: false,
      liked: false,
      tags: [],
      highlights: [],
      ...userState,
    },
    topics: [],
    contentType: "post",
    capturedAt: 1,
    publishedAt: 1,
  } as FeedItem;
}

describe("feed action scope", () => {
  it("collects unread and archivable IDs in one cached pass", () => {
    const items = [
      makeItem("unread"),
      makeItem("read", { readAt: 1 }),
      makeItem("saved-read", { readAt: 1, saved: true }),
      makeItem("hidden", { hidden: true }),
      makeItem("archived", { archived: true }),
    ];

    const scope = getFeedActionScope(items);

    expect(scope.unreadItemIds).toEqual(["unread"]);
    expect(scope.archivableItemIds).toEqual(["read"]);
    expect(scope.unreadCount).toBe(1);
    expect(scope.archivableCount).toBe(1);
    expect(getFeedActionScope(items)).toBe(scope);
  });

  it("counts saved archived items separately from plain archived items", () => {
    const items = [
      makeItem("active"),
      makeItem("archived", { archived: true }),
      makeItem("saved-archived", { archived: true, saved: true }),
    ];

    const counts = getFeedArchiveCounts(items);

    expect(counts).toEqual({ archivedCount: 1, savedArchivedCount: 1 });
    expect(getFeedArchiveCounts(items)).toBe(counts);
  });
});
