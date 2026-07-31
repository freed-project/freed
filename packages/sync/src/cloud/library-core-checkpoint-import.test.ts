import { createHash, webcrypto } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createLibraryCoreImmutableObjectKey,
  parseLibraryCoreImmutableObjectDescriptorV1,
  type LibraryCoreCanonicalValue,
} from "@freed/shared/library-core";
import type {
  LibraryCoreImmutableReadAdapterV1,
  LibraryCorePublishedImmutableObjectReceiptV1,
} from "./library-core-immutable-publication.js";
import {
  importLibraryCoreCheckpointPagesV1,
  type LibraryCoreCheckpointPageReferenceV1,
} from "./library-core-checkpoint-import.js";
import { encodeLibraryCoreWireObjectV1 } from "./library-core-wire-object.js";

interface TestRecord {
  readonly [key: string]: LibraryCoreCanonicalValue;
  readonly id: string;
  readonly value: string;
}

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function parseRecord(value: LibraryCoreCanonicalValue): TestRecord {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    throw new TypeError("checkpoint test record must be a plain record");
  }
  const record = value as Record<string, LibraryCoreCanonicalValue>;
  if (
    Object.keys(record).sort().join(",") !== "id,value" ||
    typeof record.id !== "string" ||
    typeof record.value !== "string"
  ) {
    throw new TypeError("checkpoint test record is invalid");
  }
  return Object.freeze({ id: record.id, value: record.value });
}

function identity(record: TestRecord): string {
  return record.id;
}

async function checkpointPage(
  pageIndex: number,
  records: readonly TestRecord[],
): Promise<{
  readonly bytes: Uint8Array;
  readonly reference: LibraryCoreCheckpointPageReferenceV1;
}> {
  const bytes = await encodeLibraryCoreWireObjectV1(records, {
    kind: "checkpoint",
    maximumDecodedBytes: 2_097_152,
    maximumRecordBytes: 131_072,
    maximumRecords: 128,
    recordIdentity(value) {
      return parseRecord(value).id;
    },
  });
  const contentDigest = digest(bytes);
  return {
    bytes,
    reference: {
      pageIndex,
      descriptor: parseLibraryCoreImmutableObjectDescriptorV1({
        objectKey: createLibraryCoreImmutableObjectKey({
          kind: "checkpoint_page",
          libraryId: "library-1",
          epochId: "epoch-1",
          generation: 7,
          pageIndex,
          digest: contentDigest,
        }),
        contentDigest,
        byteLength: bytes.byteLength,
      }),
      transportObjectId: `drive-page-${pageIndex.toLocaleString("en-US", {
        useGrouping: false,
      })}`,
    },
  };
}

class FakeReader implements LibraryCoreImmutableReadAdapterV1 {
  readonly bytes = new Map<string, Uint8Array>();

  async readImmutable(
    receipt: LibraryCorePublishedImmutableObjectReceiptV1,
  ): Promise<Uint8Array> {
    const stored = this.bytes.get(receipt.transportObjectId);
    if (stored === undefined) throw new Error("missing fake immutable object");
    return stored.slice();
  }
}

async function fixture(
  pageRecords: readonly (readonly TestRecord[])[],
): Promise<{
  readonly reader: FakeReader;
  readonly references: LibraryCoreCheckpointPageReferenceV1[];
}> {
  const reader = new FakeReader();
  const references: LibraryCoreCheckpointPageReferenceV1[] = [];
  for (let pageIndex = 0; pageIndex < pageRecords.length; pageIndex += 1) {
    const page = await checkpointPage(pageIndex, pageRecords[pageIndex]!);
    reader.bytes.set(page.reference.transportObjectId, page.bytes);
    references.push(page.reference);
  }
  return { reader, references };
}

function request(
  input: Awaited<ReturnType<typeof fixture>>,
  overrides: Partial<
    Parameters<typeof importLibraryCoreCheckpointPagesV1<TestRecord>>[0]
  > = {},
) {
  const imported: TestRecord[][] = [];
  return {
    imported,
    value: {
      adapter: input.reader,
      expectedPageCount: input.references.length,
      generation: 7,
      libraryId: "library-1",
      async onPage(_pageIndex: number, records: readonly TestRecord[]) {
        imported.push([...records]);
      },
      pages: input.references,
      parseRecord,
      recordIdentity: identity,
      storageEpoch: "epoch-1",
      subtle: webcrypto.subtle as unknown as SubtleCrypto,
      totalRecordCount: input.references.length * 2,
      ...overrides,
    },
  };
}

describe("Library Core checkpoint page import", () => {
  it("verifies and streams ordered pages without retaining the corpus", async () => {
    const input = await fixture([
      [
        { id: "item-1", value: "one" },
        { id: "item-2", value: "two" },
      ],
      [
        { id: "item-3", value: "three" },
        { id: "item-4", value: "four" },
      ],
    ]);
    const importRequest = request(input);

    await expect(
      importLibraryCoreCheckpointPagesV1(importRequest.value),
    ).resolves.toEqual({
      importedPageCount: 2,
      importedRecordCount: 4,
    });
    expect(importRequest.imported).toEqual([
      [
        { id: "item-1", value: "one" },
        { id: "item-2", value: "two" },
      ],
      [
        { id: "item-3", value: "three" },
        { id: "item-4", value: "four" },
      ],
    ]);
  });

  it("rejects changed bytes and cross-page identity reordering", async () => {
    const corrupt = await fixture([
      [
        { id: "item-1", value: "one" },
        { id: "item-2", value: "two" },
      ],
    ]);
    const stored = corrupt.reader.bytes.get("drive-page-0")!;
    stored[stored.byteLength - 1] ^= 1;
    await expect(
      importLibraryCoreCheckpointPagesV1(request(corrupt).value),
    ).rejects.toThrow(/digest does not match descriptor|decompress/u);

    const reordered = await fixture([
      [
        { id: "item-2", value: "two" },
        { id: "item-3", value: "three" },
      ],
      [
        { id: "item-1", value: "one" },
        { id: "item-4", value: "four" },
      ],
    ]);
    await expect(
      importLibraryCoreCheckpointPagesV1(request(reordered).value),
    ).rejects.toThrow(/strictly increasing/u);
  });

  it("orders identities by canonical UTF-8 bytes instead of UTF-16 code units", async () => {
    const input = await fixture([
      [
        { id: "\ue000", value: "private-use" },
        { id: "\u{10000}", value: "supplementary-plane" },
      ],
    ]);

    await expect(
      importLibraryCoreCheckpointPagesV1(request(input).value),
    ).resolves.toEqual({
      importedPageCount: 1,
      importedRecordCount: 2,
    });
  });

  it("rejects page gaps, locator drift, and declared count drift", async () => {
    const input = await fixture([
      [
        { id: "item-1", value: "one" },
        { id: "item-2", value: "two" },
      ],
    ]);
    const gap = [{ ...input.references[0]!, pageIndex: 1 }];
    await expect(
      importLibraryCoreCheckpointPagesV1(request(input, { pages: gap }).value),
    ).rejects.toThrow(/contiguous at 0/u);

    await expect(
      importLibraryCoreCheckpointPagesV1(
        request(input, { generation: 8 }).value,
      ),
    ).rejects.toThrow(/does not match/u);
    await expect(
      importLibraryCoreCheckpointPagesV1(
        request(input, { totalRecordCount: 3 }).value,
      ),
    ).rejects.toThrow(/record count does not match declaration/u);
  });
});
