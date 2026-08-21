import { describe, expect, it, vi } from "vitest";
import {
  openLibraryCoreNormalizedFeedReaderV1,
  openLibraryCoreNormalizedSavedFeedReaderV1,
  readLibraryCoreNormalizedFeedSignalCountsV1,
  type LibraryCoreNormalizedQueryExecutor,
} from "./normalized-feed-readers.js";

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
        queryId: "feed_browse_page_v3",
        rankingClockMs: 100,
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
