import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  queryNormalizedLibrary: vi.fn(),
  querySqliteItems: vi.fn(),
}));

vi.mock("./library-core-normalized-query-client", () => ({
  queryNormalizedLibrary: mocks.queryNormalizedLibrary,
}));
vi.mock("./sqlite-library", () => ({
  querySqliteItems: mocks.querySqliteItems,
}));
vi.mock("./library-client", () => ({
  getDocState: vi.fn(() => null),
}));

const {
  openBoundedDesktopFeedReader,
  openSortedSqliteFeedReader,
  readDesktopFeedSignalCounts,
} = await import("./library-core-feed-browse-reader-runtime");

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

describe("normalized SQLite bounded feed reader", () => {
  beforeEach(() => {
    mocks.queryNormalizedLibrary.mockReset();
    mocks.querySqliteItems.mockReset();
  });

  it("opens the ordinary feed through the typed normalized query boundary", async () => {
    mocks.queryNormalizedLibrary.mockResolvedValue({
      rows: [feedCard("first")],
      nextCursor: "opaque-next",
      previousCursor: null,
      totalCount: 20_085,
    });

    const reader = await openBoundedDesktopFeedReader(
      {
        socialContentFilter: "posts",
        signals: ["essay"],
        tags: ["favorite"],
      },
      123_456,
    );

    expect(reader.totalCount).toBe(20_085);
    expect(mocks.queryNormalizedLibrary).toHaveBeenCalledOnce();
    expect(mocks.queryNormalizedLibrary).toHaveBeenCalledWith(
      expect.objectContaining({
        cursor: null,
        direction: "next",
        limit: 64,
        queryId: "feed_browse_page_v3",
        rankingClockMs: 123_456,
        schemaVersion: 3,
        filter: expect.objectContaining({
          archivedOnly: false,
          signals: ["essay"],
          socialContentFilter: "posts",
          tags: ["favorite"],
        }),
      }),
    );

    await expect(reader.readPage(null, "next")).resolves.toEqual({
      items: [expect.objectContaining({ globalId: "first" })],
      nextCursor: "opaque-next",
      previousCursor: null,
    });
    expect(mocks.queryNormalizedLibrary).toHaveBeenCalledOnce();
    expect(mocks.querySqliteItems).not.toHaveBeenCalled();
  });

  it("reads Saved through its normalized keyset query", async () => {
    mocks.queryNormalizedLibrary.mockResolvedValue({
      rows: [{ ...feedCard("saved"), saved: true, savedAt: 150 }],
      nextCursor: null,
      previousCursor: null,
      totalCount: 1,
    });

    const reader = await openSortedSqliteFeedReader({}, "date_saved");

    await expect(reader.readNext()).resolves.toEqual([
      expect.objectContaining({
        globalId: "saved",
        userState: expect.objectContaining({ saved: true, savedAt: 150 }),
      }),
    ]);
    expect(mocks.queryNormalizedLibrary).toHaveBeenCalledWith(
      expect.objectContaining({
        direction: "next",
        queryId: "saved_feed_page_v2",
        schemaVersion: 2,
        sortMode: "date_saved",
        filter: expect.objectContaining({ savedOnly: true }),
      }),
    );
    expect(mocks.querySqliteItems).not.toHaveBeenCalled();
  });

  it("counts signal presets without the historical item query", async () => {
    mocks.queryNormalizedLibrary.mockResolvedValue({
      rows: [],
      nextCursor: null,
      previousCursor: null,
      totalCount: 42,
    });

    const counts = await readDesktopFeedSignalCounts({ platform: "rss" });

    expect(counts.all).toBe(42);
    expect(mocks.queryNormalizedLibrary).toHaveBeenCalledTimes(6);
    for (const [request] of mocks.queryNormalizedLibrary.mock.calls) {
      expect(request).toEqual(expect.objectContaining({
        limit: 1,
        queryId: "feed_browse_page_v3",
        filter: expect.objectContaining({ platform: "rss" }),
      }));
    }
    expect(mocks.querySqliteItems).not.toHaveBeenCalled();
  });
});
