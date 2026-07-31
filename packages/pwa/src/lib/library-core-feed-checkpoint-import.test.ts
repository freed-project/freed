import { createHash, webcrypto } from "node:crypto";
import { describe, expect, it } from "vitest";
import { type FeedItem } from "@freed/shared";
import {
  createLibraryCoreImmutableObjectKey,
  parseLibraryCoreImmutableObjectDescriptorV1,
  projectLibraryCoreFeedCardV1,
  type LibraryCoreCanonicalValue,
  type LibraryCoreFeedCardV1,
  type LibraryCoreFeedPageSourceV1,
} from "@freed/shared/library-core";
import {
  encodeLibraryCoreWireObjectV1,
  type LibraryCoreCheckpointPageReferenceV1,
  type LibraryCoreImmutableReadAdapterV1,
  type LibraryCorePublishedImmutableObjectReceiptV1,
} from "@freed/sync/cloud";

import { importPwaLibraryCoreFeedCheckpoint } from "./library-core-feed-checkpoint-import";
import type {
  AppendPwaLibraryCoreFeedGenerationPageInput,
  BeginPwaLibraryCoreFeedGenerationInput,
} from "./library-core-feed-reader-runtime";

const SOURCE = Object.freeze({
  generationId: "ab".repeat(32),
  projectionRevision: 7,
  transitionSequence: 3,
}) as LibraryCoreFeedPageSourceV1;

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
  private readonly bytes: Uint8Array;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }

  async readImmutable(
    _receipt: LibraryCorePublishedImmutableObjectReceiptV1,
  ): Promise<Uint8Array> {
    return this.bytes.slice();
  }
}

async function page(rows: readonly LibraryCoreFeedCardV1[]): Promise<{
  readonly adapter: FakeReader;
  readonly reference: LibraryCoreCheckpointPageReferenceV1;
}> {
  const canonicalRows = rows.map(
    (row) => ({ ...row }) satisfies Record<string, LibraryCoreCanonicalValue>,
  );
  const stored = await encodeLibraryCoreWireObjectV1(canonicalRows, {
    kind: "checkpoint",
    maximumDecodedBytes: 2_097_152,
    maximumRecordBytes: 131_072,
    maximumRecords: 128,
    recordIdentity(record) {
      return (record as { readonly globalId: string }).globalId;
    },
  });
  const contentDigest = digest(stored);
  return {
    adapter: new FakeReader(stored),
    reference: {
      pageIndex: 0,
      descriptor: parseLibraryCoreImmutableObjectDescriptorV1({
        objectKey: createLibraryCoreImmutableObjectKey({
          kind: "checkpoint_page",
          libraryId: "library-1",
          epochId: "epoch-1",
          generation: 7,
          pageIndex: 0,
          digest: contentDigest,
        }),
        contentDigest,
        byteLength: stored.byteLength,
      }),
      transportObjectId: "drive-page-0",
    },
  };
}

describe("PWA Library Core feed checkpoint import", () => {
  it("feeds verified portable pages into the bounded IndexedDB writer", async () => {
    const rows = [
      projectLibraryCoreFeedCardV1(item("x:item-1")),
      projectLibraryCoreFeedCardV1(item("x:item-2")),
    ];
    const stored = await page(rows);
    const appended: AppendPwaLibraryCoreFeedGenerationPageInput[] = [];
    const events: string[] = [];

    await expect(
      importPwaLibraryCoreFeedCheckpoint({
        adapter: stored.adapter,
        expectedPageCount: 1,
        generation: 7,
        libraryId: "library-1",
        pages: [stored.reference],
        source: SOURCE,
        storageEpoch: "epoch-1",
        subtle: webcrypto.subtle as unknown as SubtleCrypto,
        totalRecordCount: 2,
        writer: {
          async appendGenerationPage(input) {
            events.push("append");
            appended.push(input);
          },
          async beginGeneration(input: BeginPwaLibraryCoreFeedGenerationInput) {
            expect(input).toEqual({ source: SOURCE, totalCount: 2 });
            events.push("begin");
            return "staging";
          },
          async finalizeGeneration(source) {
            expect(source).toEqual(SOURCE);
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
    expect(appended).toEqual([{ batchIndex: 0, rows, source: SOURCE }]);
  });

  it("does not download a generation the IndexedDB writer already completed", async () => {
    const stored = await page([projectLibraryCoreFeedCardV1(item("x:item-1"))]);
    let readCount = 0;
    const adapter: LibraryCoreImmutableReadAdapterV1 = {
      async readImmutable(receipt) {
        readCount += 1;
        return stored.adapter.readImmutable(receipt);
      },
    };

    await expect(
      importPwaLibraryCoreFeedCheckpoint({
        adapter,
        expectedPageCount: 1,
        generation: 7,
        libraryId: "library-1",
        pages: [stored.reference],
        source: SOURCE,
        storageEpoch: "epoch-1",
        subtle: webcrypto.subtle as unknown as SubtleCrypto,
        totalRecordCount: 1,
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
    expect(readCount).toBe(0);
  });
});
