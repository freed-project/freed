import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FeedItem } from "@freed/shared";

const mocks = vi.hoisted(() => ({
  queryNormalizedLibrary: vi.fn(),
}));

vi.mock("./library-core-normalized-query-client", () => ({
  createDesktopLibraryCoreOperationId: (prefix: string) => `${prefix}:test`,
  queryNormalizedLibrary: mocks.queryNormalizedLibrary,
}));
const {
  readLibraryCoreFacetSummary,
  readLibraryCoreItemDetail,
  readLibraryCorePersonTimeline,
  readLibraryCoreSavedAnalytics,
  readLibraryCoreSurfaceItems,
  scanLibraryCoreItems,
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
            archivableCount: 0,
            enabledRssFeedCount: 0,
            friendPersonCount: 0,
            platformCounts: [
              {
                archivableCount: 0,
                platform: "rss",
                totalCount: 6,
                unreadCount: 0,
              },
            ],
            rssFeedCount: 0,
            sampleAccountCount: 0,
            sampleFeedCount: 0,
            sampleItemCount: 2,
            samplePersonCount: 0,
            savedArchivedCount: 3,
            savedCount: 4,
            savedPlatformCount: 5,
            socialAccountCount: 0,
            tags: ["favorite"],
            totalCount: 6,
            unreadCount: 0,
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

    expect(
      mocks.queryNormalizedLibrary.mock.calls.map(
        ([request]) => request.queryId,
      ),
    ).toEqual([
      "item_detail_v1",
      "library_facet_summary_v1",
      "saved_analytics_v2",
    ]);
  });

  it("reads Map and Story Wall from their compact normalized projections", async () => {
    mocks.queryNormalizedLibrary.mockImplementation(async (request) => {
      if (request.queryId === "map_markers_v1") {
        return {
          rows: [
            {
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
            },
          ],
        };
      }
      return {
        rows: [
          {
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
          },
        ],
      };
    });

    await expect(readLibraryCoreSurfaceItems("map")).resolves.toEqual([
      expect.objectContaining({ globalId: "x:map-1" }),
    ]);
    await expect(readLibraryCoreSurfaceItems("story_wall")).resolves.toEqual([
      expect.objectContaining({ globalId: "x:story-1" }),
    ]);
    expect(
      mocks.queryNormalizedLibrary.mock.calls.map(
        ([request]) => request.queryId,
      ),
    ).toEqual(["map_markers_v1", "story_wall_candidates_v1"]);
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
  });

  it("reads one unlinked Account timeline through the closed normalized query", async () => {
    mocks.queryNormalizedLibrary.mockResolvedValue({
      nextCursor: null,
      rows: [feedCard],
      totalCount: 1,
    });

    await expect(
      readLibraryCorePersonTimeline({
        accountId: "account-1",
        cursor: null,
        limit: 1,
      }),
    ).resolves.toEqual({
      items: [expect.objectContaining({ globalId: "x:item-1" })],
      nextCursor: null,
      totalCount: 1,
    });
    expect(mocks.queryNormalizedLibrary).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: "account-1",
        limit: 1,
        queryId: "account_timeline_v1",
      }),
    );
  });

  it("scans filtered background windows without the historical item reader", async () => {
    mocks.queryNormalizedLibrary.mockResolvedValue({
      nextCursor: null,
      rows: [
        {
          ...feedCard,
          hidden: false,
          linkPreviewTitle: "Article",
          rssSource: null,
          sampleDataFingerprint: null,
          sourceUrl: "https://example.test/article",
        },
      ],
    });
    const pages: FeedItem[][] = [];

    await scanLibraryCoreItems(
      (items) => {
        pages.push([...items]);
      },
      { hasLinkPreview: true },
    );

    expect(pages).toEqual([
      [expect.objectContaining({ globalId: "x:item-1" })],
    ]);
    expect(mocks.queryNormalizedLibrary).toHaveBeenCalledWith(
      expect.objectContaining({ queryId: "background_item_page_v1" }),
    );
  });
});
