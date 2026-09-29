import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FeedItem } from "@freed/shared";
import { createLibraryCoreNormalizedCheckpointRecordV2, encodeLibraryCoreNormalizedCheckpointRecordV2 } from "@freed/shared/library-core";

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

const { dispatchSqliteMutation, loadSqliteLibraryState, readSqliteItems,
  beginNormalizedLibraryCheckpointExport, readNormalizedLibraryCheckpointPage,
  readNormalizedLibraryConsumerRecovery, prepareNormalizedLibraryConsumerRecovery, commitNormalizedLibraryConsumerRecovery } =
  await import("./sqlite-library");

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

  it("keeps the sealed handoff identity on every checkpoint IPC and rejects malformed identities", async () => {
    const handoffId = "a".repeat(64);
    const snapshot = {
      format: "freed_normalized_checkpoint_export_v2", protocolVersion: 2,
      libraryId: "b".repeat(64), authorityEpoch: "c".repeat(64), writerId: "d".repeat(64),
      sourceRevision: 7, causalFrontierDigest: "e".repeat(64), recordCount: 1, itemCount: 0,
    };
    const record = createLibraryCoreNormalizedCheckpointRecordV2({
      registryKey: "00_checkpoint_header", primaryKey: "checkpoint",
      payload: { authorityEpoch: snapshot.authorityEpoch, checkpointId: "fixture", createdAtMs: 1,
        libraryId: snapshot.libraryId, schemaVersion: 1, sourceRevision: 7 },
    });
    mocks.invoke.mockImplementation(async (command: string) => command === "begin_normalized_library_checkpoint_export"
      ? snapshot : { records: [record], nextCursor: null, done: true,
        canonicalRecordBytes: encodeLibraryCoreNormalizedCheckpointRecordV2(record).byteLength });
    const pinned = await beginNormalizedLibraryCheckpointExport(handoffId);
    await readNormalizedLibraryCheckpointPage({ snapshot: pinned, after: null, handoffId });
    expect(mocks.invoke).toHaveBeenNthCalledWith(1, "begin_normalized_library_checkpoint_export", { handoffId });
    expect(mocks.invoke).toHaveBeenNthCalledWith(2, "read_normalized_library_checkpoint_page", expect.objectContaining({ handoffId }));
    await expect(beginNormalizedLibraryCheckpointExport("invalid")).rejects.toThrow("Invalid handoff identity");
    await expect(readNormalizedLibraryCheckpointPage({ snapshot: pinned, after: null, handoffId: "invalid" })).rejects.toThrow("Invalid handoff identity");
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
    await beginNormalizedLibraryCheckpointExport();
    expect(mocks.invoke).toHaveBeenLastCalledWith("begin_normalized_library_checkpoint_export");
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

    const state = await loadSqliteLibraryState();
    expect(state).toEqual(
      expect.objectContaining({
        searchCorpusVersion: 7,
        totalArchivableCount: 16,
        totalItemCount: 19,
      }),
    );
    expect(state).not.toHaveProperty("items");
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(
      mocks.queryNormalizedLibrary.mock.calls.map(
        ([request]) => request.queryId,
      ),
    ).toEqual(["library_facet_summary_v1", "preferences_snapshot_v1"]);
  });

  it("reads exact items through normalized detail instead of historical rows", async () => {
    const source = {
      generationId: "1".repeat(64),
      projectionRevision: 7,
      transitionSequence: 11,
    };
    mocks.queryNormalizedLibrary.mockImplementation(async (request) =>
      request.queryId === "optimistic_fields_v1"
        ? {
            queryId: request.queryId,
            rows: [],
            schemaVersion: 1,
            source,
          }
        : request.queryId === "item_annotations_v1"
          ? {
              queryId: request.queryId,
              schemaVersion: 1,
              globalId: request.globalId,
              source,
              tags: [],
              highlights: [],
            }
          : {
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
                contentBody: { blobDigest: null, storage: "inline" },
                mediaBlobDigests: [],
                preservedBody: { blobDigest: null, storage: "none" },
              },
              source,
            },
    );

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
      dispatchSqliteMutation({ reqId: 1, type: "ADD_FEED_ITEM", item: item() }),
    ).rejects.toThrow(
      /Normalized SQLite FeedItem mutation context is required/,
    );
  });
});

it("validates bounded native recovery metadata and sends no renderer clock or witness", async () => {
  const summary = { recoveryId: "a".repeat(64), libraryId: "b".repeat(64), predecessorEpochId: "c".repeat(64),
    successorEpochId: "d".repeat(64), state: "prepared", archivedPendingEdits: 4, archivedPublishedEdits: 2 };
  mocks.invoke.mockResolvedValue(summary);
  await expect(prepareNormalizedLibraryConsumerRecovery()).resolves.toEqual(summary);
  expect(mocks.invoke).toHaveBeenLastCalledWith("prepare_normalized_library_consumer_recovery");
  await expect(commitNormalizedLibraryConsumerRecovery(summary.recoveryId)).resolves.toEqual(summary);
  expect(mocks.invoke).toHaveBeenLastCalledWith("commit_normalized_library_consumer_recovery", { recoveryId: summary.recoveryId });
  mocks.invoke.mockResolvedValue({ ...summary, archivedPendingEdits: Number.MAX_SAFE_INTEGER + 1 });
  await expect(readNormalizedLibraryConsumerRecovery()).rejects.toThrow("Invalid consumer recovery summary");
  mocks.invoke.mockResolvedValue({ ...summary, unexpected: true });
  await expect(readNormalizedLibraryConsumerRecovery()).rejects.toThrow("Invalid consumer recovery summary");
  await expect(commitNormalizedLibraryConsumerRecovery("invalid")).rejects.toThrow("Invalid consumer recovery identity");
});
