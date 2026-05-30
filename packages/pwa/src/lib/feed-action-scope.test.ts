import { describe, expect, it } from "vitest";
import type { FeedItem } from "@freed/shared";
import {
  collectArchivableFeedActionIds,
  collectUnreadFeedActionIds,
  getFeedActionCounts,
  getFeedArchiveCounts,
} from "../../../ui/src/lib/feed-action-scope";

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
  it("counts bulk action candidates without collecting IDs during render", () => {
    const items = [
      makeItem("unread"),
      makeItem("read", { readAt: 1 }),
      makeItem("saved-read", { readAt: 1, saved: true }),
      makeItem("hidden", { hidden: true }),
      makeItem("archived", { archived: true }),
    ];

    const counts = getFeedActionCounts(items);

    expect(counts).toEqual({ unreadCount: 1, archivableCount: 1 });
    expect(getFeedActionCounts(items)).toBe(counts);
    expect(collectUnreadFeedActionIds(items)).toEqual(["unread"]);
    expect(collectArchivableFeedActionIds(items)).toEqual(["read"]);
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
