import { describe, expect, it, vi } from "vitest";
import {
  openLibraryCoreNormalizedFeedReaderV1,
  openLibraryCoreNormalizedSavedFeedReaderV1,
  readLibraryCoreNormalizedFeedSignalCountsV1,
  type LibraryCoreNormalizedQueryExecutor,
} from "./normalized-feed-readers.js";
import { searchLibraryCoreNormalizedItemsV1 } from "./normalized-surface-readers.js";

const feedCard = (globalId: string) => ({
  archived: false,
  authorAvatarUrl: null,
  authorDisplayName: "Reader",
  authorHandle: "reader",
  authorId: "reader-1",
  capturedAt: 200,
  contentSignalTags: [],
  contentText: "Bounded row",
  contentType: "post",
  engagementComments: null,
  engagementLikes: null,
  eventConfidenceBasisPoints: null,
  eventStartsAt: null,
  globalId,
  liked: false,
  likedAt: null,
  likedSyncedAt: null,
  linkPreviewTitle: null,
  locationName: null,
  mediaTypes: [],
  mediaUrls: [],
  platform: "rss",
  publishedAt: 100,
  readAt: null,
  readingTimeMinutes: null,
  saved: false,
  sourceUrl: "https://example.com/item",
  tags: [],
});

describe("cross-platform normalized feed readers", () => {
  it("streams source-fenced SQLite search pages without retaining a corpus", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        nextCursor: "opaque-search-next",
        rows: [{ card: feedCard("match"), priority: 91, score: 12 }],
      })
      .mockResolvedValueOnce({ nextCursor: null, rows: [] }) as unknown as LibraryCoreNormalizedQueryExecutor;
    const visit = vi.fn(() => "continue" as const);

    await searchLibraryCoreNormalizedItemsV1(
      { query, randomId: () => "test" },
      {
        filter: { platform: "rss" },
        identityMode: "friends",
        query: "bounded",
      },
      visit,
    );

    expect(query).toHaveBeenCalledTimes(2);
    expect(query).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        cursor: null,
        identityMode: "friends",
        queryId: "search_page_v1",
      }),
    );
    expect(query).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ cursor: "opaque-search-next" }),
    );
    expect(visit).toHaveBeenCalledWith([
      expect.objectContaining({
        item: expect.objectContaining({ globalId: "match", priority: 91 }),
        score: 12,
      }),
    ]);
  });

  it("uses opaque bidirectional pages without platform storage logic", async () => {
    const query = vi.fn(async () => ({
      rows: [feedCard("first")],
      nextCursor: "opaque-next",
      previousCursor: null,
      totalCount: 2,
    })) as unknown as LibraryCoreNormalizedQueryExecutor;
    const reader = await openLibraryCoreNormalizedFeedReaderV1(
      { query, randomId: () => "test" },
      { platform: "rss" },
      100,
    );

    expect(reader.totalCount).toBe(2);
    await expect(reader.readPage(null, "next")).resolves.toEqual({
      items: [expect.objectContaining({ globalId: "first" })],
      nextCursor: "opaque-next",
      previousCursor: null,
    });
    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({
        identityMode: "all_content",
        queryId: "feed_browse_page_v3",
        rankingClockMs: 100,
      }),
    );
  });

  it("binds Friends to the closed SQLite identity predicate", async () => {
    const query = vi.fn(async () => ({
      rows: [feedCard("friend")],
      nextCursor: null,
      previousCursor: null,
      totalCount: 1,
    })) as unknown as LibraryCoreNormalizedQueryExecutor;

    await openLibraryCoreNormalizedFeedReaderV1(
      { query, randomId: () => "test" },
      {},
      100,
      "friends",
    );

    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({
        friendsPredicateSchemaVersion: 1,
        identityMode: "friends",
        queryId: "feed_browse_page_v3",
      }),
    );
  });

  it("preserves Saved metadata through the shared reader", async () => {
    const query = vi.fn(async () => ({
      rows: [{ ...feedCard("saved"), saved: true, savedAt: 150 }],
      nextCursor: null,
      previousCursor: null,
      totalCount: 1,
    })) as unknown as LibraryCoreNormalizedQueryExecutor;
    const reader = await openLibraryCoreNormalizedSavedFeedReaderV1(
      { query, randomId: () => "test" },
      {},
      "date_saved",
    );

    await expect(reader.readNext()).resolves.toEqual([
      expect.objectContaining({
        userState: expect.objectContaining({ saved: true, savedAt: 150 }),
      }),
    ]);
    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({
        queryId: "saved_feed_page_v2",
        sortMode: "date_saved",
      }),
    );
  });

  it("derives all signal counts through the same normalized executor", async () => {
    const query = vi.fn(async () => ({
      totalCount: 42,
    })) as unknown as LibraryCoreNormalizedQueryExecutor;
    const counts = await readLibraryCoreNormalizedFeedSignalCountsV1(
      { query, randomId: () => "test" },
      { platform: "rss" },
      100,
    );

    expect(counts.all).toBe(42);
    expect(query).toHaveBeenCalledTimes(6);
    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({
        limit: 1,
        queryId: "feed_browse_page_v3",
      }),
    );
  });
});
