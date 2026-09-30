import { createHash, webcrypto } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  createLibraryCoreNormalizedCheckpointRecordV2,
  createLibraryCoreImmutableObjectKey,
  createLibraryCoreNormalizedCheckpointDigestAccumulatorV2,
  LIBRARY_CORE_CHECKPOINT_MANIFEST_PAGE_RECORD_LIMIT,
  LIBRARY_CORE_CHECKPOINT_PAGE_MAXIMUM_DECODED_BYTES,
  LIBRARY_CORE_CHECKPOINT_PAGE_MAXIMUM_RECORDS,
  LIBRARY_CORE_CHECKPOINT_RECORD_MAXIMUM_CANONICAL_BYTES,
  libraryCoreNormalizedCheckpointRecordIdentityV2,
  parseLibraryCoreNormalizedCheckpointRecordV2,
  parseLibraryCoreImmutableObjectDescriptorV1,
  type LibraryCoreImmutableObjectDescriptorV1,
  type LibraryCoreLowercaseHex64,
} from "@freed/shared/library-core";
import {
  importLibraryCoreNormalizedCheckpointV2,
  stageLibraryCoreNormalizedCheckpointV2,
  catchUpLibraryCorePredecessorCheckpointV1,
  prepareLibraryCoreNormalizedCheckpointPagesV2,
  publishLibraryCoreNormalizedCheckpointV2,
  reassignLibraryCoreNormalizedCheckpointV2,
} from "./library-core-normalized-checkpoint.js";
import type {
  LibraryCoreControlCompareAndSwapResultV1,
  LibraryCoreControlReadV1,
  LibraryCoreImmutablePublicationAdapterV1,
  LibraryCorePreparedImmutableObjectV1,
  LibraryCorePublishedImmutableObjectReceiptV1,
} from "./library-core-immutable-publication.js";
import { decodeLibraryCoreWireObjectV1 } from "./library-core-wire-object.js";

const subtle = webcrypto.subtle as unknown as SubtleCrypto;
const libraryId = "ab".repeat(32) as LibraryCoreLowercaseHex64;
const authorityEpoch = "cd".repeat(32) as LibraryCoreLowercaseHex64;
const writerId = "ef".repeat(32) as LibraryCoreLowercaseHex64;
const frontierDigest = "12".repeat(32) as LibraryCoreLowercaseHex64;

class MemoryCheckpointAdapter
  implements LibraryCoreImmutablePublicationAdapterV1<Uint8Array>
{
  readonly objects = new Map<
    string,
    {
      readonly bytes: Uint8Array;
      readonly descriptor: LibraryCoreImmutableObjectDescriptorV1;
    }
  >();
  control: LibraryCoreControlReadV1 = { revision: null, bytes: null };

  async readControl(): Promise<LibraryCoreControlReadV1> {
    return this.control;
  }

  async putImmutable(
    object: LibraryCorePreparedImmutableObjectV1<Uint8Array>,
  ): Promise<{ readonly transportObjectId: string }> {
    const transportObjectId = `object-${(this.objects.size + 1).toLocaleString("en-US", { useGrouping: false })}`;
    this.objects.set(transportObjectId, {
      bytes: object.source.slice(),
      descriptor: object.descriptor,
    });
    return { transportObjectId };
  }

  async verifyImmutable(
    receipt: LibraryCorePublishedImmutableObjectReceiptV1,
  ): Promise<LibraryCoreImmutableObjectDescriptorV1> {
    const stored = this.objects.get(receipt.transportObjectId);
    if (stored === undefined) throw new Error("missing checkpoint object");
    return parseLibraryCoreImmutableObjectDescriptorV1({
      ...stored.descriptor,
      byteLength: stored.bytes.byteLength,
      contentDigest: createHash("sha256")
        .update(stored.bytes)
        .digest("hex"),
    });
  }

  async compareAndSwapControl(input: {
    readonly expectedRevision: string | null;
    readonly bytes: Uint8Array;
  }): Promise<LibraryCoreControlCompareAndSwapResultV1> {
    if (input.expectedRevision !== this.control.revision) {
      return { status: "conflict", current: this.control };
    }
    this.control = { revision: "revision-1", bytes: input.bytes.slice() };
    return { status: "committed", revision: "revision-1" };
  }

  async readImmutable(
    receipt: LibraryCorePublishedImmutableObjectReceiptV1,
  ): Promise<Uint8Array> {
    const stored = this.objects.get(receipt.transportObjectId);
    if (stored === undefined) throw new Error("missing checkpoint object");
    return stored.bytes.slice();
  }
}

