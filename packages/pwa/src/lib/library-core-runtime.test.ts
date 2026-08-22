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
  commitPreferencesPatch: vi.fn(),
  commitPersonUpserts: vi.fn(),
  commitPersonRemove: vi.fn(),
  commitAccountUpserts: vi.fn(),
  commitAccountRemove: vi.fn(),
  readSelectedCollectionPage: vi.fn(),
  readSelectedMaterializedPage: vi.fn(),
  readSelectedMaterializedRow: vi.fn(),
  readSelectedCheckpointReceipt: vi.fn(),
  readIntentOverlayRecoveryState: vi.fn(),
  readSelectedAcceptedAuthorityState: vi.fn(),
  preparePwaActorEnrollmentRequest: vi.fn(),
  readPendingIntentActors: vi.fn(),
  readIntentActors: vi.fn(),
  reapplySelectedIntentOverlay: vi.fn(),
  createCloudAdapter: vi.fn(),
  discoverActorEnrollments: vi.fn(),
  discoverControl: vi.fn(),
  importCheckpoint: vi.fn(),
  queryNormalizedLibrary: vi.fn(),
  resetNormalizedLibrary: vi.fn(),
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
  commitPwaLibraryCoreRssFeedUpsert: mocks.commitRssFeedUpsert,
  commitPwaLibraryCoreUserStateAssignments: mocks.commitUserStateAssignments,
}));

vi.mock("./library-core-portable-checkpoint-store", () => ({
  PWA_LIBRARY_CORE_ACCOUNT_UPSERT_BATCH_LIMIT: 128,
  PWA_LIBRARY_CORE_FEED_ITEM_UPSERT_BATCH_LIMIT: 128,
  PWA_LIBRARY_CORE_PERSON_UPSERT_BATCH_LIMIT: 128,
  createPwaLibraryCorePortableCheckpointStore: () => ({
    readSelectedMaterializedPage: mocks.readSelectedMaterializedPage,
    readSelectedMaterializedRow: mocks.readSelectedMaterializedRow,
    readSelectedCheckpointReceipt: mocks.readSelectedCheckpointReceipt,
    readIntentOverlayRecoveryState: mocks.readIntentOverlayRecoveryState,
    readSelectedAcceptedAuthorityState:
      mocks.readSelectedAcceptedAuthorityState,
    preparePwaActorEnrollmentRequest: mocks.preparePwaActorEnrollmentRequest,
    readPendingIntentActors: mocks.readPendingIntentActors,
    readIntentActors: mocks.readIntentActors,
    reapplySelectedIntentOverlay: mocks.reapplySelectedIntentOverlay,
  }),
}));

vi.mock("@freed/sync/cloud/library-core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@freed/sync/cloud/library-core")>()),
  createGoogleDriveLibraryCoreAdapterV1: mocks.createCloudAdapter,
  discoverGoogleDriveLibraryCoreActorEnrollmentsV1:
    mocks.discoverActorEnrollments,
  discoverPublishedGoogleDriveLibraryCoreControlV1: mocks.discoverControl,
  importLibraryCorePortableCheckpointV1: mocks.importCheckpoint,
}));

vi.mock("./factory-reset-coordinator", () => ({
  registerPwaFactoryResetQuiesceHandler: vi.fn(),
}));

vi.mock("./library-core-sqlite-runtime", () => ({
  queryPwaNormalizedLibrary: mocks.queryNormalizedLibrary,
  resetPwaNormalizedLibrary: mocks.resetNormalizedLibrary,
}));

