import { createHash, webcrypto } from "node:crypto";
import { describe, expect, it } from "vitest";
import { type FeedItem } from "@freed/shared";
import {
  createLibraryCoreImmutableObjectKey,
  encodeLibraryCoreCanonicalValue,
  parseLibraryCoreImmutableObjectDescriptorV1,
  projectLibraryCoreFeedCardV1,
  type LibraryCoreCanonicalValue,
  type LibraryCoreFeedCardV1,
  type LibraryCoreFeedPageSourceV1,
  type LibraryCoreImmutableObjectReferenceV1,
} from "@freed/shared/library-core";
import {
  encodeLibraryCoreWireObjectV1,
  type LibraryCoreImmutableReadAdapterV1,
  type LibraryCorePublishedImmutableObjectReceiptV1,
} from "@freed/sync/cloud";

import { importPwaLibraryCoreFeedCheckpoint } from "./library-core-feed-checkpoint-import";
import type {
  AppendPwaLibraryCoreFeedGenerationPageInput,
  BeginPwaLibraryCoreFeedGenerationInput,
} from "./library-core-feed-reader-runtime";

function item(globalId: string): FeedItem {
  return {
    author: {
      displayName: globalId,
      handle: globalId,
      id: `author:${globalId}`,
    },
    capturedAt: 1_780_000_000_000,
    content: { mediaTypes: [], mediaUrls: [], text: globalId },
    contentType: "post",
    globalId,
    platform: "x",
    publishedAt: 1_780_000_000_000,
    topics: [],
    userState: {
      archived: false,
      hidden: false,
      saved: false,
      tags: [],
    },
  } as FeedItem;
}

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

class FakeReader implements LibraryCoreImmutableReadAdapterV1 {
  readonly objects = new Map<string, Uint8Array>();
  readonly readIds: string[] = [];

  async readImmutable(
    receipt: LibraryCorePublishedImmutableObjectReceiptV1,
  ): Promise<Uint8Array> {
    this.readIds.push(receipt.transportObjectId);
    const bytes = this.objects.get(receipt.transportObjectId);
    if (bytes === undefined) throw new Error("missing fake immutable object");
    return bytes.slice();
  }
}

async function checkpoint(rows: readonly LibraryCoreFeedCardV1[]): Promise<{
  readonly adapter: FakeReader;
  readonly manifest: LibraryCoreImmutableObjectReferenceV1;
  readonly source: LibraryCoreFeedPageSourceV1;
}> {
  const canonicalRows = rows.map(
    (row) => ({ ...row }) satisfies Record<string, LibraryCoreCanonicalValue>,
  );
  const pageBytes = await encodeLibraryCoreWireObjectV1(canonicalRows, {
    kind: "checkpoint",
    maximumDecodedBytes: 2_097_152,
    maximumRecordBytes: 131_072,
    maximumRecords: 128,
    recordIdentity(record) {
      return (record as { readonly globalId: string }).globalId;
    },
  });
  const pageDigest = digest(pageBytes);
  const pageReference = {
    descriptor: parseLibraryCoreImmutableObjectDescriptorV1({
      objectKey: createLibraryCoreImmutableObjectKey({
        kind: "checkpoint_page",
        libraryId: "library-1",
        epochId: "epoch-1",
        generation: 7,
        pageIndex: 0,
        digest: pageDigest,
      }),
      contentDigest: pageDigest,
      byteLength: pageBytes.byteLength,
    }),
    transportObjectId: "drive-page-0",
  };
  const manifestBytes = encodeLibraryCoreCanonicalValue({
    causalFrontierDigest: "fe".repeat(32),
    datasetSchemaId: "library_core_feed_card_projection_v1",
    generation: 7,
    kind: "checkpoint_manifest",
    libraryId: "library-1",
    pages: [
      {
        firstRecordIdentity: rows[0]!.globalId,
        lastRecordIdentity: rows[rows.length - 1]!.globalId,
        object: pageReference,
        pageIndex: 0,
        recordCount: rows.length,
      },
    ],
    protocolVersion: 1,
    schemaVersion: 1,
    storageEpoch: "epoch-1",
    totalRecordCount: rows.length,
  } as unknown as LibraryCoreCanonicalValue);
  const manifestDigest = digest(manifestBytes);
  const manifest = {
    descriptor: parseLibraryCoreImmutableObjectDescriptorV1({
      objectKey: createLibraryCoreImmutableObjectKey({
        kind: "checkpoint_manifest",
        libraryId: "library-1",
        epochId: "epoch-1",
        generation: 7,
        digest: manifestDigest,
      }),
      contentDigest: manifestDigest,
      byteLength: manifestBytes.byteLength,
    }),
    transportObjectId: "drive-manifest-7",
  };
  const adapter = new FakeReader();
  adapter.objects.set(pageReference.transportObjectId, pageBytes);
  adapter.objects.set(manifest.transportObjectId, manifestBytes);
  return {
    adapter,
    manifest,
    source: Object.freeze({
      generationId: manifestDigest,
      projectionRevision: 1,
      transitionSequence: 7,
    }) as LibraryCoreFeedPageSourceV1,
  };
}

