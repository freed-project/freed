import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultPreferences } from "@freed/shared";
import { createLibraryCoreImmutableObjectKey } from "@freed/shared/library-core";

const mocks = vi.hoisted(() => ({
  commitReadAssignments: vi.fn(),
  commitUserStateAssignments: vi.fn(),
  commitFeedItemCaptures: vi.fn(),
  commitFeedItemRemove: vi.fn(),
  commitRssFeedUpsert: vi.fn(),
  commitRssFeedRemove: vi.fn(),
  commitRssFeedRemoves: vi.fn(),
  commitRssFeedTitleAssignment: vi.fn(),
  commitPreferencesPatch: vi.fn(),
  commitPersonUpserts: vi.fn(),
  commitPersonRemove: vi.fn(),
  commitAccountUpserts: vi.fn(),
  commitAccountRemove: vi.fn(),
  readNormalizedCheckpointReceipt: vi.fn(),
  describeNormalizedCheckpointExport: vi.fn(),
  readNormalizedCheckpointExportPage: vi.fn(),
  readFollowerTransportContext: vi.fn(),
  createNormalizedCheckpointWriter: vi.fn(),
  createCloudAdapter: vi.fn(),
  createFollowerTransport: vi.fn(),
  discoverControl: vi.fn(),
  importCheckpoint: vi.fn(),
  syncFollower: vi.fn(),
  queryNormalizedLibrary: vi.fn(),
  mutateContentPolicy: vi.fn(),
  resetNormalizedLibrary: vi.fn(),
  prepareFollowerEnrollment: vi.fn(),
  beginScopeAction: vi.fn(),
  closeScopeAction: vi.fn(),
  pageScopeAction: vi.fn(),
}));

vi.mock("./library-core-pwa-follower-mutations", () => ({
  PWA_LIBRARY_CORE_SQLITE_CAPTURE_BATCH_LIMIT: 32,
  PWA_LIBRARY_CORE_SQLITE_RECORD_BATCH_LIMIT: 256,
  commitPwaLibraryCoreAccountRemove: mocks.commitAccountRemove,
  commitPwaLibraryCoreAccountUpserts: mocks.commitAccountUpserts,
  commitPwaLibraryCoreFeedItemCaptures: mocks.commitFeedItemCaptures,
  commitPwaLibraryCoreFeedItemRemove: mocks.commitFeedItemRemove,
  commitPwaLibraryCorePersonRemove: mocks.commitPersonRemove,
  commitPwaLibraryCorePersonUpserts: mocks.commitPersonUpserts,
  commitPwaLibraryCorePreferencesPatch: mocks.commitPreferencesPatch,
  commitPwaLibraryCoreReadAssignments: mocks.commitReadAssignments,
  commitPwaLibraryCoreRssFeedRemove: mocks.commitRssFeedRemove,
  commitPwaLibraryCoreRssFeedRemoves: mocks.commitRssFeedRemoves,
  commitPwaLibraryCoreRssFeedTitleAssignment:
    mocks.commitRssFeedTitleAssignment,
  commitPwaLibraryCoreRssFeedUpsert: mocks.commitRssFeedUpsert,
  commitPwaLibraryCoreUserStateAssignments: mocks.commitUserStateAssignments,
}));

vi.mock("@freed/sync/cloud/library-core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@freed/sync/cloud/library-core")>()),
  createGoogleDriveLibraryCoreAdapterV1: mocks.createCloudAdapter,
  createGoogleDriveLibraryCoreNormalizedFollowerTransportV2:
    mocks.createFollowerTransport,
  discoverPublishedGoogleDriveLibraryCoreControlV1: mocks.discoverControl,
  importLibraryCoreNormalizedCheckpointV2: mocks.importCheckpoint,
}));

vi.mock("./library-core-pwa-follower-sync", () => ({
  syncPwaLibraryCoreFollowerV2: mocks.syncFollower,
}));

vi.mock("./library-core-pwa-normalized-checkpoint-writer", () => ({
  createPwaNormalizedCheckpointWriter: mocks.createNormalizedCheckpointWriter,
}));

vi.mock("./library-core-pwa-follower-enrollment", () => ({
  preparePwaLibraryCoreFollowerEnrollment: mocks.prepareFollowerEnrollment,
}));

vi.mock("./factory-reset-coordinator", () => ({
  registerPwaFactoryResetQuiesceHandler: vi.fn(),
}));

vi.mock("./library-core-sqlite-runtime", () => ({
  activatePwaNormalizedCheckpointStage: vi.fn(),
  appendPwaNormalizedCheckpointStagePage: vi.fn(),
  beginPwaNormalizedCheckpointStage: vi.fn(),
  beginPwaScopeActionStage: mocks.beginScopeAction,
  closePwaScopeActionStage: mocks.closeScopeAction,
  pagePwaScopeActionStage: mocks.pageScopeAction,
  queryPwaNormalizedLibrary: mocks.queryNormalizedLibrary,
  mutatePwaContentPolicy: mocks.mutateContentPolicy,
  readPwaFollowerTransportContext: mocks.readFollowerTransportContext,
  readPwaNormalizedCheckpointReceipt: mocks.readNormalizedCheckpointReceipt,
  describePwaNormalizedCheckpointExport:
    mocks.describeNormalizedCheckpointExport,
  readPwaNormalizedCheckpointExportPage:
    mocks.readNormalizedCheckpointExportPage,
  resetPwaNormalizedLibrary: mocks.resetNormalizedLibrary,
}));

