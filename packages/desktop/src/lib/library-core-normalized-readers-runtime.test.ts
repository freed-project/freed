import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FeedItem } from "@freed/shared";

const mocks = vi.hoisted(() => ({
  mutateNormalizedContentPolicy: vi.fn(),
  queryNormalizedLibrary: vi.fn(),
}));

const QUERY_SOURCE = Object.freeze({
  generationId: "a".repeat(64),
  projectionRevision: 7,
  transitionSequence: 0,
});

function mockSurfaceQuery(
  handler: (request: {
    readonly queryId: string;
  }) => unknown | Promise<unknown>,
): void {
  mocks.queryNormalizedLibrary.mockImplementation(async (request) =>
    request.queryId === "optimistic_fields_v1"
      ? {
          queryId: request.queryId,
          rows: [],
          schemaVersion: 1,
          source: QUERY_SOURCE,
        }
      : handler(request),
  );
}

vi.mock("./library-core-normalized-query-client", () => ({
  createDesktopLibraryCoreOperationId: (prefix: string) => `${prefix}:test`,
  mutateNormalizedContentPolicy: mocks.mutateNormalizedContentPolicy,
  queryNormalizedLibrary: mocks.queryNormalizedLibrary,
}));
const {
  readLibraryCoreFacetSummary,
  readLibraryCoreItemDetail,
  pinLibraryCoreItemContent,
  readLibraryCoreMapCandidates,
  readLibraryCorePersonTimeline,
  readLibraryCoreSavedAnalytics,
  readLibraryCoreStoryWallCandidates,
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
    mocks.mutateNormalizedContentPolicy.mockReset();
    mocks.queryNormalizedLibrary.mockReset();
  });

  it("reads detail, facets, and Saved analytics from typed SQLite queries", async () => {
    mockSurfaceQuery(async (request) => {
      if (request.queryId === "item_detail_v1") {
        return {
          item: {
            card: feedCard,
            contentBody: { blobDigest: null, storage: "inline" },
            mediaBlobDigests: [],
            preservedBody: { blobDigest: null, storage: "none" },
          },
          source: QUERY_SOURCE,
        };
      }
      if (request.queryId === "library_facet_summary_v1") {
        return {
          summary: {
            archivedCount: 1,
            archivableCount: 0,
            contactAccountCount: 0,
            contactLinkedPersonCount: 0,
            enabledRssFeedCount: 0,
            friendPersonCount: 0,
            latestContactImportedAt: null,
            latestRssFeedFetchedAt: null,
            platformCounts: [
              {
                archivableCount: 0,
                latestCapturedAt: 1,
                latestPublishedAt: 1,
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
      "optimistic_fields_v1",
      "library_facet_summary_v1",
      "saved_analytics_v2",
    ]);
  });

  it("pins distinct selected-item blob descriptors through native SQLite", async () => {
    const bodyDigest = "a".repeat(64);
    const mediaDigest = "b".repeat(64);
    mockSurfaceQuery(async () => ({
      item: {
        card: {
          ...feedCard,
          mediaTypes: ["video", "image"],
          mediaUrls: [
            "https://example.com/video.mp4",
            "https://example.com/image.jpg",
          ],
        },
        contentBody: { blobDigest: bodyDigest, storage: "blob" },
        mediaBlobDigests: [mediaDigest, bodyDigest],
        preservedBody: { blobDigest: bodyDigest, storage: "blob" },
      },
      source: QUERY_SOURCE,
    }));

    await pinLibraryCoreItemContent("x:item-1", 1_234);

    expect(mocks.mutateNormalizedContentPolicy.mock.calls).toEqual([
      [
        {
          contentDigest: bodyDigest,
          policy: "pinned_offline",
          schemaVersion: 1,
          updatedAt: 1_234,
        },
      ],
      [
        {
          contentDigest: mediaDigest,
          policy: "pinned_offline",
          schemaVersion: 1,
          updatedAt: 1_234,
        },
      ],
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
              friendAvatarUrl: null,
              friendName: "Ada Friend",
              friendPersonId: "person-1",
              friendRelationshipStatus: "friend",
              globalId: "x:map-1",
              linkedAccountId: "account-1",
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
            linkedAccountId: "account-1",
            linkedPersonId: "person-1",
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

    await expect(readLibraryCoreMapCandidates()).resolves.toEqual([
      expect.objectContaining({
        friend: expect.objectContaining({ id: "person-1" }),
        item: expect.objectContaining({ globalId: "x:map-1" }),
      }),
    ]);
    await expect(readLibraryCoreStoryWallCandidates()).resolves.toEqual([
      expect.objectContaining({
        accountId: "account-1",
        item: expect.objectContaining({ globalId: "x:story-1" }),
        personId: "person-1",
      }),
    ]);
    expect(
      mocks.queryNormalizedLibrary.mock.calls.map(
        ([request]) => request.queryId,
      ),
    ).toEqual(["map_markers_v1", "story_wall_candidates_v1"]);
  });

  it("reads one Person timeline through the closed normalized query", async () => {
    mockSurfaceQuery(async () => ({
      nextCursor: "cursor-2",
      rows: [feedCard],
      source: QUERY_SOURCE,
      totalCount: 2,
    }));

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
    mockSurfaceQuery(async () => ({
      nextCursor: null,
      rows: [feedCard],
      source: QUERY_SOURCE,
      totalCount: 1,
    }));

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
          rankingCareLevel: null,
          rankingEngagementReposts: null,
          rankingEngagementViews: null,
          rssSource: null,
          sampleDataFingerprint: null,
          sourceUrl: "https://example.test/article",
          topics: [],
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