import {
  clearPwaLibraryCoreSampleData,
  enqueuePwaLibraryCoreArchiveItems,
  enqueuePwaLibraryCoreArchiveAllReadUnsaved,
  enqueuePwaLibraryCoreDeleteAllArchived,
  isPwaLibraryCoreEnabled,
  enqueuePwaLibraryCoreUserStateToggle,
  enqueuePwaLibraryCoreMarkAllAsRead,
  enqueuePwaLibraryCoreFeedItemCaptures,
  enqueuePwaLibraryCoreFeedItemRemove,
  enqueuePwaLibraryCoreRssFeedRemove,
  enqueuePwaLibraryCoreRssFeedUpsert,
  enqueuePwaLibraryCorePreferencesPatch,
  enqueuePwaLibraryCorePersonUpserts,
  enqueuePwaLibraryCorePersonRemove,
  enqueuePwaLibraryCoreAccountUpserts,
  enqueuePwaLibraryCoreAccountRemove,
  enqueuePwaLibraryCoreUnarchiveSavedItems,
  initializePwaLibraryCoreState,
  openPwaLibraryCoreFriendsFeedReader,
  readPwaLibraryCoreIntentOverlayRecoveryState,
  readPwaLibraryCoreItemDetail,
  readPwaLibraryCorePersonTimeline,
  readPwaLibraryCoreSelectedCheckpointReceipt,
  scanPwaLibraryCoreItems,
  syncPwaLibraryCoreFromGoogleDrive,
} from "./library-core-runtime";

