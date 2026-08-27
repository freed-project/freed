import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultPreferences, type FeedItem } from "@freed/shared";
import type { DocState } from "./library-types";

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

const {
  dispatchSqliteMutation,
  loadSqliteLibraryState,
  readSqliteItems,
} = await import("./sqlite-library");

function emptyState(): DocState {
  return {
    items: [],
    searchCorpusVersion: 0,
    feeds: {},
    persons: {},
    accounts: {},
    friends: {},
    preferences: createDefaultPreferences(),
    desktopClientIds: [],
    feedUnreadCounts: {},
    feedTotalCounts: {},
    totalUnreadCount: 0,
    unreadCountByPlatform: {},
    totalItemCount: 0,
    itemCountByPlatform: {},
    totalArchivableCount: 0,
    archivableCountByPlatform: {},
    archivableFeedCounts: {},
    mapFriendLocationCount: 0,
    mapAllContentLocationCount: 0,
    docItemCount: 0,
  };
}

function item(): FeedItem {
  return {
    globalId: "rss:new-item",
    platform: "rss",
    contentType: "article",
    capturedAt: 2,
    publishedAt: 1,
    author: { id: "author", handle: "author", displayName: "Author" },
    content: { text: "Bounded", mediaUrls: [], mediaTypes: [] },
    topics: [],
    userState: { hidden: false, saved: false, archived: false, tags: [] },
  };
}

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
            archivableCount: 16,
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
                totalCount: 19,
                unreadCount: 0,
              },
            ],
            rssFeedCount: 0,
            sampleAccountCount: 0,
            sampleFeedCount: 0,
            sampleItemCount: 0,
            samplePersonCount: 0,
            savedArchivedCount: 0,
            savedCount: 2,
            savedPlatformCount: 1,
            socialAccountCount: 0,
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
        searchCorpusVersion: 7,
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

  it("fails closed instead of falling back to a whole-item write", async () => {
    mocks.queryNormalizedLibrary.mockResolvedValue({ item: null });
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "normalized_library_primary_mutation_context") {
        return null;
      }
      if (command === "normalized_library_follower_mutation_context") {
        throw new Error("normalized follower actor is not active");
      }
      throw new Error(`Unexpected native command: ${command}`);
    });

    await expect(
      dispatchSqliteMutation(
        { reqId: 1, type: "ADD_FEED_ITEM", item: item() },
        emptyState(),
      ),
    ).rejects.toThrow(/whole-item upsert is unavailable/);
  });
});
