import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  queryNormalizedLibrary: vi.fn(),
  querySqliteItems: vi.fn(),
  readSqliteItems: vi.fn(),
}));

vi.mock("./library-core-normalized-query-client", () => ({
  createDesktopLibraryCoreOperationId: (prefix: string) => `${prefix}:test`,
  queryNormalizedLibrary: mocks.queryNormalizedLibrary,
}));
vi.mock("./sqlite-library", () => ({
  querySqliteItems: mocks.querySqliteItems,
  readSqliteItems: mocks.readSqliteItems,
}));

const {
  readLibraryCoreFacetSummary,
  readLibraryCoreItemDetail,
  readLibraryCorePersonTimeline,
  readLibraryCoreSavedAnalytics,
  readLibraryCoreSurfaceItems,
} = await import("./library-core-item-detail-runtime");

const feedCard = {
  archived: false,
  authorAvatarUrl: null,
  authorDisplayName: "Ada",
  authorHandle: "ada",
  authorId: "author-1",
  capturedAt: 20,
  contentSignalTags: [],
  contentText: "Compact",
  contentType: "post",
  engagementComments: null,
  engagementLikes: null,
  eventConfidenceBasisPoints: null,
  eventStartsAt: null,
  globalId: "x:item-1",
  liked: false,
  likedAt: null,
  likedSyncedAt: null,
  linkPreviewTitle: null,
  locationName: null,
  mediaTypes: [],
  mediaUrls: [],
  platform: "x",
  publishedAt: 10,
  readAt: null,
  readingTimeMinutes: null,
  saved: false,
  sourceUrl: null,
  tags: [],
};

describe("Freed Desktop normalized surface readers", () => {
  beforeEach(() => {
    mocks.queryNormalizedLibrary.mockReset();
    mocks.querySqliteItems.mockReset();
    mocks.readSqliteItems.mockReset();
  });

  it("reads detail, facets, and Saved analytics from typed SQLite queries", async () => {
    mocks.queryNormalizedLibrary.mockImplementation(async (request) => {
      if (request.queryId === "item_detail_v1") {
        return { item: { card: feedCard } };
      }
      if (request.queryId === "library_facet_summary_v1") {
        return {
          summary: {
            archivedCount: 1,
            sampleItemCount: 2,
            savedArchivedCount: 3,
            savedCount: 4,
            savedPlatformCount: 5,
            tags: ["favorite"],
            totalCount: 6,
          },
        };
      }
      if (request.queryId === "saved_analytics_v2") {
        return {
          contentMix: [{ count: 1, label: "post" }],
          dailyCounts: [1],
          hourlyCounts: [1],
          latestSavedAt: 20,
          sourceCounts: [{ count: 1, label: "x" }],
          totalCount: 1,
        };
      }
      throw new Error("unexpected query");
    });

    await expect(readLibraryCoreItemDetail("x:item-1")).resolves.toEqual(
      expect.objectContaining({ globalId: "x:item-1" }),
    );
    await expect(readLibraryCoreFacetSummary()).resolves.toEqual(
      expect.objectContaining({ totalCount: 6 }),
    );
    await expect(
      readLibraryCoreSavedAnalytics({
        dailyWindows: Array.from({ length: 7 }, (_, index) => ({
          startMs: index,
          endMs: index + 1,
        })),
        hourlyWindows: Array.from({ length: 24 }, (_, index) => ({
          startMs: index,
          endMs: index + 1,
        })),
      }),
    ).resolves.toEqual(expect.objectContaining({ totalCount: 1 }));

    expect(mocks.queryNormalizedLibrary.mock.calls.map(([request]) => request.queryId))
      .toEqual([
        "item_detail_v1",
        "library_facet_summary_v1",
        "saved_analytics_v2",
      ]);
    expect(mocks.querySqliteItems).not.toHaveBeenCalled();
    expect(mocks.readSqliteItems).not.toHaveBeenCalled();
  });

  it("reads Map and Story Wall from their compact normalized projections", async () => {
    mocks.queryNormalizedLibrary.mockImplementation(async (request) => {
      if (request.queryId === "map_markers_v1") {
        return {
          rows: [{
            authorAvatarUrl: null,
            authorDisplayName: "Ada",
            authorHandle: "ada",
            authorId: "author-1",
            capturedAt: 20,
            contentText: "Map",
            contentType: "post",
            globalId: "x:map-1",
            locationLat: 34.2,
            locationLng: -118.2,
            locationName: "Observatory",
            locationUrl: null,
            platform: "x",
            publishedAt: 10,
            sourceUrl: null,
            timeRangeEndsAt: null,
            timeRangeStartsAt: null,
          }],
        };
      }
      return {
        rows: [{
          authorDisplayName: "Ada",
          authorHandle: "ada",
          authorId: "author-1",
          capturedAt: 20,
          contentText: "Story",
          globalId: "x:story-1",
          locationName: null,
          mediaTypes: ["image"],
          mediaUrls: ["https://example.test/image.jpg"],
          platform: "x",
          publishedAt: 10,
          sourceUrl: null,
        }],
      };
    });

    await expect(readLibraryCoreSurfaceItems("map")).resolves.toEqual([
      expect.objectContaining({ globalId: "x:map-1" }),
    ]);
    await expect(readLibraryCoreSurfaceItems("story_wall")).resolves.toEqual([
      expect.objectContaining({ globalId: "x:story-1" }),
    ]);
    expect(mocks.queryNormalizedLibrary.mock.calls.map(([request]) => request.queryId))
      .toEqual(["map_markers_v1", "story_wall_candidates_v1"]);
    expect(mocks.querySqliteItems).not.toHaveBeenCalled();
  });

  it("reads one Person timeline through the closed normalized query", async () => {
    mocks.queryNormalizedLibrary.mockResolvedValue({
      nextCursor: "cursor-2",
      rows: [feedCard],
      totalCount: 2,
    });

    await expect(
      readLibraryCorePersonTimeline({
        cursor: null,
        limit: 1,
        personId: "person-1",
      }),
    ).resolves.toEqual({
      items: [expect.objectContaining({ globalId: "x:item-1" })],
      nextCursor: "cursor-2",
      totalCount: 2,
    });
    expect(mocks.queryNormalizedLibrary).toHaveBeenCalledWith(
      expect.objectContaining({
        limit: 1,
        personId: "person-1",
        queryId: "person_timeline_v1",
      }),
    );
    expect(mocks.querySqliteItems).not.toHaveBeenCalled();
  });
});