const SELECTED_SOURCE = Object.freeze({
  generationId: "45".repeat(32),
  selectionSequence: 7,
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
    mocks.readSelectedCollectionPage.mockReset();
    mocks.readSelectedMaterializedPage.mockReset();
    mocks.readSelectedMaterializedPage.mockImplementation(
      async ({ cursor, limit }) => {
        const page = await mocks.readSelectedCollectionPage({
          afterOrdinal: cursor === null ? null : Number(cursor),
          collection: "materialized_rows",
          limit,
        });
        return {
          entries: page.entries.map(
            ({ value }: { value: { registry_key: string; row: unknown } }) => ({
              primaryKey: JSON.stringify(
                (value.row as { globalId?: string }).globalId ?? "shell",
              ),
              registryKey: value.registry_key,
              row: value.row,
            }),
          ),
          nextCursor:
            page.nextOrdinal === null ? null : String(page.nextOrdinal),
          source: SELECTED_SOURCE,
        };
      },
    );
    mocks.readSelectedMaterializedRow.mockReset();
    mocks.readSelectedCheckpointReceipt.mockReset();
    mocks.readIntentOverlayRecoveryState.mockReset();
    mocks.readSelectedAcceptedAuthorityState.mockReset();
    mocks.preparePwaActorEnrollmentRequest.mockReset();
    mocks.readPendingIntentActors.mockReset();
    mocks.readIntentActors.mockReset();
    mocks.reapplySelectedIntentOverlay.mockReset();
    mocks.reapplySelectedIntentOverlay.mockResolvedValue({
      canonicalEnvelopeBytes: 0,
      countsAreLowerBounds: false,
      operationCount: 0,
      schemaVersion: 1,
      status: "ready",
      transactionCount: 0,
    });
    mocks.readSelectedCheckpointReceipt.mockResolvedValue(SELECTED_SOURCE);
    mocks.readIntentOverlayRecoveryState.mockResolvedValue({
      canonicalEnvelopeBytes: 0,
      countsAreLowerBounds: false,
      operationCount: 0,
      schemaVersion: 1,
      status: "ready",
      transactionCount: 0,
    });
    mocks.preparePwaActorEnrollmentRequest.mockResolvedValue(null);
    mocks.readPendingIntentActors.mockResolvedValue([]);
    mocks.readIntentActors.mockResolvedValue([]);
    mocks.createCloudAdapter.mockReset();
    mocks.createCloudAdapter.mockReturnValue({});
    mocks.discoverActorEnrollments.mockReset();
    mocks.discoverActorEnrollments.mockResolvedValue([]);
    mocks.discoverControl.mockReset();
    mocks.importCheckpoint.mockReset();
    mocks.queryNormalizedLibrary.mockReset();
    mocks.queryNormalizedLibrary.mockResolvedValue({
      nextCursor: null,
      rows: [],
    });
    mocks.resetNormalizedLibrary.mockReset();
    mocks.commitReadAssignments.mockReset();
    mocks.commitUserStateAssignments.mockReset();
    mocks.commitFeedItemCaptures.mockReset();
    mocks.commitFeedItemRemove.mockReset();
    mocks.commitRssFeedUpsert.mockReset();
    mocks.commitRssFeedRemove.mockReset();
    mocks.commitPreferencesPatch.mockReset();
    mocks.commitPersonUpserts.mockReset();
    mocks.commitPersonRemove.mockReset();
    mocks.commitAccountUpserts.mockReset();
    mocks.commitAccountRemove.mockReset();
  });

  it("keeps IndexedDB Library Core active when stale rollback state is present", () => {
    expect(isPwaLibraryCoreEnabled()).toBe(true);
    localStorage.setItem("freed.libraryCore.pwaIndexedDbV1.enabled", "0");
    expect(isPwaLibraryCoreEnabled()).toBe(true);
  });

  it("reads the exact selected IndexedDB checkpoint receipt", async () => {
    const receipt = {
      generationId: "67".repeat(32),
      manifest: {
        descriptor: { contentDigest: "67".repeat(32) },
        transportObjectId: "drive-manifest-4",
      },
    };
    mocks.readSelectedCheckpointReceipt.mockResolvedValue(receipt);

    await expect(readPwaLibraryCoreSelectedCheckpointReceipt()).resolves.toBe(
      receipt,
    );
  });

  it("keeps the selected Library readable while bounded overlay recovery awaits cloud sync", async () => {
    const recovery = {
      canonicalEnvelopeBytes: 16_777_217,
      countsAreLowerBounds: true,
      operationCount: 4_097,
      schemaVersion: 1 as const,
      status: "overflow" as const,
      transactionCount: 513,
    };
    mocks.reapplySelectedIntentOverlay.mockResolvedValueOnce(recovery);
    mocks.readSelectedMaterializedRow.mockResolvedValueOnce({
      accounts: {},
      feeds: {},
      persons: {},
      preferences: createDefaultPreferences(),
    });
    mocks.readSelectedMaterializedPage.mockResolvedValueOnce({
      entries: [],
      nextCursor: null,
      source: SELECTED_SOURCE,
    });

    await expect(initializePwaLibraryCoreState()).resolves.toEqual(
      expect.objectContaining({ items: [], preferences: expect.any(Object) }),
    );
    expect(readPwaLibraryCoreIntentOverlayRecoveryState()).toEqual(recovery);
  });

  it("keeps intent publication fenced while repeated cloud sync advances bounded recovery", async () => {
    const libraryId = "library-runtime-recovery";
    const storageEpoch = "epoch-runtime-recovery";
    const manifestDigest = "6".repeat(64);
    const pointer = {
      activeTransport: "google_drive_app_data_v1",
      causalFrontierDigest: "7".repeat(64),
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
      writerId: "writer-runtime-recovery",
    };
    const overflow = {
      canonicalEnvelopeBytes: 16_777_217,
      countsAreLowerBounds: true,
      operationCount: 4_097,
      schemaVersion: 1,
      status: "overflow" as const,
      transactionCount: 513,
    };
    const ready = {
      canonicalEnvelopeBytes: 0,
      countsAreLowerBounds: false,
      operationCount: 0,
      schemaVersion: 1,
      status: "ready" as const,
      transactionCount: 0,
    };
    const backfillPending = {
      canonicalEnvelopeBytes: 128,
      countsAreLowerBounds: true,
      operationCount: 128,
      schemaVersion: 1,
      status: "backfill_pending" as const,
      transactionCount: 128,
    };
    const secondBackfillPass = {
      ...backfillPending,
      canonicalEnvelopeBytes: 256,
      operationCount: 256,
      transactionCount: 256,
    };
    mocks.reapplySelectedIntentOverlay.mockResolvedValueOnce(overflow);
    mocks.readSelectedMaterializedRow.mockResolvedValue({
      accounts: {},
      feeds: {},
      persons: {},
      preferences: createDefaultPreferences(),
    });
    mocks.readSelectedMaterializedPage.mockResolvedValue({
      entries: [],
      nextCursor: null,
      source: SELECTED_SOURCE,
    });
    await initializePwaLibraryCoreState();

    mocks.discoverControl.mockResolvedValue({
      control: {
        bytes: new TextEncoder().encode(JSON.stringify(pointer)),
      },
      controlFileId: "control-runtime-recovery",
      libraryId,
    });
    mocks.importCheckpoint.mockResolvedValue({ status: "already_complete" });
    mocks.readIntentOverlayRecoveryState
      .mockResolvedValueOnce(backfillPending)
      .mockResolvedValueOnce(secondBackfillPass)
      .mockResolvedValueOnce(ready);
    mocks.readSelectedAcceptedAuthorityState.mockResolvedValue({
      authority_key_id: "8".repeat(64),
      authority_public_key: "9".repeat(64),
      epoch: 1,
      epoch_id: storageEpoch,
      library_id: libraryId,
      observed_frontier: [],
    });

    await expect(
      syncPwaLibraryCoreFromGoogleDrive({ accessToken: "test-token" }),
    ).resolves.toEqual(expect.objectContaining({ items: [] }));
    expect(readPwaLibraryCoreIntentOverlayRecoveryState().status).toBe(
      "backfill_pending",
    );
    expect(mocks.readPendingIntentActors).not.toHaveBeenCalled();
    await expect(
      syncPwaLibraryCoreFromGoogleDrive({ accessToken: "test-token" }),
    ).resolves.toEqual(expect.objectContaining({ items: [] }));
    expect(readPwaLibraryCoreIntentOverlayRecoveryState()).toEqual(
      secondBackfillPass,
    );
    expect(mocks.readPendingIntentActors).not.toHaveBeenCalled();
    await expect(
      syncPwaLibraryCoreFromGoogleDrive({ accessToken: "test-token" }),
    ).resolves.toEqual(expect.objectContaining({ items: [] }));
    expect(mocks.importCheckpoint).toHaveBeenCalledTimes(3);
    expect(readPwaLibraryCoreIntentOverlayRecoveryState().status).toBe("ready");
    expect(mocks.readPendingIntentActors).toHaveBeenCalledTimes(1);
  });

  it("binds search identity to the selected checkpoint instead of stale shell state", async () => {
    mocks.readSelectedMaterializedRow.mockResolvedValue({
      accounts: {},
      feeds: {},
      persons: {},
      preferences: createDefaultPreferences(),
      searchCorpusVersion: 1,
    });
    mocks.readSelectedMaterializedPage.mockResolvedValue({
      entries: [],
      nextCursor: null,
      source: SELECTED_SOURCE,
    });

    const state = await initializePwaLibraryCoreState();

    expect(state.searchCorpusVersion).toBe(SELECTED_SOURCE.selectionSequence);
  });

  it("hydrates synchronized preferences from SQLite instead of the shell", async () => {
    mocks.readSelectedMaterializedRow.mockResolvedValue({
      accounts: {},
      feeds: {},
      persons: {},
      preferences: {
        ...createDefaultPreferences(),
        display: {
          ...createDefaultPreferences().display,
          themeId: "scriptorium",
        },
      },
    });
    mocks.readSelectedMaterializedPage.mockResolvedValue({
      entries: [],
      nextCursor: null,
      source: SELECTED_SOURCE,
    });
    mocks.queryNormalizedLibrary.mockResolvedValue({
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
    expect(mocks.readSelectedMaterializedRow).not.toHaveBeenCalled();
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
    expect(mocks.readSelectedMaterializedPage).not.toHaveBeenCalled();
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
    expect(mocks.readSelectedMaterializedPage).not.toHaveBeenCalled();
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
    expect(mocks.readSelectedMaterializedRow).not.toHaveBeenCalled();
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
    mocks.readSelectedMaterializedRow.mockResolvedValue(null);

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
    expect(mocks.readSelectedMaterializedRow).not.toHaveBeenCalled();
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
    mocks.readSelectedMaterializedRow.mockResolvedValue(null);
    const feed = {
      url: "https://example.test/feed.xml",
      title: "Example",
      enabled: true,
      trackUnread: true,
    };

    await enqueuePwaLibraryCoreRssFeedUpsert(feed);
    await enqueuePwaLibraryCoreRssFeedRemove(feed.url, true);

    expect(mocks.commitRssFeedUpsert).toHaveBeenCalledWith(
      feed,
      expect.any(Number),
    );
    expect(mocks.commitRssFeedRemove).toHaveBeenCalledWith(
      feed.url,
      true,
      expect.any(Number),
    );
  });

  it("routes synchronized preferences through a signed Library Core patch", async () => {
    mocks.commitPreferencesPatch.mockResolvedValue({
      operationId: "op:preferences",
    });
    mocks.readSelectedMaterializedRow.mockResolvedValue(null);
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
    mocks.readSelectedMaterializedRow.mockResolvedValue(null);
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
    mocks.readSelectedMaterializedRow.mockResolvedValue(null);

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
    mocks.readSelectedMaterializedRow.mockResolvedValue(null);
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

  it("clears only fingerprinted sample records and unlinks real accounts", async () => {
    const sampleDataFingerprint = {
      marker: "freed.sample-data.v1" as const,
      batchId: "sample-batch",
      generatedAt: 1,
      generatorVersion: 1,
    };
    mocks.readSelectedMaterializedRow.mockResolvedValue({
      feeds: {
        "https://sample.test/feed": {
          url: "https://sample.test/feed",
          title: "Sample",
          enabled: true,
          trackUnread: true,
          lastFetched: 1,
          sampleDataFingerprint,
        },
      },
      persons: {
        "person:sample": {
          id: "person:sample",
          name: "Sample",
          relationshipStatus: "friend",
          careLevel: 3,
          createdAt: 1,
          updatedAt: 1,
          sampleDataFingerprint,
        },
      },
      accounts: {
        "account:sample": {
          id: "account:sample",
          personId: "person:sample",
          kind: "social",
          provider: "instagram",
          externalId: "sample",
          discoveredFrom: "manual_entry",
          firstSeenAt: 1,
          lastSeenAt: 1,
          createdAt: 1,
          updatedAt: 1,
          sampleDataFingerprint,
        },
        "account:real": {
          id: "account:real",
          personId: "person:sample",
          kind: "social",
          provider: "facebook",
          externalId: "real",
          discoveredFrom: "manual_entry",
          firstSeenAt: 1,
          lastSeenAt: 1,
          createdAt: 1,
          updatedAt: 1,
        },
      },
      preferences: createDefaultPreferences(),
    });
    mocks.readSelectedCollectionPage.mockResolvedValue({
      entries: [],
      nextOrdinal: null,
    });
    await initializePwaLibraryCoreState();
    mocks.queryNormalizedLibrary.mockResolvedValueOnce({
      nextCursor: null,
      rows: [backgroundRow("item:sample", {}, { sampleDataFingerprint })],
    });

    await expect(clearPwaLibraryCoreSampleData()).resolves.toEqual({
      feeds: 1,
      items: 1,
      persons: 1,
      accounts: 1,
      total: 4,
    });

    expect(mocks.commitAccountUpserts).toHaveBeenCalledOnce();
    const unlinkedAccount = mocks.commitAccountUpserts.mock.calls[0]?.[0]?.[0];
    expect(unlinkedAccount).toEqual(
      expect.objectContaining({
        id: "account:real",
        updatedAt: expect.any(Number),
      }),
    );
    expect(unlinkedAccount).not.toHaveProperty("personId");
    expect(mocks.commitAccountRemove).toHaveBeenCalledWith(
      "account:sample",
      expect.any(Number),
    );
    expect(mocks.commitPersonRemove).toHaveBeenCalledWith(
      "person:sample",
      expect.any(Number),
    );
    expect(mocks.commitRssFeedRemove).toHaveBeenCalledWith(
      "https://sample.test/feed",
      false,
      expect.any(Number),
    );
    expect(mocks.commitFeedItemRemove).toHaveBeenCalledWith(
      "item:sample",
      expect.any(Number),
    );
  });
});