import {
  enqueuePwaLibraryCoreArchiveItems,
  enqueuePwaLibraryCoreArchiveAllReadUnsaved,
  enqueuePwaLibraryCoreDeleteAllArchived,
  enqueuePwaLibraryCoreUserStateToggle,
  enqueuePwaLibraryCoreMarkAllAsRead,
  enqueuePwaLibraryCoreFeedItemCaptures,
  enqueuePwaLibraryCoreFeedItemRemove,
  enqueuePwaLibraryCoreRssFeedRemove,
  enqueuePwaLibraryCoreRssFeedTitleAssignment,
  enqueuePwaLibraryCoreRssFeedUpsert,
  enqueuePwaLibraryCorePreferencesPatch,
  enqueuePwaLibraryCorePersonUpserts,
  enqueuePwaLibraryCorePersonRemove,
  enqueuePwaLibraryCoreAccountUpserts,
  enqueuePwaLibraryCoreAccountRemove,
  enqueuePwaLibraryCoreUnarchiveSavedItems,
  clearPwaLibraryCoreSampleData,
  initializePwaLibraryCoreState,
  openPwaLibraryCoreFriendsFeedReader,
  pinPwaLibraryCoreItemContent,
  readPwaLibraryCoreItemDetail,
  readPwaLibraryCoreCloudReceiptV2,
  readPwaLibraryCorePersonTimeline,
  readPwaLibraryCoreSelectedCheckpointReceipt,
  removeAllPwaLibraryCoreRssFeeds,
  scanPwaLibraryCoreItems,
  syncPwaLibraryCoreFromGoogleDrive,
} from "./library-core-runtime";

const SELECTED_SOURCE = Object.freeze({
  generationId: "45".repeat(32),
  selectionSequence: 7,
});

function facetSummary(totalCount = 0) {
  return {
    archivedCount: 0,
    archivableCount: 0,
    contactAccountCount: 0,
    contactLinkedPersonCount: 0,
    enabledRssFeedCount: 0,
    friendPersonCount: 0,
    latestContactImportedAt: null,
    latestRssFeedFetchedAt: null,
    platformCounts:
      totalCount === 0
        ? []
        : [
            {
              archivableCount: 0,
              latestCapturedAt: 1,
              latestPublishedAt: 1,
              platform: "rss",
              totalCount,
              unreadCount: 0,
            },
          ],
    rssFeedCount: 0,
    sampleAccountCount: 0,
    sampleFeedCount: 0,
    sampleItemCount: 0,
    samplePersonCount: 0,
    savedArchivedCount: 0,
    savedCount: 0,
    savedPlatformCount: 0,
    socialAccountCount: 0,
    tags: [],
    totalCount,
    unreadCount: 0,
  };
}

const SELECTED_RECEIPT = Object.freeze({
  authorityEpoch: "33".repeat(32),
  checkpointDigest: "45".repeat(32),
  checkpointGeneration: 7,
  controlRevision: "22".repeat(32),
  installedAt: 2_000,
  libraryId: "55".repeat(32),
  manifestContentDigest: "45".repeat(32),
  manifestObjectKey: "manifest-key",
  manifestTransportObjectId: "manifest-object",
  sourceRevision: 7,
  writerActorId: "66".repeat(32),
});

const LOCAL_EXPORT = Object.freeze({
  authorityEpoch: SELECTED_RECEIPT.authorityEpoch,
  causalFrontierDigest: "78".repeat(32),
  format: "freed_normalized_checkpoint_export_v2" as const,
  itemCount: 3,
  libraryId: SELECTED_RECEIPT.libraryId,
  protocolVersion: 2 as const,
  recordCount: 7,
  sourceRevision: SELECTED_RECEIPT.sourceRevision,
  writerId: SELECTED_RECEIPT.writerActorId as never,
});

function normalizedItemDetail(
  globalId: string,
  userState: Readonly<{
    archived?: boolean;
    liked?: boolean;
    readAt?: number | null;
    saved?: boolean;
  }> = {},
) {
  return {
    item: {
      card: {
        archived: userState.archived ?? false,
        authorAvatarUrl: null,
        authorDisplayName: "Reader",
        authorHandle: "reader",
        authorId: "reader-1",
        capturedAt: 20,
        contentSignalTags: [],
        contentText: "Saved locally",
        contentType: "post",
        engagementComments: null,
        engagementLikes: null,
        eventConfidenceBasisPoints: null,
        eventStartsAt: null,
        globalId,
        liked: userState.liked ?? false,
        likedAt: null,
        likedSyncedAt: null,
        linkPreviewTitle: null,
        locationName: null,
        mediaTypes: [],
        mediaUrls: [],
        platform: "rss",
        publishedAt: 10,
        readAt: userState.readAt ?? null,
        readingTimeMinutes: null,
        saved: userState.saved ?? false,
        sourceUrl: null,
        tags: [],
      },
      contentBody: { blobDigest: null, storage: "inline" },
      mediaBlobDigests: [],
      preservedBody: { blobDigest: null, storage: "none" },
    },
  };
}

function backgroundRow(
  globalId: string,
  userState: Readonly<{
    archived?: boolean;
    liked?: boolean;
    readAt?: number | null;
    saved?: boolean;
  }> = {},
  options: Readonly<{
    hidden?: boolean;
    platform?: "rss" | "youtube";
    rssSource?: {
      feedTitle: string;
      feedUrl: string;
      siteUrl: string;
    } | null;
    sampleDataFingerprint?: {
      batchId: string;
      generatedAt: number;
      generatorVersion: number;
      marker: "freed.sample-data.v1";
    } | null;
  }> = {},
) {
  return {
    ...normalizedItemDetail(globalId, userState).item.card,
    hidden: options.hidden ?? false,
    platform: options.platform ?? "rss",
    rssSource: options.rssSource ?? null,
    sampleDataFingerprint: options.sampleDataFingerprint ?? null,
  };
}