describe("PWA Library Core feed checkpoint import", () => {
  it("feeds one exact manifest and its verified pages into the bounded IndexedDB writer", async () => {
    const rows = [
      projectLibraryCoreFeedCardV1(item("x:item-1")),
      projectLibraryCoreFeedCardV1(item("x:item-2")),
    ];
    const stored = await checkpoint(rows);
    const appended: AppendPwaLibraryCoreFeedGenerationPageInput[] = [];
    const events: string[] = [];

    await expect(
      importPwaLibraryCoreFeedCheckpoint({
        adapter: stored.adapter,
        generation: 7,
        libraryId: "library-1",
        manifest: stored.manifest,
        storageEpoch: "epoch-1",
        subtle: webcrypto.subtle as unknown as SubtleCrypto,
        writer: {
          async appendGenerationPage(input) {
            events.push("append");
            appended.push(input);
          },
          async beginGeneration(input: BeginPwaLibraryCoreFeedGenerationInput) {
            expect(input).toEqual({ source: stored.source, totalCount: 2 });
            events.push("begin");
            return "staging";
          },
          async finalizeGeneration(source) {
            expect(source).toEqual(stored.source);
            events.push("finalize");
          },
        },
      }),
    ).resolves.toEqual({
      importedPageCount: 1,
      importedRecordCount: 2,
      status: "imported",
    });
    expect(events).toEqual(["begin", "append", "finalize"]);
    expect(appended).toEqual([{ batchIndex: 0, rows, source: stored.source }]);
    expect(stored.adapter.readIds).toEqual([
      "drive-manifest-7",
      "drive-page-0",
    ]);
  });

  it("verifies the manifest but does not download pages for an already completed generation", async () => {
    const stored = await checkpoint([
      projectLibraryCoreFeedCardV1(item("x:item-1")),
    ]);

    await expect(
      importPwaLibraryCoreFeedCheckpoint({
        adapter: stored.adapter,
        generation: 7,
        libraryId: "library-1",
        manifest: stored.manifest,
        storageEpoch: "epoch-1",
        subtle: webcrypto.subtle as unknown as SubtleCrypto,
        writer: {
          async appendGenerationPage() {
            throw new Error("completed generation must not append");
          },
          async beginGeneration() {
            return "complete";
          },
          async finalizeGeneration() {
            throw new Error("completed generation must not finalize");
          },
        },
      }),
    ).resolves.toEqual({
      importedPageCount: 0,
      importedRecordCount: 0,
      status: "already_complete",
    });
    expect(stored.adapter.readIds).toEqual(["drive-manifest-7"]);
  });
});
