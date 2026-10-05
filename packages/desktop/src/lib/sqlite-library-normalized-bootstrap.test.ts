import catchupVector from "../../../shared/src/library-core/native-handoff-catchup-vector-v1.json";
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
  describeNormalizedLibraryCloudPreflightIdentity, describeNormalizedLibraryCloudIdentity,
  beginNormalizedLibraryCheckpointExport, readNormalizedLibraryCheckpointPage,
  prepareNormalizedLibraryPredecessorCheckpointRead, activateNormalizedLibraryPredecessorCheckpoint,
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

  it("validates a closed count-free identity and preserves full descriptor and native refusal behavior", async () => {
    const identity = { format: "freed_normalized_cloud_preflight_identity_v1", protocolVersion: 2,
      libraryId: "a".repeat(64), authorityEpoch: "b".repeat(64), writerId: "c".repeat(64),
      sourceRevision: 7, causalFrontierDigest: "d".repeat(64), localActorId: "e".repeat(64) };
    const respond = (value: unknown) => mocks.invoke.mockImplementation(async (command: string) =>
      command === "get_desktop_installation_witness" ? "f".repeat(64) : value);
    respond(identity);
    const result = await describeNormalizedLibraryCloudPreflightIdentity();
    expect(result).toEqual(identity);
    expect(Object.isFrozen(result)).toBe(true);
    expect(result.localActorId).not.toBe(result.writerId);
    expect(mocks.invoke).toHaveBeenLastCalledWith("describe_normalized_library_cloud_preflight_identity", { installationWitness: "f".repeat(64) });
    for (const invalid of [null, [], { ...identity, recordCount: 0 }, { ...identity, itemCount: 0 },
      { ...identity, format: "freed_normalized_checkpoint_export_v2" }, { ...identity, protocolVersion: 3 },
      { ...identity, sourceRevision: -1 }, { ...identity, sourceRevision: Number.MAX_SAFE_INTEGER + 1 },
      { ...identity, sourceRevision: 1.5 }, { ...identity, localActorId: "invalid" },
      { ...identity, writerId: "C".repeat(64) }, { ...identity, libraryId: undefined },
      { ...identity, [Symbol("extra")]: 1 }, Object.assign(Object.create({ extra: 1 }), identity)]) {
      respond(invalid);
      await expect(describeNormalizedLibraryCloudPreflightIdentity()).rejects.toThrow("invalid cloud preflight identity");
    }
    const getter = vi.fn(() => identity.libraryId);
    const accessor = { ...identity };
    Object.defineProperty(accessor, "libraryId", { enumerable: true, get: getter });
    respond(accessor);
    await expect(describeNormalizedLibraryCloudPreflightIdentity()).rejects.toThrow();
    expect(getter).not.toHaveBeenCalled();
    mocks.invoke.mockResolvedValueOnce("invalid witness");
    await expect(describeNormalizedLibraryCloudPreflightIdentity()).rejects.toThrow("installation witness");
    const refusal = new Error("native authority refused");
    mocks.invoke.mockResolvedValueOnce("f".repeat(64)).mockRejectedValueOnce(refusal);
    await expect(describeNormalizedLibraryCloudPreflightIdentity()).rejects.toBe(refusal);
    const full = { ...identity, format: "freed_normalized_checkpoint_export_v2", recordCount: 17, itemCount: 2 };
    respond(full);
    await expect(describeNormalizedLibraryCloudIdentity()).resolves.toEqual(full);
    expect(mocks.invoke).toHaveBeenLastCalledWith("describe_normalized_library_cloud_identity", { installationWitness: "f".repeat(64) });
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

  it("bounds native predecessor requests and decodes the shared signed checkpoint reference", async () => {
    mocks.invoke.mockResolvedValueOnce(catchupVector.expectedReadProof);
    const proofs = await prepareNormalizedLibraryPredecessorCheckpointRead("successor");
    expect(proofs).toEqual([catchupVector.expectedReadProof]);
    const proof = proofs?.[0];
    expect(mocks.invoke).toHaveBeenLastCalledWith("prepare_normalized_library_predecessor_checkpoint_read", { request: { stageId: "successor" } });
    if (!proof) throw new Error("missing read reference");
    const activation = { stageId: "predecessor", replaceExisting: true, followerReceipt: {
      checkpointGeneration: proof.pointer.generation, writerActorId: proof.pointer.writerId,
      manifestObjectKey: proof.pointer.manifest.descriptor.objectKey,
      manifestTransportObjectId: proof.pointer.manifest.transportObjectId,
      manifestContentDigest: proof.pointer.manifest.descriptor.contentDigest,
      controlRevision: proof.controlRevision, installedAt: 2400,
    } };
    const receipt = { stageId: "predecessor", authorityEpoch: proof.pointer.storageEpoch,
      libraryId: proof.pointer.libraryId, sourceRevision: proof.sourceRevision, recordCount: 86,
      canonicalBytes: 1, checkpointDigest: proof.checkpointDigest };
    mocks.invoke.mockResolvedValueOnce(receipt);
    await expect(activateNormalizedLibraryPredecessorCheckpoint(activation, "successor")).resolves.toEqual(receipt);
    expect(mocks.invoke).toHaveBeenLastCalledWith("activate_normalized_library_predecessor_checkpoint", {
      request: { stageId: "predecessor", successorStageId: "successor", followerReceipt: activation.followerReceipt },
    });
    await expect(prepareNormalizedLibraryPredecessorCheckpointRead("x".repeat(256))).rejects.toThrow();
    await expect(activateNormalizedLibraryPredecessorCheckpoint(activation, "predecessor")).rejects.toThrow();
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
  });

  it("loads coherent bounded counts and preferences after verified native selection without reading a shell", async () => {
    mocks.invoke.mockResolvedValue({ state: "standalone_primary", role: "primary", libraryId: "a".repeat(64), authorityEpochId: "b".repeat(64), actorId: "c".repeat(64) });
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
      if (request.queryId === "rss_item_summary_v1") {
        return { queryId: request.queryId, schemaVersion: 1, source: { generationId: "1".repeat(64), projectionRevision: 7, transitionSequence: 11 }, totalCount: 19, unreadCount: 0 };
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
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
    expect(mocks.invoke.mock.calls.every(([command]) => command === "normalized_desktop_installation_status")).toBe(true);
    expect(
      mocks.queryNormalizedLibrary.mock.calls.map(
        ([request]) => request.queryId,
      ),
    ).toEqual(["library_facet_summary_v1", "rss_item_summary_v1", "preferences_snapshot_v1"]);
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
                  linkPreviewUrl: null,
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

  it("resolves a 22,007-post workload without exhausting the native 64-reader registry", async () => {
    const ids = Array.from({ length: 22_007 }, (_, index) => `synthetic-${index.toString().padStart(5, "0")}`);
    const source = { generationId: "1".repeat(64), projectionRevision: 7, transitionSequence: 7 };
    let active = 0;
    let peak = 0;
    let capacityFailures = 0;
    let details = 0;
    mocks.queryNormalizedLibrary.mockImplementation(async (request) => {
      if (active >= 64) { capacityFailures++; throw new Error("QUERY_CAPACITY"); }
      active++; peak = Math.max(peak, active);
      try {
        // An async IPC turn keeps ownership alive while the remaining reads register.
        await new Promise<void>((resolve) => queueMicrotask(resolve));
        if (request.queryId === "optimistic_fields_v1") return { queryId: request.queryId, rows: [], schemaVersion: 1, source };
        if (request.queryId === "item_annotations_v1") return { queryId: request.queryId, globalId: request.globalId, tags: [], highlights: [], schemaVersion: 1, source };
        if (request.queryId !== "item_detail_v1") throw new Error("unexpected query");
        details++;
        return { source, item: { card: { archived: false, authorAvatarUrl: null, authorDisplayName: "Synthetic author", authorHandle: "synthetic", authorId: "synthetic-author", capturedAt: 20,
          contentSignalTags: [], contentText: "Synthetic stored post body. ".repeat(64), contentType: "post", engagementComments: 2, engagementLikes: 10, eventConfidenceBasisPoints: null, eventStartsAt: null,
          globalId: request.globalId, liked: false, likedAt: null, likedSyncedAt: null, linkPreviewTitle: null, linkPreviewUrl: null, locationName: null, mediaTypes: [], mediaUrls: [], platform: "rss", publishedAt: 10,
          readAt: null, readingTimeMinutes: null, saved: false, sourceUrl: null, tags: [] }, contentBody: { blobDigest: null, storage: "inline" }, mediaBlobDigests: [], preservedBody: { blobDigest: null, storage: "none" } } };
      } finally { active--; }
    });
    const result: FeedItem[] = [];
    for (let offset = 0; offset < ids.length; offset += 512) {
      result.push(...await readSqliteItems(ids.slice(offset, offset + 512)));
    }
    expect(result.map((item) => item.globalId)).toEqual(ids);
    expect(details).toBe(ids.length);
    expect(capacityFailures).toBe(0);
    expect(peak).toBeLessThanOrEqual(8);
    expect(active).toBe(0);
    expect(result[0]?.content.text).toContain("Synthetic stored post body");
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("drains failed item-read siblings before rejecting and never starts the next batch", async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    let active = 0;
    const failure = new Error("QUERY_CANCELLED");
    mocks.queryNormalizedLibrary.mockImplementation(async (request) => {
      if (request.globalId === "synthetic-failure") throw failure;
      active++;
      try { await blocked; return { item: null }; }
      finally { active--; }
    });
    let rejected = false;
    const pending = readSqliteItems(["synthetic-failure", "synthetic-1", "synthetic-2", "synthetic-3", "synthetic-must-not-start"])
      .catch((error) => { rejected = true; expect(error).toBe(failure); });
    await Promise.resolve();
    expect(rejected).toBe(false);
    expect(mocks.queryNormalizedLibrary).toHaveBeenCalledTimes(4);
    release();
    await pending;
    expect(active).toBe(0);
    expect(rejected).toBe(true);
    expect(mocks.queryNormalizedLibrary).toHaveBeenCalledTimes(4);
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
