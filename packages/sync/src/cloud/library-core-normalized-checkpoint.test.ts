import { createHash, webcrypto } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createLibraryCoreNormalizedCheckpointRecordV2,
  createLibraryCoreNormalizedCheckpointDigestAccumulatorV2,
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
  prepareLibraryCoreNormalizedCheckpointPagesV2,
  publishLibraryCoreNormalizedCheckpointV2,
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
  it("stores exact typed normalized records without a shell envelope", async () => {
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
        primaryKey: "item-1",
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
    expect(imported).toMatchObject({
      activationReceipt: expectedDigest.finish(),
      importedPageCount: 1,
      importedRecordCount: records.length,
      status: "imported",
    });
    expect(importedRecords).toEqual(records);
    expect(JSON.stringify(importedRecords)).not.toContain("shell");
  });
});
