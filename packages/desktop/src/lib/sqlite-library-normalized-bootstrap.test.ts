import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  queryNormalizedLibrary: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
  isTauri: () => true,
}));

vi.mock("./library-core-normalized-query-client", () => ({
  queryNormalizedLibrary: mocks.queryNormalizedLibrary,
}));

const { loadSqliteLibraryState, readSqliteItems } = await import(
  "./sqlite-library"
);

describe("Freed Desktop normalized bootstrap projection", () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
    mocks.queryNormalizedLibrary.mockReset();
  });

  it("loads only bounded facets and preferences without reading a shell", async () => {
    mocks.queryNormalizedLibrary.mockImplementation(async (request) => {
      if (request.queryId === "library_facet_summary_v1") {
        return {
          queryId: request.queryId,
          schemaVersion: request.schemaVersion,
          source: {
            generationId: "1".repeat(64),
            projectionRevision: 7,
            transitionSequence: 11,
          },
          summary: {
            archivedCount: 3,
            archivableCount: 0,
            platformCounts: [
              {
                archivableCount: 0,
                platform: "rss",
                totalCount: 19,
                unreadCount: 0,
              },
            ],
            sampleAccountCount: 0,
            sampleFeedCount: 0,
            sampleItemCount: 0,
            samplePersonCount: 0,
            savedArchivedCount: 0,
            savedCount: 2,
            savedPlatformCount: 1,
            tags: [],
            totalCount: 19,
            unreadCount: 0,
          },
        };
      }
      if (request.queryId === "preferences_snapshot_v1") {
        return {
          queryId: request.queryId,
          schemaVersion: request.schemaVersion,
          source: {
            generationId: "1".repeat(64),
            projectionRevision: 7,
            transitionSequence: 11,
          },
          rows: [],
        };
      }
      throw new Error("unexpected normalized query");
    });

    await expect(loadSqliteLibraryState()).resolves.toEqual(
      expect.objectContaining({
        accounts: {},
        docItemCount: 19,
        feeds: {},
        items: [],
        persons: {},
        searchCorpusVersion: 11,
        totalArchivableCount: 16,
        totalItemCount: 19,
      }),
    );
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(
      mocks.queryNormalizedLibrary.mock.calls.map(
        ([request]) => request.queryId,
      ),
    ).toEqual(["library_facet_summary_v1", "preferences_snapshot_v1"]);
  });

  it("reads exact items through normalized detail instead of historical rows", async () => {
    mocks.queryNormalizedLibrary.mockResolvedValue({
      item: {
        card: {
          archived: false,
          authorAvatarUrl: null,
          authorDisplayName: "Ada",
          authorHandle: "ada",
          authorId: "author-1",
          capturedAt: 20,
          contentSignalTags: [],
          contentText: "Bounded",
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
        },
      },
    });

    await expect(readSqliteItems(["x:item-1"])).resolves.toEqual([
      expect.objectContaining({ globalId: "x:item-1" }),
    ]);
    expect(mocks.queryNormalizedLibrary).toHaveBeenCalledWith(
      expect.objectContaining({
        globalId: "x:item-1",
        queryId: "item_detail_v1",
      }),
    );
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});
