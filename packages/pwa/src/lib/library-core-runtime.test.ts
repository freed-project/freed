import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultPreferences } from "@freed/shared";
import { createLibraryCoreImmutableObjectKey } from "@freed/shared/library-core";

const mocks = vi.hoisted(() => ({
  enqueueReadAssignments: vi.fn(),
  enqueueFeedItemCaptures: vi.fn(),
  enqueueFeedItemRemove: vi.fn(),
  enqueueRssFeedRemove: vi.fn(),
  enqueueRssFeedUpsert: vi.fn(),
  enqueuePreferencesLeafAssignment: vi.fn(),
  enqueuePersonUpserts: vi.fn(),
  enqueuePersonRemove: vi.fn(),
  enqueueAccountUpserts: vi.fn(),
  enqueueAccountRemove: vi.fn(),
  enqueueUserStateAssignments: vi.fn(),
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
}));

vi.mock("./library-core-portable-checkpoint-store", () => ({
  PWA_LIBRARY_CORE_ACCOUNT_UPSERT_BATCH_LIMIT: 128,
  PWA_LIBRARY_CORE_FEED_ITEM_UPSERT_BATCH_LIMIT: 128,
  PWA_LIBRARY_CORE_PERSON_UPSERT_BATCH_LIMIT: 128,
  createPwaLibraryCorePortableCheckpointStore: () => ({
    enqueueReadAssignments: mocks.enqueueReadAssignments,
    enqueueFeedItemCaptures: mocks.enqueueFeedItemCaptures,
    enqueueFeedItemRemove: mocks.enqueueFeedItemRemove,
    enqueueRssFeedRemove: mocks.enqueueRssFeedRemove,
    enqueueRssFeedUpsert: mocks.enqueueRssFeedUpsert,
    enqueuePreferencesLeafAssignment: mocks.enqueuePreferencesLeafAssignment,
    enqueuePersonUpserts: mocks.enqueuePersonUpserts,
    enqueuePersonRemove: mocks.enqueuePersonRemove,
    enqueueAccountUpserts: mocks.enqueueAccountUpserts,
    enqueueAccountRemove: mocks.enqueueAccountRemove,
    enqueueUserStateAssignments: mocks.enqueueUserStateAssignments,
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
  readPwaLibraryCoreIntentOverlayRecoveryState,
  readPwaLibraryCoreItemDetail,
  readPwaLibraryCoreSelectedCheckpointReceipt,
  scanPwaLibraryCoreItems,
  syncPwaLibraryCoreFromGoogleDrive,
} from "./library-core-runtime";

function entry(registryKey: string, globalId: string) {
  return {
    primaryKey: JSON.stringify(globalId),
    registryKey,
    row: { globalId },
  };
}

const SELECTED_SOURCE = Object.freeze({
  generationId: "45".repeat(32),
  selectionSequence: 7,
});

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
    mocks.enqueueUserStateAssignments.mockReset();
    mocks.enqueueReadAssignments.mockReset();
    mocks.enqueueFeedItemCaptures.mockReset();
    mocks.enqueueFeedItemRemove.mockReset();
    mocks.enqueueRssFeedRemove.mockReset();
    mocks.enqueueRssFeedUpsert.mockReset();
    mocks.enqueuePreferencesLeafAssignment.mockReset();
    mocks.enqueuePersonUpserts.mockReset();
    mocks.enqueuePersonRemove.mockReset();
    mocks.enqueueAccountUpserts.mockReset();
    mocks.enqueueAccountRemove.mockReset();
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

  it("pages the selected IndexedDB generation and stops without reading another page", async () => {
    mocks.readSelectedMaterializedPage
      .mockResolvedValueOnce({
        entries: [entry("10_feed_items", "item-1")],
        nextCursor: "cursor-1",
        source: SELECTED_SOURCE,
      })
      .mockResolvedValueOnce({
        entries: [entry("00_library_shell", "shell")],
        nextCursor: "cursor-2",
        source: SELECTED_SOURCE,
      })
      .mockResolvedValueOnce({
        entries: [entry("10_feed_items", "item-2")],
        nextCursor: "cursor-3",
        source: SELECTED_SOURCE,
      });
    const visited: string[][] = [];

    await scanPwaLibraryCoreItems((items) => {
      visited.push(items.map((item) => item.globalId));
      return visited.length === 2 ? "stop" : "continue";
    });

    expect(visited).toEqual([["item-1"], ["item-2"]]);
    expect(mocks.readSelectedMaterializedPage).toHaveBeenCalledTimes(3);
    expect(mocks.readSelectedMaterializedPage.mock.calls).toEqual([
      [{ cursor: null, limit: 32 }],
      [{ cursor: "cursor-1", limit: 32 }],
      [{ cursor: "cursor-2", limit: 32 }],
    ]);
  });

  it("rejects a checkpoint selection change instead of mixing generations", async () => {
    mocks.readSelectedMaterializedPage
      .mockResolvedValueOnce({
        entries: [entry("10_feed_items", "old-item")],
        nextCursor: "cursor-1",
        source: SELECTED_SOURCE,
      })
      .mockResolvedValueOnce({
        entries: [entry("10_feed_items", "new-item")],
        nextCursor: null,
        source: {
          generationId: "67".repeat(32),
          selectionSequence: SELECTED_SOURCE.selectionSequence + 1,
        },
      });

    await expect(scanPwaLibraryCoreItems(() => "continue")).rejects.toThrow(
      "changed during its bounded scan",
    );
  });

  it("reads one complete item from IndexedDB without consulting Automerge", async () => {
    mocks.readSelectedMaterializedRow.mockResolvedValue({
      globalId: "item-9",
      preservedContent: { html: "<p>Saved locally</p>" },
    });

    await expect(readPwaLibraryCoreItemDetail("item-9")).resolves.toEqual({
      globalId: "item-9",
      preservedContent: { html: "<p>Saved locally</p>" },
    });
    expect(mocks.readSelectedMaterializedRow).toHaveBeenCalledWith(
      "10_feed_items",
      "item-9",
    );
  });

  it("queues user-state changes through the signed IndexedDB intent path", async () => {
    mocks.enqueueUserStateAssignments.mockResolvedValue({
      operationId: "op:assignment",
    });
    mocks.readSelectedMaterializedRow.mockResolvedValue({
      globalId: "item-9",
      userState: { liked: false },
    });

    await enqueuePwaLibraryCoreUserStateToggle("item-9", "liked");

    expect(mocks.enqueueUserStateAssignments).toHaveBeenCalledOnce();
    expect(mocks.enqueueUserStateAssignments).toHaveBeenCalledWith([
      {
        assigned: true,
        assignedAtMs: expect.any(Number),
        entityId: "item-9",
        field: "liked",
      },
    ]);
  });

  it("queues FeedItem removal through the signed IndexedDB intent path", async () => {
    mocks.enqueueFeedItemRemove.mockResolvedValue({ operationId: "op:remove" });

    await enqueuePwaLibraryCoreFeedItemRemove("item-9");

    expect(mocks.enqueueFeedItemRemove).toHaveBeenCalledOnce();
    expect(mocks.enqueueFeedItemRemove).toHaveBeenCalledWith({
      entityId: "item-9",
      removedAtMs: expect.any(Number),
    });
  });

  it("batches sanitized FeedItem captures through the signed IndexedDB intent path", async () => {
    mocks.enqueueFeedItemCaptures.mockResolvedValue({
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

    expect(mocks.enqueueFeedItemCaptures).toHaveBeenCalledTimes(2);
    expect(mocks.enqueueFeedItemCaptures.mock.calls[0]?.[0]).toHaveLength(128);
    expect(mocks.enqueueFeedItemCaptures.mock.calls[1]?.[0]).toHaveLength(1);
    expect(
      mocks.enqueueFeedItemCaptures.mock.calls[0]?.[0]?.[0],
    ).not.toHaveProperty("priority");
    expect(
      mocks.enqueueFeedItemCaptures.mock.calls[0]?.[0]?.[0],
    ).not.toHaveProperty("priorityComputedAt");

    await enqueuePwaLibraryCoreFeedItemCaptures([
      items[0]!,
      {
        ...items[0]!,
        content: { text: "Later", mediaUrls: [], mediaTypes: [] },
      },
    ]);
    expect(mocks.enqueueFeedItemCaptures).toHaveBeenCalledTimes(4);
    expect(mocks.enqueueFeedItemCaptures.mock.calls[2]?.[0]).toHaveLength(1);
    expect(mocks.enqueueFeedItemCaptures.mock.calls[3]?.[0]).toHaveLength(1);
  });

  it("repairs saved archived items without waking Automerge", async () => {
    mocks.enqueueUserStateAssignments.mockResolvedValue({
      operationId: "op:unarchive",
    });
    mocks.readSelectedCollectionPage.mockResolvedValueOnce({
      entries: [
        {
          value: {
            registry_key: "10_feed_items",
            row: {
              globalId: "saved-archived",
              userState: { saved: true, archived: true },
            },
          },
        },
        {
          value: {
            registry_key: "10_feed_items",
            row: {
              globalId: "plain-archived",
              userState: { archived: true },
            },
          },
        },
      ],
      nextOrdinal: null,
    });

    await enqueuePwaLibraryCoreUnarchiveSavedItems();

    expect(mocks.enqueueUserStateAssignments).toHaveBeenCalledWith([
      {
        assigned: false,
        assignedAtMs: expect.any(Number),
        entityId: "saved-archived",
        field: "archived",
      },
    ]);
  });

  it("deletes only archived unsaved items without waking Automerge", async () => {
    mocks.enqueueFeedItemRemove.mockResolvedValue({ operationId: "op:remove" });
    mocks.readSelectedCollectionPage.mockResolvedValueOnce({
      entries: [
        {
          value: {
            registry_key: "10_feed_items",
            row: {
              globalId: "plain-archived",
              userState: { archived: true },
            },
          },
        },
        {
          value: {
            registry_key: "10_feed_items",
            row: {
              globalId: "saved-archived",
              userState: { saved: true, archived: true },
            },
          },
        },
      ],
      nextOrdinal: null,
    });

    await enqueuePwaLibraryCoreDeleteAllArchived();

    expect(mocks.enqueueFeedItemRemove).toHaveBeenCalledOnce();
    expect(mocks.enqueueFeedItemRemove).toHaveBeenCalledWith({
      entityId: "plain-archived",
      removedAtMs: expect.any(Number),
    });
  });

  it("marks the complete selected platform read in bounded intent batches", async () => {
    mocks.enqueueReadAssignments.mockResolvedValue({ operationId: "op:read" });
    mocks.readSelectedCollectionPage.mockResolvedValueOnce({
      entries: [
        {
          value: {
            registry_key: "10_feed_items",
            row: {
              globalId: "rss-unread",
              platform: "rss",
              userState: {},
            },
          },
        },
        {
          value: {
            registry_key: "10_feed_items",
            row: {
              globalId: "youtube-unread",
              platform: "youtube",
              userState: {},
            },
          },
        },
        {
          value: {
            registry_key: "10_feed_items",
            row: {
              globalId: "rss-read",
              platform: "rss",
              userState: { readAt: 1 },
            },
          },
        },
      ],
      nextOrdinal: null,
    });
    mocks.readSelectedMaterializedRow.mockResolvedValue(null);

    await enqueuePwaLibraryCoreMarkAllAsRead("rss");

    expect(mocks.enqueueReadAssignments).toHaveBeenCalledOnce();
    expect(mocks.enqueueReadAssignments).toHaveBeenCalledWith({
      entityIds: ["rss-unread"],
      readAtMs: expect.any(Number),
    });
  });

  it("archives only eligible selected items through explicit assignments", async () => {
    mocks.enqueueUserStateAssignments.mockResolvedValue({
      operationId: "op:archive",
    });
    mocks.readSelectedMaterializedRow
      .mockResolvedValueOnce({
        globalId: "eligible",
        userState: { readAt: 1 },
      })
      .mockResolvedValueOnce({
        globalId: "saved",
        userState: { readAt: 1, saved: true },
      })
      .mockResolvedValueOnce({
        globalId: "unread",
        userState: {},
      });

    await enqueuePwaLibraryCoreArchiveItems([
      "eligible",
      "saved",
      "unread",
      "eligible",
    ]);

    expect(mocks.enqueueUserStateAssignments).toHaveBeenCalledOnce();
    expect(mocks.enqueueUserStateAssignments).toHaveBeenCalledWith([
      {
        assigned: true,
        assignedAtMs: expect.any(Number),
        entityId: "eligible",
        field: "archived",
      },
    ]);
  });

  it("archives the complete selected scope in one bounded assignment batch", async () => {
    mocks.enqueueUserStateAssignments.mockResolvedValue({
      operationId: "op:bulk",
    });
    mocks.readSelectedCollectionPage.mockResolvedValueOnce({
      entries: [
        {
          value: {
            registry_key: "10_feed_items",
            row: {
              globalId: "rss-eligible",
              platform: "rss",
              rssSource: { feedUrl: "https://example.test/feed" },
              userState: { readAt: 1 },
            },
          },
        },
        {
          value: {
            registry_key: "10_feed_items",
            row: {
              globalId: "rss-saved",
              platform: "rss",
              rssSource: { feedUrl: "https://example.test/feed" },
              userState: { readAt: 1, saved: true },
            },
          },
        },
        {
          value: {
            registry_key: "10_feed_items",
            row: {
              globalId: "other-feed",
              platform: "rss",
              rssSource: { feedUrl: "https://other.test/feed" },
              userState: { readAt: 1 },
            },
          },
        },
      ],
      nextOrdinal: null,
    });

    await enqueuePwaLibraryCoreArchiveAllReadUnsaved(
      "rss",
      "https://example.test/feed",
    );

    expect(mocks.enqueueUserStateAssignments).toHaveBeenCalledWith([
      {
        assigned: true,
        assignedAtMs: expect.any(Number),
        entityId: "rss-eligible",
        field: "archived",
      },
    ]);
  });

  it("routes RSS configuration through signed Library Core intents", async () => {
    mocks.enqueueRssFeedUpsert.mockResolvedValue({ operationId: "op:rss:add" });
    mocks.enqueueRssFeedRemove.mockResolvedValue({
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

    expect(mocks.enqueueRssFeedUpsert).toHaveBeenCalledWith(feed);
    expect(mocks.enqueueRssFeedRemove).toHaveBeenCalledWith({
      includeItems: true,
      removedAtMs: expect.any(Number),
      url: feed.url,
    });
  });

  it("routes synchronized preferences through a signed Library Core patch", async () => {
    mocks.enqueuePreferencesLeafAssignment.mockResolvedValue({
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

    expect(mocks.enqueuePreferencesLeafAssignment).toHaveBeenCalledWith(update);
  });

  it("batches synchronized Persons and removes device-local graph state", async () => {
    mocks.enqueuePersonUpserts.mockResolvedValue({
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

    expect(mocks.enqueuePersonUpserts).toHaveBeenCalledOnce();
    expect(mocks.enqueuePersonUpserts).toHaveBeenCalledWith([
      {
        id: "person:one",
        name: "One Person",
        relationshipStatus: "friend",
        careLevel: 3,
        createdAt: 1,
        updatedAt: 2,
      },
    ]);
  });

  it("queues one atomic Person and linked-account removal", async () => {
    mocks.enqueuePersonRemove.mockResolvedValue({
      operationId: "op:person-remove",
    });
    mocks.readSelectedMaterializedRow.mockResolvedValue(null);

    await enqueuePwaLibraryCorePersonRemove("person:one");

    expect(mocks.enqueuePersonRemove).toHaveBeenCalledOnce();
    expect(mocks.enqueuePersonRemove).toHaveBeenCalledWith(
      "person:one",
      expect.any(Number),
    );
  });

  it("batches synchronized Accounts, strips graph state, and queues removal", async () => {
    mocks.enqueueAccountUpserts.mockResolvedValue({
      operationId: "op:accounts",
    });
    mocks.enqueueAccountRemove.mockResolvedValue({
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

    expect(mocks.enqueueAccountUpserts).toHaveBeenCalledWith([
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
    ]);
    expect(mocks.enqueueAccountRemove).toHaveBeenCalledWith(
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
    mocks.readSelectedCollectionPage.mockImplementation(({ limit }) =>
      Promise.resolve({
        entries:
          limit === 32
            ? [
                {
                  value: {
                    registry_key: "10_feed_items",
                    row: {
                      globalId: "item:sample",
                      sampleDataFingerprint,
                    },
                  },
                },
              ]
            : [],
        nextOrdinal: null,
      }),
    );
    await initializePwaLibraryCoreState();

    await expect(clearPwaLibraryCoreSampleData()).resolves.toEqual({
      feeds: 1,
      items: 1,
      persons: 1,
      accounts: 1,
      total: 4,
    });

    expect(mocks.enqueueAccountUpserts).toHaveBeenCalledOnce();
    const unlinkedAccount = mocks.enqueueAccountUpserts.mock.calls[0]?.[0]?.[0];
    expect(unlinkedAccount).toEqual(
      expect.objectContaining({
        id: "account:real",
        updatedAt: expect.any(Number),
      }),
    );
    expect(unlinkedAccount).not.toHaveProperty("personId");
    expect(mocks.enqueueAccountRemove).toHaveBeenCalledWith(
      "account:sample",
      expect.any(Number),
    );
    expect(mocks.enqueuePersonRemove).toHaveBeenCalledWith(
      "person:sample",
      expect.any(Number),
    );
    expect(mocks.enqueueRssFeedRemove).toHaveBeenCalledWith({
      includeItems: false,
      removedAtMs: expect.any(Number),
      url: "https://sample.test/feed",
    });
    expect(mocks.enqueueFeedItemRemove).toHaveBeenCalledWith({
      entityId: "item:sample",
      removedAtMs: expect.any(Number),
    });
  });
});