describe("PWA Library Core bounded scanner", () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.readNormalizedCheckpointReceipt.mockReset();
    mocks.readFollowerTransportContext.mockReset();
    mocks.describeNormalizedCheckpointExport.mockReset();
    mocks.readNormalizedCheckpointExportPage.mockReset();
    mocks.readNormalizedCheckpointReceipt.mockResolvedValue({ receipt: null });
    mocks.describeNormalizedCheckpointExport.mockResolvedValue(LOCAL_EXPORT);
    mocks.readNormalizedCheckpointExportPage.mockResolvedValue({
      canonicalRecordBytes: 1,
      done: false,
      nextCursor: {
        primaryKeyJson: '"checkpoint"',
        registryKey: "00_checkpoint_header",
      },
      records: [
        {
          format: "freed_normalized_checkpoint_v2",
          payload: {
            authorityEpoch: LOCAL_EXPORT.authorityEpoch,
            checkpointId: `${LOCAL_EXPORT.libraryId}:${LOCAL_EXPORT.authorityEpoch}:${LOCAL_EXPORT.sourceRevision}`,
            createdAtMs: 1,
            libraryId: LOCAL_EXPORT.libraryId,
            schemaVersion: 1,
            sourceRevision: LOCAL_EXPORT.sourceRevision,
          },
          primaryKey: "checkpoint",
          protocolVersion: 2,
          registryKey: "00_checkpoint_header",
        },
      ],
    });
    mocks.createNormalizedCheckpointWriter.mockReset();
    mocks.createNormalizedCheckpointWriter.mockReturnValue({});
    mocks.createCloudAdapter.mockReset();
    mocks.createCloudAdapter.mockReturnValue({});
    mocks.createFollowerTransport.mockReset();
    mocks.createFollowerTransport.mockReturnValue({});
    mocks.discoverControl.mockReset();
    mocks.importCheckpoint.mockReset();
    mocks.syncFollower.mockReset();
    mocks.syncFollower.mockResolvedValue({});
    mocks.queryNormalizedLibrary.mockReset();
    mocks.queryNormalizedLibrary.mockResolvedValue({
      nextCursor: null,
      rows: [],
    });
    mocks.mutateContentPolicy.mockReset();
    mocks.resetNormalizedLibrary.mockReset();
    mocks.prepareFollowerEnrollment.mockReset();
    mocks.prepareFollowerEnrollment.mockResolvedValue(null);
    mocks.commitReadAssignments.mockReset();
    mocks.commitUserStateAssignments.mockReset();
    mocks.commitFeedItemCaptures.mockReset();
    mocks.commitFeedItemRemove.mockReset();
    mocks.commitRssFeedUpsert.mockReset();
    mocks.commitRssFeedRemove.mockReset();
    mocks.commitRssFeedRemoves.mockReset();
    mocks.commitRssFeedTitleAssignment.mockReset();
    mocks.beginScopeAction.mockReset();
    mocks.closeScopeAction.mockReset();
    mocks.pageScopeAction.mockReset();
    mocks.commitPreferencesPatch.mockReset();
    mocks.commitPersonUpserts.mockReset();
    mocks.commitPersonRemove.mockReset();
    mocks.commitAccountUpserts.mockReset();
    mocks.commitAccountRemove.mockReset();
  });

  it("reads the exact selected OPFS SQLite checkpoint receipt", async () => {
    mocks.readNormalizedCheckpointReceipt.mockResolvedValue({
      receipt: SELECTED_RECEIPT,
    });
    await expect(readPwaLibraryCoreSelectedCheckpointReceipt()).resolves.toBe(
      SELECTED_RECEIPT,
    );
  });

  it("binds checkpoint and follower progress to one local authority", async () => {
    mocks.readNormalizedCheckpointReceipt.mockResolvedValue({
      receipt: SELECTED_RECEIPT,
    });
    mocks.readFollowerTransportContext.mockResolvedValue({
      actorId: "89".repeat(32),
      libraryId: SELECTED_RECEIPT.libraryId,
      nextIntentActorCounter: 4,
      nextResultSequence: 3,
      previousIntentSegmentDigest: "ab".repeat(32),
      previousResultSegmentDigest: "cd".repeat(32),
      schemaVersion: 2,
      storageEpochId: SELECTED_RECEIPT.authorityEpoch,
    });

    await expect(readPwaLibraryCoreCloudReceiptV2()).resolves.toEqual({
      checkpoint: SELECTED_RECEIPT,
      follower: expect.objectContaining({
        actorId: "89".repeat(32),
        nextIntentActorCounter: 4,
        nextResultSequence: 3,
      }),
      localExport: LOCAL_EXPORT,
    });

    mocks.describeNormalizedCheckpointExport.mockRejectedValueOnce(
      new Error("normalized checkpoint export has unresolved local intents"),
    );
    await expect(readPwaLibraryCoreCloudReceiptV2()).resolves.toMatchObject({
      checkpoint: SELECTED_RECEIPT,
      localExport: null,
    });

    mocks.readFollowerTransportContext.mockResolvedValueOnce({
      actorId: "89".repeat(32),
      libraryId: SELECTED_RECEIPT.libraryId,
      nextIntentActorCounter: 1,
      nextResultSequence: 1,
      previousIntentSegmentDigest: null,
      previousResultSegmentDigest: null,
      schemaVersion: 2,
      storageEpochId: "ff".repeat(32),
    });
    await expect(readPwaLibraryCoreCloudReceiptV2()).rejects.toThrow(
      "crosses Library authority",
    );
  });

  it("imports the normalized checkpoint through the OPFS SQLite writer", async () => {
    const libraryId = "55".repeat(32);
    const storageEpoch = "33".repeat(32);
    const writerId = "66".repeat(32);
    const manifestDigest = "77".repeat(32);
    const pointer = {
      activeTransport: "google_drive_app_data_v1",
      causalFrontierDigest: "88".repeat(32),
      generation: 9,
      libraryId,
      manifest: {
        descriptor: {
          byteLength: 1,
          contentDigest: manifestDigest,
          objectKey: createLibraryCoreImmutableObjectKey({
            digest: manifestDigest,
            epochId: storageEpoch,
            generation: 9,
            kind: "checkpoint_manifest",
            libraryId,
          }),
        },
        transportObjectId: "manifest-runtime-recovery",
      },
      protocolVersion: 1,
      schemaVersion: 1,
      storageEpoch,
      writerId,
    };
    mocks.discoverControl.mockResolvedValue({
      control: {
        bytes: new TextEncoder().encode(JSON.stringify(pointer)),
      },
      controlFileId: "control-runtime-recovery",
      libraryId,
    });
    const writer = Object.freeze({ beginImport: vi.fn() });
    mocks.createNormalizedCheckpointWriter.mockReturnValue(writer);
    mocks.importCheckpoint.mockResolvedValue({ status: "already_complete" });
    mocks.readNormalizedCheckpointReceipt.mockResolvedValue({
      receipt: { ...SELECTED_RECEIPT, libraryId, writerActorId: writerId },
    });
    mocks.queryNormalizedLibrary.mockImplementation(async (request) => {
      if (request.queryId === "feed_browse_page_v3") {
        return {
          nextCursor: null,
          previousCursor: null,
          queryId: request.queryId,
          rows: [],
          schemaVersion: 3,
          source: SELECTED_SOURCE,
          totalCount: 0,
        };
      }
      if (request.queryId === "preferences_snapshot_v1") {
        return {
          queryId: request.queryId,
          rows: [],
          schemaVersion: 1,
          source: SELECTED_SOURCE,
        };
      }
      return {
        queryId: "library_facet_summary_v1",
        schemaVersion: 1,
        source: SELECTED_SOURCE,
        summary: facetSummary(),
      };
    });

    await expect(
      syncPwaLibraryCoreFromGoogleDrive({ accessToken: "test-token" }),
    ).resolves.toEqual(
      expect.not.objectContaining({ items: expect.anything() }),
    );
    expect(mocks.importCheckpoint).toHaveBeenCalledWith(
      expect.objectContaining({ writer }),
    );
    expect(mocks.createNormalizedCheckpointWriter).toHaveBeenCalledWith(
      expect.objectContaining({
        checkpointGeneration: 9,
        controlRevision: expect.stringMatching(/^[0-9a-f]{64}$/),
        writerActorId: writerId,
      }),
    );
    expect(mocks.createFollowerTransport).toHaveBeenCalledWith({
      accessToken: "test-token",
      controlFileId: "control-runtime-recovery",
      libraryId,
      signal: undefined,
    });
    expect(mocks.syncFollower).toHaveBeenCalledWith({}, { signal: undefined });
  });

  it("binds search identity to the selected checkpoint instead of stale shell state", async () => {
    mocks.readNormalizedCheckpointReceipt.mockResolvedValue({
      receipt: SELECTED_RECEIPT,
    });
    mocks.queryNormalizedLibrary.mockImplementation(async (request) =>
      request.queryId === "library_facet_summary_v1"
        ? {
            summary: facetSummary(),
          }
        : request.queryId === "preferences_snapshot_v1"
          ? { rows: [] }
          : { nextCursor: null, previousCursor: null, rows: [], totalCount: 0 },
    );

    const state = await initializePwaLibraryCoreState();

    expect(state.searchCorpusVersion).toBe(SELECTED_RECEIPT.sourceRevision);
  });

  it("hydrates synchronized preferences from SQLite instead of the shell", async () => {
    mocks.readNormalizedCheckpointReceipt.mockResolvedValue({
      receipt: SELECTED_RECEIPT,
    });
    mocks.queryNormalizedLibrary.mockImplementation(async (request) => {
      if (request.queryId === "preferences_snapshot_v1") {
        return {
          rows: [
            {
              booleanValue: null,
              integerValue: null,
              path: "o:$.display",
              realValue: null,
              textValue: null,
              updatedAt: 1,
              valueType: "null",
            },
            {
              booleanValue: null,
              integerValue: null,
              path: "v:$.display.themeId",
              realValue: null,
              textValue: "neon",
              updatedAt: 1,
              valueType: "text",
            },
          ],
        };
      }
      if (request.queryId === "library_facet_summary_v1") {
        return { summary: facetSummary() };
      }
      return {
        nextCursor: null,
        previousCursor: null,
        rows: [],
        totalCount: 0,
      };
    });

    await expect(initializePwaLibraryCoreState()).resolves.toEqual(
      expect.objectContaining({
        preferences: expect.objectContaining({
          display: expect.objectContaining({ themeId: "neon" }),
        }),
      }),
    );
    expect(mocks.queryNormalizedLibrary).toHaveBeenCalledWith({
      queryId: "preferences_snapshot_v1",
      schemaVersion: 1,
    });
  });

  it("pages OPFS SQLite and stops without issuing another query", async () => {
    mocks.queryNormalizedLibrary
      .mockResolvedValueOnce({
        nextCursor: "cursor-1",
        rows: [backgroundRow("item-1")],
      })
      .mockResolvedValueOnce({
        nextCursor: "unused-cursor",
        rows: [backgroundRow("item-2")],
      });
    const visited: string[][] = [];

    await scanPwaLibraryCoreItems((items) => {
      visited.push(items.map((item) => item.globalId));
      return visited.length === 2 ? "stop" : "continue";
    });

    expect(visited).toEqual([["item-1"], ["item-2"]]);
    expect(mocks.queryNormalizedLibrary).toHaveBeenCalledTimes(2);
    expect(mocks.queryNormalizedLibrary).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        cursor: null,
        limit: 64,
        queryId: "background_item_page_v1",
      }),
    );
    expect(mocks.queryNormalizedLibrary).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ cursor: "cursor-1" }),
    );
  });

  it("propagates a stale SQLite cursor instead of mixing generations", async () => {
    mocks.queryNormalizedLibrary
      .mockResolvedValueOnce({
        nextCursor: "cursor-1",
        rows: [backgroundRow("old-item")],
      })
      .mockRejectedValueOnce(
        new Error("PWA Library SQLite item scan cursor is stale"),
      );

    await expect(scanPwaLibraryCoreItems(() => "continue")).rejects.toThrow(
      "item scan cursor is stale",
    );
  });

  it("clears sample records across bounded SQLite identity pages", async () => {
    const sample = {
      batchId: "sample-batch",
      generatedAt: 100,
      generatorVersion: 1,
      marker: "freed.sample-data.v1" as const,
    };
    const rssRow = {
      activityCount: 1,
      enabled: true,
      folder: null,
      imageUrl: null,
      lastFetched: null,
      latestActivityAt: 1,
      pollInterval: 30,
      sampleBatchId: sample.batchId,
      sampleGeneratedAt: sample.generatedAt,
      sampleGeneratorVersion: sample.generatorVersion,
      siteUrl: null,
      title: "Sample",
      trackUnread: true,
      unreadCount: 0,
      updatedAt: 1,
      url: "https://sample.test/feed",
    };
    const personGraphRow = {
      avatarUrl: null,
      careLevel: 3,
      graphPinned: false,
      graphUpdatedAt: null,
      graphX: null,
      graphY: null,
      id: "person-sample",
      lastReachOutAt: null,
      name: "Sample Person",
      reachOutIntervalDays: null,
      relationshipStatus: "friend",
      updatedAt: 1,
    };
    const accountGraphRow = (id: string) => ({
      activityCount: 0,
      avatarUrl: null,
      discoveredFrom: "manual_entry",
      displayName: id,
      externalId: id,
      firstSeenAt: 1,
      followRosterActive: null,
      graphPinned: false,
      graphUpdatedAt: null,
      graphX: null,
      graphY: null,
      handle: null,
      id,
      kind: "social",
      lastSeenAt: 1,
      latestActivityAt: null,
      personId: "person-sample",
      personName: "Sample Person",
      provider: "x",
      updatedAt: 1,
    });
    const accountDetail = (
      id: string,
      sampleDataFingerprint: typeof sample | null,
    ) => ({
      account: {
        address: null,
        avatarUrl: null,
        createdAt: 1,
        discoveredFrom: "manual_entry",
        displayName: id,
        email: null,
        externalId: id,
        firstSeenAt: 1,
        followRosterActive: null,
        followRosterRoles: [],
        followRosterSyncedAt: null,
        handle: null,
        id,
        importedAt: null,
        kind: "social",
        lastSeenAt: 1,
        personId: "person-sample",
        phone: null,
        profileUrl: null,
        provider: "x",
        sampleBatchId: sampleDataFingerprint?.batchId ?? null,
        sampleGeneratedAt: sampleDataFingerprint?.generatedAt ?? null,
        sampleGeneratorVersion: sampleDataFingerprint?.generatorVersion ?? null,
        updatedAt: 1,
      },
    });
    mocks.queryNormalizedLibrary.mockImplementation(async (request) => {
      switch (request.queryId) {
        case "rss_feed_page_v1":
          return { nextCursor: null, rows: [rssRow] };
        case "person_graph_page_v1":
          return { nextCursor: null, rows: [personGraphRow] };
        case "person_detail_v1":
          return {
            person: {
              avatarUrl: null,
              bio: null,
              careLevel: 3,
              createdAt: 1,
              id: "person-sample",
              name: "Sample Person",
              notes: null,
              reachOutIntervalDays: null,
              reachOuts: [],
              relationshipStatus: "friend",
              sampleBatchId: sample.batchId,
              sampleGeneratedAt: sample.generatedAt,
              sampleGeneratorVersion: sample.generatorVersion,
              tags: [],
              updatedAt: 1,
            },
          };
        case "account_graph_page_v1":
          return {
            nextCursor: null,
            rows: [
              accountGraphRow("account-sample"),
              accountGraphRow("account-real"),
            ],
          };
        case "account_detail_v1":
          return request.accountId === "account-sample"
            ? accountDetail("account-sample", sample)
            : accountDetail("account-real", null);
        case "background_item_page_v1":
          return {
            nextCursor: null,
            rows: [
              backgroundRow(
                "item-sample",
                {},
                {
                  sampleDataFingerprint: sample,
                },
              ),
            ],
          };
        default:
          throw new Error(`Unexpected query ${request.queryId}`);
      }
    });

    await expect(clearPwaLibraryCoreSampleData()).resolves.toEqual({
      accounts: 1,
      feeds: 1,
      items: 1,
      persons: 1,
      total: 4,
    });
    const detachedAccount = mocks.commitAccountUpserts.mock.calls[0]?.[0]?.[0];
    expect(detachedAccount).toEqual(
      expect.objectContaining({ id: "account-real" }),
    );
    expect(detachedAccount).not.toHaveProperty("personId");
    expect(mocks.commitAccountRemove).toHaveBeenCalledWith(
      "account-sample",
      expect.any(Number),
    );
    expect(mocks.commitPersonRemove).toHaveBeenCalledWith(
      "person-sample",
      expect.any(Number),
    );
    expect(mocks.commitRssFeedRemove).toHaveBeenCalledWith(
      rssRow.url,
      false,
      expect.any(Number),
    );
    expect(mocks.commitFeedItemRemove).toHaveBeenCalledWith(
      "item-sample",
      expect.any(Number),
    );
  });

  it("reads one compact item through the normalized SQLite executor", async () => {
    mocks.queryNormalizedLibrary.mockResolvedValue({
      item: {
        card: {
          archived: false,
          authorAvatarUrl: null,
          authorDisplayName: "Reader",
          authorHandle: "reader",
          authorId: "reader-1",
          capturedAt: 20,
          contentSignalTags: [],
          contentText: "Saved locally",
          contentType: "post",
          engagementComments: null,
          engagementLikes: null,
          eventConfidenceBasisPoints: null,
          eventStartsAt: null,
          globalId: "item-9",
          liked: false,
          likedAt: null,
          likedSyncedAt: null,
          linkPreviewTitle: null,
          locationName: null,
          mediaTypes: [],
          mediaUrls: [],
          platform: "rss",
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
    });

    await expect(readPwaLibraryCoreItemDetail("item-9")).resolves.toEqual(
      expect.objectContaining({ globalId: "item-9" }),
    );
    expect(mocks.queryNormalizedLibrary).toHaveBeenCalledWith({
      globalId: "item-9",
      queryId: "item_detail_v1",
      schemaVersion: 1,
    });
  });

  it("pins every distinct SQLite content descriptor for offline use", async () => {
    const bodyDigest = "a".repeat(64);
    const mediaDigest = "b".repeat(64);
    mocks.queryNormalizedLibrary.mockResolvedValue({
      ...normalizedItemDetail("item-pinned"),
      item: {
        ...normalizedItemDetail("item-pinned").item,
        contentBody: { blobDigest: bodyDigest, storage: "blob" },
        mediaBlobDigests: [mediaDigest, bodyDigest],
        preservedBody: { blobDigest: bodyDigest, storage: "blob" },
      },
    });

    await pinPwaLibraryCoreItemContent("item-pinned", 1_234);

    expect(mocks.mutateContentPolicy.mock.calls).toEqual([
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

  it("opens Friends through the normalized relational predicate", async () => {
    mocks.queryNormalizedLibrary.mockResolvedValue({
      nextCursor: null,
      previousCursor: null,
      rows: [],
      totalCount: 0,
    });

    const reader = await openPwaLibraryCoreFriendsFeedReader({}, 100);

    expect(reader.totalCount).toBe(0);
    expect(mocks.queryNormalizedLibrary).toHaveBeenCalledWith(
      expect.objectContaining({
        friendsPredicateSchemaVersion: 1,
        identityMode: "friends",
        queryId: "feed_browse_page_v3",
      }),
    );
  });

  it("reads one Person timeline page through normalized SQLite", async () => {
    mocks.queryNormalizedLibrary.mockResolvedValue({
      nextCursor: "cursor-2",
      rows: [],
      totalCount: 3,
    });

    await expect(
      readPwaLibraryCorePersonTimeline({
        cursor: null,
        limit: 2,
        personId: "person-1",
      }),
    ).resolves.toEqual({
      items: [],
      nextCursor: "cursor-2",
      totalCount: 3,
    });
    expect(mocks.queryNormalizedLibrary).toHaveBeenCalledWith(
      expect.objectContaining({
        limit: 2,
        personId: "person-1",
        queryId: "person_timeline_v1",
      }),
    );
  });

  it("reads one unlinked Account timeline page through normalized SQLite", async () => {
    mocks.queryNormalizedLibrary.mockResolvedValue({
      nextCursor: null,
      rows: [],
      totalCount: 1,
    });

    await expect(
      readPwaLibraryCorePersonTimeline({
        accountId: "account-1",
        cursor: null,
        limit: 2,
      }),
    ).resolves.toEqual({
      items: [],
      nextCursor: null,
      totalCount: 1,
    });
    expect(mocks.queryNormalizedLibrary).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: "account-1",
        limit: 2,
        queryId: "account_timeline_v1",
      }),
    );
  });

  it("reads toggle state from SQLite before queuing a signed intent", async () => {
    mocks.commitUserStateAssignments.mockResolvedValue({
      operationId: "op:assignment",
    });
    mocks.queryNormalizedLibrary.mockResolvedValue(
      normalizedItemDetail("item-9", { liked: false }),
    );

    await enqueuePwaLibraryCoreUserStateToggle("item-9", "liked");

    expect(mocks.commitUserStateAssignments).toHaveBeenCalledOnce();
    expect(mocks.commitUserStateAssignments).toHaveBeenCalledWith(
      ["item-9"],
      "liked",
      true,
      expect.any(Number),
    );
  });

  it("commits FeedItem removal through the signed SQLite intent path", async () => {
    mocks.commitFeedItemRemove.mockResolvedValue({ operationId: "op:remove" });

    await enqueuePwaLibraryCoreFeedItemRemove("item-9");

    expect(mocks.commitFeedItemRemove).toHaveBeenCalledOnce();
    expect(mocks.commitFeedItemRemove).toHaveBeenCalledWith(
      "item-9",
      expect.any(Number),
    );
  });

  it("batches sanitized FeedItem captures through the signed SQLite intent path", async () => {
    mocks.commitFeedItemCaptures.mockResolvedValue({
      operationId: "op:capture",
    });
    const items = Array.from({ length: 129 }, (_, index) => ({
      globalId: `item-${index}`,
      platform: "rss" as const,
      contentType: "article" as const,
      capturedAt: index + 1,
      publishedAt: index + 1,
      author: { id: "author", handle: "author", displayName: "Author" },
      content: { text: "Text", mediaUrls: [], mediaTypes: [] },
      userState: { hidden: false, saved: false, archived: false, tags: [] },
      topics: [],
      priority: 99,
      priorityComputedAt: 123,
    }));

    await enqueuePwaLibraryCoreFeedItemCaptures(items);

    expect(mocks.commitFeedItemCaptures).toHaveBeenCalledTimes(5);
    expect(mocks.commitFeedItemCaptures.mock.calls[0]?.[0]).toHaveLength(32);
    expect(mocks.commitFeedItemCaptures.mock.calls[4]?.[0]).toHaveLength(1);
    expect(
      mocks.commitFeedItemCaptures.mock.calls[0]?.[0]?.[0],
    ).not.toHaveProperty("priority");
    expect(
      mocks.commitFeedItemCaptures.mock.calls[0]?.[0]?.[0],
    ).not.toHaveProperty("priorityComputedAt");

    await enqueuePwaLibraryCoreFeedItemCaptures([
      items[0]!,
      {
        ...items[0]!,
        content: { text: "Later", mediaUrls: [], mediaTypes: [] },
      },
    ]);
    expect(mocks.commitFeedItemCaptures).toHaveBeenCalledTimes(7);
    expect(mocks.commitFeedItemCaptures.mock.calls[5]?.[0]).toHaveLength(1);
    expect(mocks.commitFeedItemCaptures.mock.calls[6]?.[0]).toHaveLength(1);
  });

  it("repairs saved archived items from bounded SQLite rows", async () => {
    mocks.commitUserStateAssignments.mockResolvedValue({
      operationId: "op:unarchive",
    });
    mocks.queryNormalizedLibrary.mockResolvedValueOnce({
      nextCursor: null,
      rows: [
        backgroundRow("saved-archived", { archived: true, saved: true }),
        backgroundRow("plain-archived", { archived: true }),
      ],
    });
    await enqueuePwaLibraryCoreUnarchiveSavedItems();

    expect(mocks.commitUserStateAssignments).toHaveBeenCalledWith(
      ["saved-archived"],
      "archived",
      false,
      expect.any(Number),
    );
  });

  it("deletes only archived unsaved items from bounded SQLite rows", async () => {
    mocks.commitFeedItemRemove.mockResolvedValue({ operationId: "op:remove" });
    mocks.queryNormalizedLibrary.mockResolvedValueOnce({
      nextCursor: null,
      rows: [
        backgroundRow("plain-archived", { archived: true }),
        backgroundRow("saved-archived", { archived: true, saved: true }),
      ],
    });
    await enqueuePwaLibraryCoreDeleteAllArchived();

    expect(mocks.commitFeedItemRemove).toHaveBeenCalledOnce();
    expect(mocks.commitFeedItemRemove).toHaveBeenCalledWith(
      "plain-archived",
      expect.any(Number),
    );
  });

  it("marks the complete selected platform read in bounded intent batches", async () => {
    mocks.commitReadAssignments.mockResolvedValue({ operationId: "op:read" });
    mocks.queryNormalizedLibrary.mockResolvedValueOnce({
      nextCursor: null,
      rows: [
        backgroundRow("rss-unread"),
        backgroundRow("youtube-unread", {}, { platform: "youtube" }),
        backgroundRow("rss-read", { readAt: 1 }),
      ],
    });

    await enqueuePwaLibraryCoreMarkAllAsRead("rss");

    expect(mocks.commitReadAssignments).toHaveBeenCalledOnce();
    expect(mocks.commitReadAssignments).toHaveBeenCalledWith(
      ["rss-unread"],
      expect.any(Number),
    );
  });

  it("archives only eligible selected items through explicit assignments", async () => {
    mocks.commitUserStateAssignments.mockResolvedValue({
      operationId: "op:archive",
    });
    mocks.queryNormalizedLibrary
      .mockResolvedValueOnce(normalizedItemDetail("eligible", { readAt: 1 }))
      .mockResolvedValueOnce(
        normalizedItemDetail("saved", { readAt: 1, saved: true }),
      )
      .mockResolvedValueOnce(normalizedItemDetail("unread"));

    await enqueuePwaLibraryCoreArchiveItems([
      "eligible",
      "saved",
      "unread",
      "eligible",
    ]);

    expect(mocks.commitUserStateAssignments).toHaveBeenCalledOnce();
    expect(mocks.commitUserStateAssignments).toHaveBeenCalledWith(
      ["eligible"],
      "archived",
      true,
      expect.any(Number),
    );
  });

  it("archives the complete selected scope in one bounded assignment batch", async () => {
    mocks.commitUserStateAssignments.mockResolvedValue({
      operationId: "op:bulk",
    });
    mocks.queryNormalizedLibrary.mockResolvedValueOnce({
      nextCursor: null,
      rows: [
        backgroundRow(
          "rss-eligible",
          { readAt: 1 },
          {
            rssSource: {
              feedTitle: "Example",
              feedUrl: "https://example.test/feed",
              siteUrl: "https://example.test",
            },
          },
        ),
        backgroundRow(
          "rss-saved",
          { readAt: 1, saved: true },
          {
            rssSource: {
              feedTitle: "Example",
              feedUrl: "https://example.test/feed",
              siteUrl: "https://example.test",
            },
          },
        ),
        backgroundRow(
          "other-feed",
          { readAt: 1 },
          {
            rssSource: {
              feedTitle: "Other",
              feedUrl: "https://other.test/feed",
              siteUrl: "https://other.test",
            },
          },
        ),
      ],
    });
    await enqueuePwaLibraryCoreArchiveAllReadUnsaved(
      "rss",
      "https://example.test/feed",
    );

    expect(mocks.commitUserStateAssignments).toHaveBeenCalledWith(
      ["rss-eligible"],
      "archived",
      true,
      expect.any(Number),
    );
  });

  it("routes RSS configuration through signed Library Core intents", async () => {
    mocks.commitRssFeedUpsert.mockResolvedValue({ operationId: "op:rss:add" });
    mocks.commitRssFeedRemove.mockResolvedValue({
      operationId: "op:rss:remove",
    });
    const feed = {
      url: "https://example.test/feed.xml",
      title: "Example",
      enabled: true,
      trackUnread: true,
    };

    await enqueuePwaLibraryCoreRssFeedUpsert(feed);
    await enqueuePwaLibraryCoreRssFeedRemove(feed.url, true);
    await enqueuePwaLibraryCoreRssFeedTitleAssignment(feed.url, "Renamed");

    expect(mocks.commitRssFeedUpsert).toHaveBeenCalledWith(
      feed,
      expect.any(Number),
    );
    expect(mocks.commitRssFeedRemove).toHaveBeenCalledWith(
      feed.url,
      true,
      expect.any(Number),
    );
    expect(mocks.commitRssFeedTitleAssignment).toHaveBeenCalledWith(
      feed.url,
      "Renamed",
      expect.any(Number),
    );
  });

  it("removes an exact frozen RSS scope in bounded signed batches", async () => {
    const urls = Array.from(
      { length: 300 },
      (_, index) => `https://example.test/${index.toLocaleString()}`,
    );
    mocks.beginScopeAction.mockResolvedValue({
      memberCount: urls.length,
      stageId: "ignored",
      state: "ready",
    });
    mocks.pageScopeAction
      .mockResolvedValueOnce({
        entityIds: urls,
        nextOrdinal: urls.length - 1,
        stageId: "ignored",
      })
      .mockResolvedValueOnce({
        entityIds: [],
        nextOrdinal: urls.length - 1,
        stageId: "ignored",
      });

    await expect(removeAllPwaLibraryCoreRssFeeds(false)).resolves.toBe(300);

    expect(mocks.beginScopeAction).toHaveBeenCalledWith(
      expect.stringMatching(/^pwa-rss-scope:/),
      { action: "rss_feeds_remove_keep_items", schemaVersion: 1 },
    );
    expect(mocks.commitRssFeedRemoves).toHaveBeenCalledTimes(2);
    expect(mocks.commitRssFeedRemoves.mock.calls[0]?.[0]).toHaveLength(256);
    expect(mocks.commitRssFeedRemoves.mock.calls[1]?.[0]).toHaveLength(44);
    expect(mocks.closeScopeAction).toHaveBeenCalledOnce();
  });

  it("routes synchronized preferences through a signed Library Core patch", async () => {
    mocks.commitPreferencesPatch.mockResolvedValue({
      operationId: "op:preferences",
    });
    const update = {
      display: {
        ...createDefaultPreferences().display,
        archivePruneDays: 14,
      },
    };

    await enqueuePwaLibraryCorePreferencesPatch(update);

    expect(mocks.commitPreferencesPatch).toHaveBeenCalledWith(
      update,
      expect.any(Number),
    );
  });

  it("batches synchronized Persons and removes device-local graph state", async () => {
    mocks.commitPersonUpserts.mockResolvedValue({
      operationId: "op:persons",
    });
    const person = {
      id: "person:one",
      name: "One Person",
      relationshipStatus: "friend" as const,
      careLevel: 3 as const,
      graphX: 12,
      graphY: 34,
      createdAt: 1,
      updatedAt: 2,
    };

    await enqueuePwaLibraryCorePersonUpserts([person]);

    expect(mocks.commitPersonUpserts).toHaveBeenCalledOnce();
    expect(mocks.commitPersonUpserts).toHaveBeenCalledWith(
      [
        {
          id: "person:one",
          name: "One Person",
          relationshipStatus: "friend",
          careLevel: 3,
          createdAt: 1,
          updatedAt: 2,
        },
      ],
      expect.any(Number),
    );
  });

  it("queues one atomic Person and linked-account removal", async () => {
    mocks.commitPersonRemove.mockResolvedValue({
      operationId: "op:person-remove",
    });

    await enqueuePwaLibraryCorePersonRemove("person:one");

    expect(mocks.commitPersonRemove).toHaveBeenCalledOnce();
    expect(mocks.commitPersonRemove).toHaveBeenCalledWith(
      "person:one",
      expect.any(Number),
    );
  });

  it("batches synchronized Accounts, strips graph state, and queues removal", async () => {
    mocks.commitAccountUpserts.mockResolvedValue({
      operationId: "op:accounts",
    });
    mocks.commitAccountRemove.mockResolvedValue({
      operationId: "op:account-remove",
    });
    const account = {
      id: "account:one",
      personId: "person:one",
      kind: "social" as const,
      provider: "instagram" as const,
      externalId: "one",
      discoveredFrom: "manual_entry" as const,
      firstSeenAt: 1,
      lastSeenAt: 2,
      graphX: 12,
      graphY: 34,
      createdAt: 1,
      updatedAt: 2,
    };

    await enqueuePwaLibraryCoreAccountUpserts([account]);
    await enqueuePwaLibraryCoreAccountRemove(account.id);

    expect(mocks.commitAccountUpserts).toHaveBeenCalledWith(
      [
        {
          id: "account:one",
          personId: "person:one",
          kind: "social",
          provider: "instagram",
          externalId: "one",
          discoveredFrom: "manual_entry",
          firstSeenAt: 1,
          lastSeenAt: 2,
          createdAt: 1,
          updatedAt: 2,
        },
      ],
      expect.any(Number),
    );
    expect(mocks.commitAccountRemove).toHaveBeenCalledWith(
      "account:one",
      expect.any(Number),
    );
  });
});