describe("normalized checkpoint publication", () => {
  it("splits native-sized exports at the immutable manifest page bound", async () => {
    const records = [
      createLibraryCoreNormalizedCheckpointRecordV2({
        registryKey: "00_checkpoint_header",
        primaryKey: "checkpoint",
        payload: {
          authorityEpoch,
          checkpointId: `${libraryId}:${authorityEpoch}:7`,
          createdAtMs: 1_000,
          libraryId,
          schemaVersion: 1,
          sourceRevision: 7,
        },
      }),
      ...Array.from(
        { length: LIBRARY_CORE_CHECKPOINT_MANIFEST_PAGE_RECORD_LIMIT + 1 },
        (_, index) =>
          createLibraryCoreNormalizedCheckpointRecordV2({
            registryKey: "13_feed_item_tag",
            primaryKey: [
              `item-${index.toLocaleString("en-US", {
                minimumIntegerDigits: 5,
                useGrouping: false,
              })}`,
              "favorite",
            ],
            payload: { tag: "favorite" },
          }),
      ),
    ];
    const pages = [];
    for await (const page of prepareLibraryCoreNormalizedCheckpointPagesV2({
      descriptor: {
        format: "freed_normalized_checkpoint_export_v2",
        protocolVersion: 2,
        libraryId,
        authorityEpoch,
        writerId,
        sourceRevision: 7,
        causalFrontierDigest: frontierDigest,
        recordCount: records.length,
        itemCount: 0,
      },
      generation: 0,
      records,
      subtle,
    })) {
      pages.push(page);
    }

    expect(pages.map((page) => page.recordCount)).toEqual([
      LIBRARY_CORE_CHECKPOINT_MANIFEST_PAGE_RECORD_LIMIT,
      2,
    ]);

    const adapter = new MemoryCheckpointAdapter();
    const published = await publishLibraryCoreNormalizedCheckpointV2({
      activeTransport: "google_drive_app_data_v1",
      adapter,
      descriptor: {
        format: "freed_normalized_checkpoint_export_v2",
        protocolVersion: 2,
        libraryId,
        authorityEpoch,
        writerId,
        sourceRevision: 7,
        causalFrontierDigest: frontierDigest,
        recordCount: records.length,
        itemCount: 0,
      },
      expectedControl: { revision: null, pointer: null },
      generation: 0,
      records,
      subtle,
    });
    expect(published.status).toBe("committed");
    if (published.status === "conflict") throw new Error("setup failed");
    const successorEpoch = "34".repeat(32) as LibraryCoreLowercaseHex64;
    const successorFrontier = "56".repeat(32) as LibraryCoreLowercaseHex64;
    const successorWriter = "78".repeat(32) as LibraryCoreLowercaseHex64;
    const certificateBytes = new TextEncoder().encode("transport-only certificate fixture");
    const certificateDigest = createHash("sha256").update(certificateBytes).digest("hex");
    const successorRecords = [createLibraryCoreNormalizedCheckpointRecordV2({
      registryKey: "00_checkpoint_header", primaryKey: "checkpoint", payload: {
        authorityEpoch: successorEpoch, checkpointId: `${libraryId}:${successorEpoch}:7`,
        createdAtMs: 1_000, libraryId, schemaVersion: 1, sourceRevision: 7,
      },
    }), ...records.slice(1)];
    const reassigned = await reassignLibraryCoreNormalizedCheckpointV2({
      activeTransport: "google_drive_app_data_v1", adapter,
      descriptor: { format: "freed_normalized_checkpoint_export_v2", protocolVersion: 2,
        libraryId, authorityEpoch: successorEpoch, writerId: successorWriter, sourceRevision: 7,
        causalFrontierDigest: successorFrontier, recordCount: successorRecords.length, itemCount: 0 },
      expectedControl: { pointer: published.controlPointer, revision: published.revision },
      handoffFrontiers: { kind: "cooperative_handoff_v1", predecessor: frontierDigest, successor: successorFrontier },
      epochCertificate: { source: certificateBytes, descriptor: parseLibraryCoreImmutableObjectDescriptorV1({
        objectKey: createLibraryCoreImmutableObjectKey({ kind: "epoch_certificate", libraryId,
          epochId: successorEpoch, digest: certificateDigest }),
        contentDigest: certificateDigest, byteLength: certificateBytes.length,
      }) }, generation: 0, records: successorRecords, subtle,
    });
    expect(reassigned).toMatchObject({ status: "committed", controlPointer: {
      storageEpoch: successorEpoch, writerId: successorWriter, causalFrontierDigest: successorFrontier,
    } });
  });

  it("stores exact typed normalized records without a shell envelope", async () => {
    const longFeedItemId = `https://example.com/items/${"path-segment/".repeat(96)}`;
    const records = [
      createLibraryCoreNormalizedCheckpointRecordV2({
        registryKey: "00_checkpoint_header",
        primaryKey: "checkpoint",
        payload: {
          authorityEpoch,
          checkpointId: `${libraryId}:${authorityEpoch}:7`,
          createdAtMs: 1_000,
          libraryId,
          schemaVersion: 1,
          sourceRevision: 7,
        },
      }),
      createLibraryCoreNormalizedCheckpointRecordV2({
        registryKey: "10_feed_item",
        primaryKey: longFeedItemId,
        payload: {
          archived: false,
          archivedAt: null,
          authorAvatarUrl: null,
          authorDisplayName: "Writer",
          authorHandle: null,
          authorId: null,
          capturedAt: 1_000,
          contentText: "Bounded content",
          contentTextBlobDigest: null,
          contentType: "article",
          engagementComments: null,
          engagementLikes: null,
          engagementReposts: null,
          engagementViews: null,
          fbGroupId: null,
          fbGroupName: null,
          fbGroupUrl: null,
          hidden: false,
          liked: null,
          likedAt: null,
          likedSyncedAt: null,
          linkDescription: null,
          linkTitle: null,
          linkUrl: null,
          locationLat: null,
          locationLng: null,
          locationName: null,
          locationSource: null,
          locationUrl: null,
          platform: "rss",
          preservedAt: null,
          preservedAuthor: null,
          preservedPublishedAt: null,
          preservedReadingTime: null,
          preservedText: null,
          preservedTextBlobDigest: null,
          preservedWordCount: null,
          priority: null,
          priorityComputedAt: null,
          publishedAt: 900,
          readAt: null,
          rssFeedTitle: "Feed",
          rssFeedUrl: "https://example.com/feed",
          rssSiteUrl: "https://example.com",
          sampleBatchId: null,
          sampleGeneratedAt: null,
          sampleGeneratorVersion: null,
          saved: false,
          savedAt: null,
          seenSyncedAt: null,
          sourceUrl: "https://example.com/item-1",
          timeRangeEndsAt: null,
          timeRangeKind: null,
          timeRangeStartsAt: null,
          updatedAt: 1_000,
        },
      }),
    ];
    expect(
      new TextEncoder().encode(
        libraryCoreNormalizedCheckpointRecordIdentityV2(records[1]!),
      ).byteLength,
    ).toBeGreaterThan(512);
    const pages = [];
    for await (const page of prepareLibraryCoreNormalizedCheckpointPagesV2({
      descriptor: {
        format: "freed_normalized_checkpoint_export_v2",
        protocolVersion: 2,
        libraryId,
        authorityEpoch,
        writerId,
        sourceRevision: 7,
        causalFrontierDigest: frontierDigest,
        recordCount: records.length,
        itemCount: 1,
      },
      generation: 0,
      records,
      subtle,
    })) {
      pages.push(page);
    }
    expect(pages).toHaveLength(1);
    const decoded = await decodeLibraryCoreWireObjectV1(
      pages[0]!.object.source,
      {
        kind: "checkpoint",
        maximumDecodedBytes:
          LIBRARY_CORE_CHECKPOINT_PAGE_MAXIMUM_DECODED_BYTES,
        maximumRecordBytes:
          LIBRARY_CORE_CHECKPOINT_RECORD_MAXIMUM_CANONICAL_BYTES,
        maximumRecords: LIBRARY_CORE_CHECKPOINT_PAGE_MAXIMUM_RECORDS,
        recordIdentity(value) {
          return libraryCoreNormalizedCheckpointRecordIdentityV2(
            parseLibraryCoreNormalizedCheckpointRecordV2(value),
          );
        },
      },
    );
    expect(decoded).toEqual(records);
    expect(JSON.stringify(decoded)).not.toContain("shell");

    const adapter = new MemoryCheckpointAdapter();
    const published = await publishLibraryCoreNormalizedCheckpointV2({
      activeTransport: "google_drive_app_data_v1",
      adapter,
      descriptor: {
        format: "freed_normalized_checkpoint_export_v2",
        protocolVersion: 2,
        libraryId,
        authorityEpoch,
        writerId,
        sourceRevision: 7,
        causalFrontierDigest: frontierDigest,
        recordCount: records.length,
        itemCount: 1,
      },
      expectedControl: { revision: null, pointer: null },
      generation: 0,
      records,
      subtle,
    });
    if (published.status === "conflict") {
      throw new Error("normalized checkpoint publication conflicted");
    }
    const importedRecords: typeof records[number][] = [];
    let header = records[0]!;
    const imported = await importLibraryCoreNormalizedCheckpointV2({
      adapter,
      generation: 0,
      libraryId,
      manifest: published.manifest,
      storageEpoch: authorityEpoch,
      subtle,
      writer: {
        async beginImport(input) {
          header = input.header;
        },
        async appendPage(_pageIndex, pageRecords) {
          importedRecords.push(...pageRecords);
        },
        async finalizeImport(completed) {
          return {
            authorityEpoch,
            canonicalBytes: completed.canonicalBytes,
            checkpointDigest: completed.checkpointDigest,
            libraryId,
            recordCount: completed.recordCount,
            sourceRevision: Number(header.payload.sourceRevision),
            stageId: `manifest:${published.manifest.descriptor.contentDigest}`,
          };
        },
      },
    });
    const expectedDigest =
      createLibraryCoreNormalizedCheckpointDigestAccumulatorV2();
    for (const record of records) expectedDigest.push(record);
    const expectedSummary = expectedDigest.finish();
    expect(imported).toMatchObject({
      activationReceipt: expectedSummary,
      importedPageCount: 1,
      importedRecordCount: records.length,
      status: "imported",
    });
    // Staging runs the real wire verifier but cannot call activation. The same
    // immutable header supplies identical begin metadata after response loss.
    const retained = new Map<string, typeof records[number]>();
    const begins: unknown[] = [];
    const stagingInput = { adapter, generation: 0, libraryId, manifest: published.manifest,
      storageEpoch: authorityEpoch, subtle, runtime: {
        async begin(request: import("@freed/shared/library-core").LibraryCoreBeginNormalizedCheckpointStageV2) {
          begins.push(request);
          return { stageId: request.stageId, complete: false, expectedRecordCount: records.length, stagedRecordCount: retained.size, stagedCanonicalBytes: 0 };
        },
        async appendPage(page: { stageId: string; records: readonly typeof records[number][] }) {
          for (const record of page.records) retained.set(libraryCoreNormalizedCheckpointRecordIdentityV2(record), record);
          const digest = createLibraryCoreNormalizedCheckpointDigestAccumulatorV2();
          for (const record of retained.values()) digest.push(record);
          return { stageId: page.stageId, complete: true, expectedRecordCount: records.length,
            stagedRecordCount: retained.size, stagedCanonicalBytes: digest.finish().canonicalBytes };
        },
      } };
    const staged = await stageLibraryCoreNormalizedCheckpointV2(stagingInput);
    expect(staged).toMatchObject({ status: "staged", checkpoint: expectedSummary, stageId: published.manifest.descriptor.contentDigest, sourceRevision: 7 });
    expect(staged).not.toHaveProperty("activationReceipt");
    expect(await stageLibraryCoreNormalizedCheckpointV2(stagingInput)).toEqual(staged);
    expect(begins[0]).toEqual(begins[1]);
    await expect(stageLibraryCoreNormalizedCheckpointV2({ ...stagingInput, runtime: {
      ...stagingInput.runtime, async appendPage(page) {
        return { ...await stagingInput.runtime.appendPage(page), stagedCanonicalBytes: 0 };
      },
    } })).rejects.toThrow("staging receipt does not match");
    const reference = { purpose: "predecessor_checkpoint_read" as const, pointer: published.controlPointer,
      controlRevision: '"signed-revision"', controlFileId: "control-1", checkpointDigest: expectedSummary.checkpointDigest,
      sourceRevision: 7, successorEpochId: "f".repeat(64), authorizationDigest: "a".repeat(64) };
    const prepare = vi.fn(async () => reference as typeof reference | null);
    const activate = vi.fn(async () => ({ stageId: staged.stageId, libraryId, authorityEpoch,
      sourceRevision: 7, ...expectedSummary }));
    const readImmutable = vi.fn(adapter.readImmutable.bind(adapter));
    const catchup = { adapter: { readImmutable }, subtle, successorStageId: "successor-stage", installedAt: 2500,
      assertActive: () => {}, runtime: { ...stagingInput.runtime, prepare, activate } };
    prepare.mockResolvedValueOnce(null);
    await catchUpLibraryCorePredecessorCheckpointV1(catchup);
    expect(readImmutable).not.toHaveBeenCalled();
    expect(activate).not.toHaveBeenCalled();
    prepare.mockResolvedValueOnce({ ...reference, checkpointDigest: "0".repeat(64) as LibraryCoreLowercaseHex64 });
    await expect(catchUpLibraryCorePredecessorCheckpointV1(catchup)).rejects.toThrow("differs from signed consent");
    expect(activate).not.toHaveBeenCalled();
    let canceled = false;
    await expect(catchUpLibraryCorePredecessorCheckpointV1({ ...catchup,
      assertActive: () => { if (canceled) throw new Error("canceled"); }, runtime: { ...catchup.runtime,
        async appendPage(page) { const result = await stagingInput.runtime.appendPage(page); canceled = true; return result; },
      },
    })).rejects.toThrow("canceled");
    expect(activate).not.toHaveBeenCalled();
    for (const reason of ["expired token", "missing immutable checkpoint"]) {
      await expect(catchUpLibraryCorePredecessorCheckpointV1({ ...catchup,
        adapter: { async readImmutable() { throw new Error(reason); } },
      })).rejects.toThrow(reason);
      expect(activate).not.toHaveBeenCalled();
    }
    // Even one predecessor remains unselected for an old source. Native demotion
    // owns the atomic installation of historical proof and the final winner.
    await catchUpLibraryCorePredecessorCheckpointV1({ ...catchup, stageOnly: true });
    expect(activate).not.toHaveBeenCalled();
    await catchUpLibraryCorePredecessorCheckpointV1(catchup);
    expect(activate).toHaveBeenCalledOnce();
    expect(activate).toHaveBeenCalledWith(expect.objectContaining({ stageId: staged.stageId, replaceExisting: true,
      followerReceipt: expect.objectContaining({ controlRevision: reference.controlRevision,
        manifestContentDigest: published.manifest.descriptor.contentDigest }) }), "successor-stage");
    // A lost commit response retries from durable runtime state, with no second download.
    activate.mockRejectedValueOnce(new Error("response lost"));
    await expect(catchUpLibraryCorePredecessorCheckpointV1(catchup)).rejects.toThrow("response lost");
    readImmutable.mockClear();
    prepare.mockResolvedValueOnce(null);
    await catchUpLibraryCorePredecessorCheckpointV1(catchup);
    expect(readImmutable).not.toHaveBeenCalled();
    expect(importedRecords).toEqual(records);
    expect(JSON.stringify(importedRecords)).not.toContain("shell");

    // Runtime signatures are tested by the host suites. This fixture exercises
    // real immutable wire downloads and idempotent staging across two epochs.
    adapter.control = { revision: null, bytes: null };
    const secondEpoch = reference.successorEpochId as LibraryCoreLowercaseHex64;
    const secondRecords = [createLibraryCoreNormalizedCheckpointRecordV2({ registryKey: "00_checkpoint_header",
      primaryKey: "checkpoint", payload: { authorityEpoch: secondEpoch, checkpointId: `${libraryId}:${secondEpoch}:8`,
        createdAtMs: 1001, libraryId, schemaVersion: 1, sourceRevision: 8 } }), ...records.slice(1)];
    const second = await publishLibraryCoreNormalizedCheckpointV2({ activeTransport: "google_drive_app_data_v1", adapter,
      descriptor: { format: "freed_normalized_checkpoint_export_v2", protocolVersion: 2, libraryId,
        authorityEpoch: secondEpoch, writerId, sourceRevision: 8, causalFrontierDigest: frontierDigest,
        recordCount: secondRecords.length, itemCount: 1 }, expectedControl: { revision: null, pointer: null },
      generation: 0, records: secondRecords, subtle });
    if (second.status === "conflict") throw new Error("fixture publication conflicted");
    const secondDigest = createLibraryCoreNormalizedCheckpointDigestAccumulatorV2();
    secondRecords.forEach(record => secondDigest.push(record));
    const secondReference = { ...reference, pointer: second.controlPointer, sourceRevision: 8,
      checkpointDigest: secondDigest.finish().checkpointDigest, successorEpochId: "9".repeat(64) };
    const stages = new Map<string, Map<string, typeof records[number]>>();
    let loseResponse = true;
    activate.mockClear();
    const chainInput = { ...catchup, runtime: { ...catchup.runtime,
      async prepare() { return [reference, secondReference]; },
      async begin(request: import("@freed/shared/library-core").LibraryCoreBeginNormalizedCheckpointStageV2) {
        if (!stages.has(request.stageId)) stages.set(request.stageId, new Map());
        return { stageId: request.stageId, complete: false, expectedRecordCount: request.expectedRecordCount,
          stagedRecordCount: stages.get(request.stageId)!.size, stagedCanonicalBytes: 0 };
      },
      async appendPage(page: { stageId: string; records: readonly typeof records[number][] }) {
        const stored = stages.get(page.stageId)!;
        page.records.forEach(record => stored.set(libraryCoreNormalizedCheckpointRecordIdentityV2(record), record));
        if (page.stageId === second.manifest.descriptor.contentDigest && loseResponse) {
          loseResponse = false; throw new Error("historical staging response lost");
        }
        const digest = createLibraryCoreNormalizedCheckpointDigestAccumulatorV2();
        stored.forEach(record => digest.push(record));
        return { stageId: page.stageId, complete: true, expectedRecordCount: records.length,
          stagedRecordCount: stored.size, stagedCanonicalBytes: digest.finish().canonicalBytes };
      },
    } };
    await expect(catchUpLibraryCorePredecessorCheckpointV1(chainInput)).rejects.toThrow("historical staging response lost");
    expect(activate).not.toHaveBeenCalled();
    await catchUpLibraryCorePredecessorCheckpointV1(chainInput);
    expect(stages.size).toBe(2);
    expect([...stages.values()].map(stage => stage.size)).toEqual([records.length, secondRecords.length]);
    expect(activate).not.toHaveBeenCalled();

  });
});
