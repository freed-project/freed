import { webcrypto } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createLibraryCoreNormalizedCheckpointRecordV2,
  LIBRARY_CORE_CHECKPOINT_PAGE_MAXIMUM_DECODED_BYTES,
  LIBRARY_CORE_CHECKPOINT_PAGE_MAXIMUM_RECORDS,
  LIBRARY_CORE_CHECKPOINT_RECORD_MAXIMUM_CANONICAL_BYTES,
  libraryCoreNormalizedCheckpointRecordIdentityV2,
  parseLibraryCoreNormalizedCheckpointRecordV2,
  type LibraryCoreLowercaseHex64,
} from "@freed/shared/library-core";
import { prepareLibraryCoreNormalizedCheckpointPagesV2 } from "./library-core-normalized-checkpoint.js";
import { decodeLibraryCoreWireObjectV1 } from "./library-core-wire-object.js";

const subtle = webcrypto.subtle as unknown as SubtleCrypto;
const libraryId = "ab".repeat(32) as LibraryCoreLowercaseHex64;
const authorityEpoch = "cd".repeat(32) as LibraryCoreLowercaseHex64;
const writerId = "ef".repeat(32) as LibraryCoreLowercaseHex64;
const frontierDigest = "12".repeat(32) as LibraryCoreLowercaseHex64;

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
  });
});
